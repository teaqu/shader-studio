import type { WgslTraceRecording } from '@shader-studio/types';

export interface TraceRequest {
  seq: number;
  type: 'request';
  command: string;
  arguments?: Record<string, unknown>;
}

export interface TraceProtocolMessage {
  seq: number;
  type: 'response' | 'event';
  request_seq?: number;
  command?: string;
  success?: boolean;
  message?: string;
  event?: string;
  body?: unknown;
}

interface RequestedBreakpoint { line: number; condition?: string; hitCondition?: string; logMessage?: string; }
interface TraceBreakpoint { id: number; line: number; supported: boolean; }

/** DAP navigation over an immutable recording; no GPU work on stepping. */
export class WgslTraceSession {
  private sequence = 1;
  private recording?: WgslTraceRecording;
  private index = 0;
  private configured = false;
  private terminated = false;
  private launching = false;
  private nextBreakpointId = 1;
  private breakpoints = new Map<string, TraceBreakpoint[]>();

  constructor(
    private readonly emit: (message: TraceProtocolMessage) => void,
    private readonly capture: (configuration: Record<string, unknown>) => Promise<WgslTraceRecording>,
    private readonly cleanup: () => void,
    private readonly sourceIsCurrent: () => boolean = () => true,
  ) {}

  async handle(request: TraceRequest): Promise<void> {
    try {
      if (this.terminated && request.command !== 'disconnect') {
        throw new Error('The WGSL trace session has ended. Launch again to capture a new execution.');
      }
      await this.dispatch(request);
    } catch (error) {
      this.respond(request, undefined, error instanceof Error ? error.message : String(error));
      if (request.command === 'launch') {
        this.dispose();
      }
    }
  }

