import { ScriptStream, scriptUniformHelpers, readScriptUniform, scriptUniformDeclaration, zeroScriptUniform, type ScriptStreamInfo, type ScriptStreamFrame, type ScriptUniformType } from "@shader-studio/types";
import * as vm from "vm";
import { createRequire } from "module";
import { Logger } from "./services/Logger";

export interface CustomUniformType {
  name: string;
  type: ScriptUniformType;
}

export interface CustomUniformValue {
  name: string;
  type: string;
  value: number | number[] | boolean;
}

export interface ScriptLoadResult {
  declarations: string;
  uniforms: CustomUniformType[];
  streams?: ScriptStreamInfo[];
  session?: number;
  error?: string;
}

/**
 * Evaluates custom uniform scripts in the extension host (Node.js context).
 * This allows scripts to use Node.js APIs and npm packages.
 */
export class ScriptEvaluator {
  private lifetime = { active: false };
  private scriptTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private scriptIntervals = new Set<ReturnType<typeof setInterval>>();
  private session = 0;
  private sequence = 0;
  private streams = new Map<string, ScriptStream>();
  private createdStreams = new Set<ScriptStream>();
  private cleanups: (() => void)[] = [];
  private clients = new Map<string, { streams: Map<string, ScriptStream>; pending: ScriptStreamFrame | null }>();
  private logger = Logger.getInstance();
  private uniformsFn: ((ctx: any) => Record<string, any>) | null = null;
  private inferredTypes: Record<string, string> = {};
  private pollTimer: NodeJS.Timeout | null = null;
  private lastValues: CustomUniformValue[] = [];
  private onValues: ((values: CustomUniformValue[]) => void) | null = null;
  private currentIntervalMs = 33;
  private startTime = Date.now();

  private static readonly BUILTIN_UNIFORMS = new Set([
    'iResolution', 'iTime', 'iTimeDelta', 'iFrameRate', 'iMouse',
    'iFrame', 'iDate', 'iChannelTime', 'iSampleRate',
    'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3',
    'iChannelResolution', 'iChannelLoaded', 'iCameraPos', 'iCameraDir', 'iDispatch', 'iCh0', 'iCh1', 'iCh2', 'iCh3',
  ]);

