import type { WgslTraceEvent, WgslTraceFrame, WgslTraceRecording, WgslTraceValue } from '@shader-studio/types';

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
  private nextVariableReference = 1;
  private variableReferences = new Map<number, { event: number; values: WgslTraceValue[] }>();

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
      case 'stepIn':
        this.move(request, 1, false);
        break;
      case 'next':
        this.stepOver(request);
        break;
      case 'stepOut':
        this.stepOut(request);
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
        const frames = this.frames(current).map(frame => this.stackFrame(frame));
        const start = Math.max(0, Number(args.startFrame ?? 0));
        const levels = Number(args.levels ?? 0);
        this.respond(request, { stackFrames: levels > 0 ? frames.slice(start, start + levels) : frames.slice(start), totalFrames: frames.length });
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
        const frame = this.frames(this.current()).find(item => item.id === args.frameId);
        if (!frame) {
          throw new Error('Unknown or stale WGSL trace frame.');
        }
        this.respond(request, { scopes: [{ name: 'Recorded locals (before statement)', variablesReference: this.reference(frame.values),
          expensive: false, presentationHint: 'locals' }] });
        break;
      case 'variables':
        this.respond(request, { variables: this.variables(Number(args.variablesReference), Number(args.start ?? 0), Number(args.count ?? 0),
          args.filter === 'indexed' || args.filter === 'named' ? args.filter : undefined) });
        break;
      case 'evaluate':
        this.evaluate(request, args);
        break;
    }
  }

  private evaluate(request: TraceRequest, args: Record<string, unknown>): void {
    const frames = this.frames(this.current());
    const frame = args.frameId === undefined ? frames[0] : frames.find(item => item.id === args.frameId);
    if (!frame) {
      throw new Error('Unknown or stale WGSL trace frame.');
    }
    const value = this.lookup(frame.values, String(args.expression));
    if (!value) {
      throw new Error('The trace evaluates only recorded local paths.');
    }
    this.respond(request, { result: String(Array.isArray(value.value) ? `[${value.value.join(', ')}]` : value.value),
      type: value.type, variablesReference: value.children?.length ? this.reference(value.children) : 0 });
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
    this.event('output', { category: 'console', output: `Captured ${recording.events.length} WGSL steps. Stops show locals before the highlighted statement.\n` });
    const unavailable = new Map(recording.sites.flatMap(site => (site.unavailableVariables ?? [])
      .map(variable => [variable.name, variable.type] as const)));
    if (unavailable.size) {
      this.event('output', { category: 'console', output: `Values not recorded by this PoC: ${[...unavailable].map(([name, type]) => `${name} (${type})`).join(', ')}. They remain visible as unavailable locals.\n` });
    }
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
    const available = !!this.recording && this.recording.sites.some(site => (site.path ?? this.recording!.path) === path && site.line === breakpoint.line);
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

  private frames(event: WgslTraceEvent): WgslTraceFrame[] {
    return event.frames?.length ? event.frames : [{ id: 1, functionName: event.functionName ?? 'mainImage', path: event.path,
      line: event.line, column: event.column, values: event.values }];
  }

  private stackFrame(frame: WgslTraceFrame) {
    const path = frame.path ?? this.recording!.path;
    return { id: frame.id, name: frame.functionName, line: frame.line, column: frame.column,
      source: { name: path.split(/[\\/]/).at(-1), path, sourceReference: 0 } };
  }

  private location(event: WgslTraceEvent): { path: string; line: number } {
    const frame = this.frames(event)[0]!;
    return { path: frame.path ?? event.path ?? this.recording!.path, line: frame.line ?? event.line };
  }

  private reference(values: WgslTraceValue[]) {
    for (const [reference, handle] of this.variableReferences) {
      if (handle.event === this.index && handle.values === values) {
        return reference;
      }
    }
    const reference = this.nextVariableReference++;
    this.variableReferences.set(reference, { event: this.index, values });
    return reference;
  }

  private variables(reference: number, start: number, count: number, filter?: 'indexed' | 'named') {
    const handle = this.variableReferences.get(reference) ?? (reference === 1 && this.current().frames === undefined
      ? { event: this.index, values: this.frames(this.current())[0]!.values }
      : undefined);
    if (!handle || handle.event !== this.index) {
      throw new Error('Unknown or stale WGSL trace variable reference.');
    }
    const filtered = filter === 'indexed' ? handle.values.filter(value => /^(?:\d+|\[\d+\])$/.test(value.name))
      : filter === 'named' ? handle.values.filter(value => !/^(?:\d+|\[\d+\])$/.test(value.name)) : handle.values;
    const values = count > 0 ? filtered.slice(Math.max(0, start), Math.max(0, start) + count) : filtered.slice(Math.max(0, start));
    return values.map(value => ({ name: value.name, type: value.type, value: String(Array.isArray(value.value) ? `[${value.value.join(', ')}]` : value.value),
      variablesReference: value.children?.length ? this.reference(value.children) : 0 }));
  }

  private lookup(values: WgslTraceValue[], expression: string): WgslTraceValue | undefined {
    const parts = expression.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let value = values.find(item => item.name === parts.shift());
    for (const part of parts) {
      value = value?.children?.find(item => (item.name === part || item.name === `[${part}]`));
    }
    return value;
  }

  private stepOver(request: TraceRequest) {
    const frames = this.frames(this.current()); const frame = frames[0]!;
    this.moveTo(request, 1, index => {
      const candidate = this.frames(this.recording!.events[index]!);
      return candidate[0]?.id === frame.id || !candidate.some(item => item.id === frame.id);
    }, true);
  }

  private stepOut(request: TraceRequest) {
    const frame = this.frames(this.current())[0]!;
    this.moveTo(request, 1, index => !this.frames(this.recording!.events[index]!).some(item => item.id === frame.id), true);
  }

  private move(request: TraceRequest, direction: number, search: boolean): void {
    this.current();
    const recording = this.recording!;
    let destination = this.index + direction;
    while (search && destination >= 0 && destination < recording.events.length) {
      const location = this.location(recording.events[destination]!);
      if (this.breakpoints.get(location.path)?.some(item => item.supported && item.line === location.line)) {
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
    this.variableReferences.clear();
    this.stopped(search && destination >= 0 ? 'breakpoint' : 'step');
  }

  private moveTo(request: TraceRequest, direction: number, predicate: (index: number) => boolean, breakpoint: boolean): void {
    this.current();
    let destination = this.index + direction;
    while (destination >= 0 && destination < this.recording!.events.length) {
      const event = this.recording!.events[destination]!;
      const location = this.location(event);
      const atBreakpoint = this.breakpoints.get(location.path)?.some(item => item.supported && item.line === location.line);
      if (predicate(destination) || (breakpoint && atBreakpoint)) {
        break;
      }
      destination += direction;
    }
    this.respond(request);
    if (destination >= this.recording!.events.length) {
      this.event('output', { category: 'console', output: this.recording!.overflow ? 'End of incomplete trace recording.\n' : 'End of captured execution.\n' }); this.dispose(); return;
    }
    this.index = Math.max(0, destination); this.variableReferences.clear();
    const location = this.location(this.recording!.events[this.index]!);
    this.stopped(breakpoint && this.breakpoints.get(location.path)?.some(item => item.supported && item.line === location.line) ? 'breakpoint' : 'step');
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