  dispose(): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    this.recording = undefined;
    this.cleanup();
    this.event('terminated');
  }

  private async dispatch(request: TraceRequest): Promise<void> {
    const args = request.arguments ?? {};
    if (['stackTrace', 'source', 'scopes', 'variables', 'evaluate'].includes(request.command)) {
      this.inspect(request, args);
      return;
    }
    switch (request.command) {
      case 'initialize':
        this.respond(request, { supportsConfigurationDoneRequest: true, supportsStepBack: true,
          supportsEvaluateForHovers: true, supportsTerminateRequest: true });
        this.event('initialized');
        break;
      case 'launch':
        if (this.launching) {
          throw new Error('This trace session has already launched.');
        }
        this.launching = true;
        await this.launch(request, args);
        break;
      case 'configurationDone':
        this.configured = true;
        this.respond(request);
        if (this.recording) {
          this.stopped('entry');
        }
        break;
      case 'setBreakpoints':
        this.setBreakpoints(request, args);
        break;
      case 'threads':
        this.respond(request, { threads: [{ id: 1, name: 'Selected WGSL pixel' }] });
        break;
      case 'next':
      case 'stepIn':
        // Helpers execute normally but are not instrumented in this PoC.
        this.move(request, 1, false);
        break;
      case 'stepBack':
        this.move(request, -1, false);
        break;
      case 'continue':
        this.move(request, 1, true);
        break;
      case 'reverseContinue':
        this.move(request, -1, true);
        break;
      case 'disconnect':
      case 'terminate':
        this.respond(request);
        this.dispose();
        break;
      default:
        throw new Error(`The WGSL trace PoC does not support '${request.command}'.`);
    }
  }

  private inspect(request: TraceRequest, args: Record<string, unknown>): void {
    switch (request.command) {
      case 'stackTrace': {
        const current = this.current();
        this.respond(request, { stackFrames: [{ id: 1, name: 'mainImage', line: current.line,
          // No shader extension/path on the virtual document: the existing
          // inspector must not treat DAP line highlighting as shader cursors.
          column: current.column, source: {
            name: `${this.recording!.path.split(/[\\/]/).at(-1)} (GPU recording)`, sourceReference: 1 } }], totalFrames: 1 });
        break;
      }
      case 'source':
        if (args.sourceReference !== 1) {
          throw new Error('Unknown WGSL trace source reference.');
        }
        this.current();
        this.respond(request, { content: this.recording!.source, mimeType: 'text/plain' });
        break;
      case 'scopes':
        this.current();
        this.respond(request, { scopes: [{ name: 'Recorded locals (before statement)', variablesReference: 1,
          expensive: false, presentationHint: 'locals' }] });
        break;
      case 'variables':
        this.respond(request, { variables: args.variablesReference === 1
          ? this.current().values.map(value => ({ name: value.name, type: value.type,
            value: String(Array.isArray(value.value) ? `[${value.value.join(', ')}]` : value.value), variablesReference: 0 })) : [] });
        break;
      case 'evaluate': {
        const value = this.current().values.find(item => item.name === args.expression);
        if (!value) {
          throw new Error('The PoC evaluates only exact names of recorded locals.');
        }
        this.respond(request, { result: String(Array.isArray(value.value) ? `[${value.value.join(', ')}]` : value.value),
          type: value.type, variablesReference: 0 });
        break;
      }
    }
  }

  private async launch(request: TraceRequest, args: Record<string, unknown>): Promise<void> {
    const recording = await this.capture(args);
    if (this.terminated) {
      this.respond(request, undefined, 'Trace capture was cancelled.');
      return;
    }
    if (!this.sourceIsCurrent()) {
      throw new Error('The shader changed during capture. Launch again.');
    }
    if (!recording.events.length) {
      throw new Error('No trace records were produced for the selected pixel. It may have been discarded.');
    }
    this.recording = recording;
    this.respond(request);
    for (const [path, breakpoints] of this.breakpoints) {
      for (const breakpoint of breakpoints) {
        this.event('breakpoint', { reason: 'changed', breakpoint: this.breakpointStatus(path, breakpoint) });
      }
    }
    this.event('output', { category: 'console', output: `Captured ${recording.events.length} WGSL steps. Stops show locals before the highlighted statement. Helpers are stepped over.\n` });
    if (recording.overflow) {
      this.event('output', { category: 'stderr', output: 'Trace capacity reached: this recording is incomplete. Increase capacity and launch again. Shader execution was not truncated.\n' });
    }
    if (this.configured) {
      this.stopped('entry');
    }
  }

  private setBreakpoints(request: TraceRequest, args: Record<string, unknown>): void {
    const source = args.source as { path?: string; sourceReference?: number } | undefined;
    const requested = (args.breakpoints ?? []) as RequestedBreakpoint[];
    const path = source?.sourceReference === 1 ? this.recording?.path ?? '' : source?.path ?? '';
    const breakpoints = requested.map(item => ({ id: this.nextBreakpointId++, line: item.line,
      supported: !item.condition && !item.hitCondition && !item.logMessage }));
    this.breakpoints.set(path, breakpoints);
    this.respond(request, { breakpoints: breakpoints.map(item => this.breakpointStatus(path, item)) });
  }

  private breakpointStatus(path: string, breakpoint: TraceBreakpoint) {
    const available = !!this.recording && path === this.recording.path
      && this.recording.sites.some(site => site.line === breakpoint.line);
    const message = !breakpoint.supported ? 'Conditional/hit/log breakpoints are outside the PoC.'
      : !this.recording ? 'Waiting for GPU trace source locations.'
        : !available ? 'No traceable mainImage statement on this line.' : undefined;
    return { id: breakpoint.id, line: breakpoint.line, verified: breakpoint.supported && available,
      ...(message ? { message } : {}) };
  }

  private current() {
    if (!this.sourceIsCurrent()) {
      this.dispose();
      throw new Error('The shader changed. Launch again to capture the updated source.');
    }
    const event = this.recording?.events[this.index];
    if (!event) {
      throw new Error('No captured execution is available.');
    }
    return event;
  }

  private move(request: TraceRequest, direction: number, search: boolean): void {
    this.current();
    const recording = this.recording!;
    let destination = this.index + direction;
    while (search && destination >= 0 && destination < recording.events.length) {
      if (this.breakpoints.get(recording.path)?.some(item => item.supported && item.line === recording.events[destination].line)) {
        break;
      }
      destination += direction;
    }
    this.respond(request, request.command === 'continue' ? { allThreadsContinued: true } : undefined);
    if (destination >= recording.events.length) {
      this.event('output', { category: 'console', output: recording.overflow
        ? 'End of incomplete trace recording.\n' : 'End of captured execution.\n' });
      this.dispose();
      return;
    }
    this.index = Math.max(0, destination);
    this.stopped(search && destination >= 0 ? 'breakpoint' : 'step');
  }

  private stopped(reason: string): void {
    this.event('stopped', { reason, threadId: 1, allThreadsStopped: true });
  }

  private respond(request: TraceRequest, body?: unknown, error?: string): void {
    this.emit({ seq: this.sequence++, type: 'response', request_seq: request.seq,
      command: request.command, success: !error, ...(body === undefined ? {} : { body }),
      ...(error ? { message: error } : {}) });
  }

  private event(event: string, body?: unknown): void {
    this.emit({ seq: this.sequence++, type: 'event', event, ...(body === undefined ? {} : { body }) });
  }
}