  /**
   * Load and evaluate a bundled script in Node.js context.
   * @param scriptPath - path to the original script file, used to resolve require() from the script's directory
   */
  public loadScript(bundleCode: string, scriptPath?: string, allowStreams = true): ScriptLoadResult {
    this.dispose();
    this.session++;
    const lifetime = this.lifetime = { active: true };
    this.uniformsFn = null;
    this.inferredTypes = {};
    this.lastValues = [];

    try {
      // Create a require function that resolves from the script's directory
      const scriptRequire = scriptPath ? createRequire(scriptPath) : require;

      // Create a sandbox with require support
      // VM globals intentionally expose the Node APIs scripts already support.
      const sandbox: any = {
        __shaderUniforms: undefined,
        console,
        WebSocket: globalThis.WebSocket,
        Uint32Array,
        ArrayBuffer,
        TextEncoder,
        TextDecoder,
        setTimeout: (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
          if (!lifetime.active) {
            return;
          }
          const timer = setTimeout(() => {
            this.scriptTimeouts.delete(timer);
            if (!lifetime.active) {
              return;
            }
            try {
              callback(...args);
            } catch (error) {
              this.logger.warn(`Script timer error: ${String(error)}`);
            }
          }, delay);
          this.scriptTimeouts.add(timer);
          return timer;
        },
        setInterval: (callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
          if (!lifetime.active) {
            return;
          }
          const timer = setInterval(() => {
            if (!lifetime.active) {
              return;
            }
            try {
              callback(...args);
            } catch (error) {
              this.logger.warn(`Script timer error: ${String(error)}`);
            }
          }, delay);
          this.scriptIntervals.add(timer);
          return timer;
        },
        clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
          clearTimeout(timer); this.scriptTimeouts.delete(timer);
        },
        clearInterval: (timer: ReturnType<typeof setInterval>) => {
          clearInterval(timer); this.scriptIntervals.delete(timer);
        },
        // Allow require for Node.js modules (resolves from script's directory)
        require: scriptRequire,
      };
      vm.createContext(sandbox);

      // Run the IIFE bundle
      const script = new vm.Script(bundleCode + "\n", { filename: "uniforms-script.js" });
      script.runInContext(sandbox);

      const module = sandbox.__shaderUniforms;
      if (typeof module?.uniforms !== 'function' && typeof module?.streams !== 'function') {
        throw new Error("Script must export a uniforms(ctx) or streams(ctx) function");
      }

      this.uniformsFn = typeof module.uniforms === 'function' ? module.uniforms : null;
      if (typeof module.streams === 'function') {
        if (!allowStreams) {
          throw new Error('Script streams require Slang / WebGPU');
        }
        const streamContext = {
          stream: (options?: ConstructorParameters<typeof ScriptStream>[0]) => {
            if (!lifetime.active) {
              throw new Error('Script was disposed');
            }
            const stream = new ScriptStream(options);
            this.createdStreams.add(stream);
            return stream;
          },
          onDispose: (cleanup: () => void) => {
            if (typeof cleanup !== 'function') {
              throw new Error('onDispose expects a function');
            }
            if (lifetime.active) {
              this.cleanups.push(cleanup);
            } else {
              cleanup();
            }
          },
        };
        const streams = module.streams(streamContext);
        if (!streams || typeof streams !== 'object' || Array.isArray(streams) || typeof streams.then === 'function') {
          throw new Error('streams(ctx) must synchronously return a named object');
        }
        if (Object.keys(streams).length > 8) {
          throw new Error('Scripts support at most 8 streams');
        }
        const registered = new Set<ScriptStream>();
        for (const [name, stream] of Object.entries(streams)) {
          this.validateName(name);
          if (!(stream instanceof ScriptStream) || !this.createdStreams.has(stream) || registered.has(stream)) {
            throw new Error(`Stream ${name} must be a unique ctx.stream() from this load`);
          }
          this.streams.set(name, stream);
          registered.add(stream);
        }
        for (const stream of this.createdStreams) {
          if (!registered.has(stream)) {
            stream.dispose();
          }
        }
      }

      // Initial call to infer types
      const dummyCtx = {
        ...scriptUniformHelpers,
        iTime: 0, iTimeDelta: 0, iFrameRate: 60, iFrame: 0,
        iResolution: [800, 600, 800 / 600],
        iMouse: [0, 0, 0, 0],
        iDate: [2026, 1, 1, 0],
        iChannelTime: [0, 0, 0, 0],
        iSampleRate: 44100,
      };

      const result = this.uniformsFn?.(dummyCtx) ?? (this.uniformsFn ? null : {});
      if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.then === 'function') {
        throw new Error("uniforms(ctx) must synchronously return an object");
      }

      const declLines: string[] = [];
      const uniformTypes: CustomUniformType[] = [];

      for (const [name, value] of Object.entries(result)) {
        this.validateName(name);
        if (this.streams.has(name)) {
          throw new Error(`Uniform and stream names conflict: ${name}`);
        }
        const type = this.inferType(value);
        if (!type) {
          continue;
        }

        this.inferredTypes[name] = type;
        declLines.push(scriptUniformDeclaration(name, type));
        uniformTypes.push({ name, type: type as CustomUniformType['type'] });
      }

      return { declarations: declLines.join("\n"), uniforms: uniformTypes, streams: this.getStreamInfo(), session: this.session };
    } catch (err: any) {
      this.dispose();
      this.uniformsFn = null;
      return { declarations: "", uniforms: [], error: `Script evaluation error: ${err?.message || err}` };
    }
  }

  /**
   * Start polling the uniforms function and sending values via callback.
   * Uses drift-corrected setTimeout to maintain target cadence.
   */
  public startPolling(onValues: (values: CustomUniformValue[]) => void, intervalMs: number = 33): void {
    this.stop();
    this.onValues = onValues;
    this.currentIntervalMs = intervalMs;
    this.startTime = Date.now();

    this.startPollLoop();
  }

  /**
   * Change the polling interval without resetting the shader time or reloading the script.
   */
  public updatePollingRate(intervalMs: number): void {
    if (intervalMs === this.currentIntervalMs) {
      return;
    }
    this.currentIntervalMs = intervalMs;

    // If currently polling, restart the loop with the new interval
    if (this.pollTimer && this.onValues) {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      this.startPollLoop();
    }
  }

  /**
   * Reset the script time origin (e.g., when shader is reset).
   */
  public resetTime(): void {
    this.startTime = Date.now();
    for (const stream of this.streams.values()) {
      stream.clear();
    }
    for (const client of this.clients.values()) {
      client.pending = null;
    }
    this.sequence++;
  }

  private startPollLoop(): void {
    if (!this.uniformsFn || Object.keys(this.inferredTypes).length === 0) {
      return;
    }

    const intervalMs = this.currentIntervalMs;
    let nextTickAt = Date.now() + intervalMs;

    const tick = () => {
      if (!this.pollTimer) {
        return;
      }

      const allValues = this.evaluate(this.startTime);
      const changed = this.getChangedValues(allValues);
      if (changed.length > 0) {
        this.lastValues = allValues;
        this.onValues?.(changed);
      }

      // Drift-correct: advance by exact interval, snap if fallen behind
      nextTickAt += this.currentIntervalMs;
      const now = Date.now();
      if (nextTickAt < now - this.currentIntervalMs) {
        nextTickAt = now + this.currentIntervalMs;
      }
      const delay = Math.max(1, nextTickAt - now);
      this.pollTimer = setTimeout(tick, delay);
    };

    // Send initial values immediately — but only if changed (or first time ever)
    const initial = this.evaluate(this.startTime);
    const initialChanged = this.getChangedValues(initial);
    if (initialChanged.length > 0) {
      this.lastValues = initial;
      this.onValues?.(initialChanged);
    }
    this.pollTimer = setTimeout(tick, intervalMs);
  }

  /**
   * Stop polling.
   */
  public stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.onValues = null;
  }

  public getLastValues(): CustomUniformValue[] {
    return this.lastValues;
  }

  public hasUniforms(): boolean {
    return Object.keys(this.inferredTypes).length > 0;
  }

  public getStreamInfo(): ScriptStreamInfo[] {
    return [...this.streams].map(([name, stream]) => ({ name, maxPerFrame: stream.maxPerFrame, maxQueued: stream.maxQueued }));
  }

  public requestStreamFrame(session: number, acknowledgedSequence?: number, consumer = 'default'): ScriptStreamFrame | null {
    if (session !== this.session || this.streams.size === 0) {
      return null;
    }
    let client = this.clients.get(consumer);
    if (!client) {
      if (this.clients.size >= 16) {
        throw new Error('A script supports at most 16 stream previews. Close unused previews.');
      }
      client = { streams: new Map([...this.streams].map(([name, stream]) => [name, stream.fork()])), pending: null };
      this.clients.set(consumer, client);
    }
    if (client.pending && acknowledgedSequence === client.pending.sequence) {
      for (const chunk of client.pending.streams) {
        client.streams.get(chunk.name)!.consume(chunk.data.length);
      }
      client.pending = null;
    }
    client.pending ??= { session: this.session, sequence: ++this.sequence,
      streams: [...client.streams].map(([name, stream]) => ({ name, data: stream.peek(), queued: stream.queued })) };
    return client.pending;
  }

  public getStreamQueues(session: number, consumer: string): { name: string; queued: number }[] | null {
    if (session !== this.session || this.streams.size === 0) {
      return null;
    }
    return [...(this.clients.get(consumer)?.streams ?? this.streams)].map(([name, stream]) => ({ name, queued: stream.queued }));
  }

  public releaseStreamConsumer(session: number, consumer: string): void {
    if (session !== this.session) {
      return;
    }
    const client = this.clients.get(consumer);
    if (!client) {
      return;
    }
    for (const [name, stream] of client.streams) {
      this.streams.get(name)?.release(stream);
    }
    this.clients.delete(consumer);
  }

  private validateName(name: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.startsWith('gl_') || name.includes('__') || /^i(?:Channel|Ch)\d+$/.test(name) || /^_(?:st|dbg|scriptStream|ScriptStream)/.test(name) || ScriptEvaluator.BUILTIN_UNIFORMS.has(name)) {
      throw new Error(`Script output names conflict with built-ins or are invalid: ${name}`);
    }
  }

  public dispose(): void {
    this.lifetime.active = false;
    for (const timer of this.scriptTimeouts) {
      clearTimeout(timer);
    }
    for (const timer of this.scriptIntervals) {
      clearInterval(timer);
    }
    this.scriptTimeouts.clear();
    this.scriptIntervals.clear();
    this.stop();
    for (const stream of this.createdStreams) {
      stream.dispose();
    }
    this.createdStreams.clear();
    this.streams.clear();
    this.clients.clear();
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        this.logger.warn(`Script cleanup error: ${String(error)}`);
      }
    }
    this.uniformsFn = null;
    this.inferredTypes = {};
    this.lastValues = [];
  }

  private evaluate(startTime: number): CustomUniformValue[] {
    if (!this.uniformsFn) {
      return [];
    }

    const now = Date.now();
    const elapsed = (now - startTime) / 1000;
    const date = new Date();

    const ctx = {
      ...scriptUniformHelpers,
      iTime: elapsed,
      iTimeDelta: 0.033,
      iFrameRate: 30,
      iFrame: Math.floor(elapsed * 30),
      iResolution: [800, 600, 800 / 600],
      iMouse: [0, 0, 0, 0],
      iDate: [date.getFullYear(), date.getMonth(), date.getDate(),
        date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()],
      iChannelTime: [0, 0, 0, 0],
      iSampleRate: 44100,
    };

    try {
      const result = this.uniformsFn(ctx);
      if (!result || typeof result !== 'object') {
        return this.getZeroValues();
      }

      const values: CustomUniformValue[] = [];
      for (const [name, expectedType] of Object.entries(this.inferredTypes)) {
        const value = result[name];
        if (value === undefined) {
          continue;
        }

        const actualType = this.inferType(value);
        if (actualType !== expectedType) {
          this.logger.warn(`Script uniform ${name} changed type or array length (${expectedType} to ${actualType}); reload the script to change its shape`);
          continue;
        }

        values.push({ name, type: expectedType, value: readScriptUniform(value)!.value });
      }
      return values;
    } catch (err: any) {
      this.logger.warn(`Script runtime error: ${err?.message || err}`);
      return this.getZeroValues();
    }
  }

  private getZeroValues(): CustomUniformValue[] {
    return Object.entries(this.inferredTypes).map(([name, type]) => {
      const value = zeroScriptUniform(type);
      return { name, type, value };
    });
  }

  private getChangedValues(newValues: CustomUniformValue[]): CustomUniformValue[] {
    if (this.lastValues.length === 0) {
      return newValues;
    }
    const changed: CustomUniformValue[] = [];
    for (const a of newValues) {
      const b = this.lastValues.find(v => v.name === a.name);
      if (!b) {
        changed.push(a);
        continue;
      }
      if (Array.isArray(a.value) && Array.isArray(b.value)) {
        let diff = false;
        for (let j = 0; j < a.value.length; j++) {
          if (a.value[j] !== (b.value as number[])[j]) {
            diff = true; break;
          }
        }
        if (diff) {
          changed.push(a);
        }
      } else if (a.value !== b.value) {
        changed.push(a);
      }
    }
    return changed;
  }

  private inferType(value: unknown): ScriptUniformType | null {
    return readScriptUniform(value)?.type ?? null;
  }
}
