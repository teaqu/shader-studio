import * as vm from "vm";
import { createRequire } from "module";
import { Logger } from "./services/Logger";

export interface CustomUniformType {
  name: string;
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'bool';
}

export interface CustomUniformValue {
  name: string;
  type: string;
  value: number | number[] | boolean;
}

/**
 * What the viewer is actually showing. The script runs in the extension host,
 * which has no clock of the shader's own: without this it invents one from wall
 * time, so `ctx.iTime` marches on through a pause and diverges from the `iTime`
 * the shader sees the moment anyone pauses, scrubs, or resets.
 */
export interface ScriptRuntimeState {
  paused: boolean;
  time: number;
  frame: number;
  frameRate: number;
  resolution: [number, number, number];
  mouse: [number, number, number, number];
  channelTimes: number[];
  sampleRate: number;
}

export interface ScriptLoadResult {
  declarations: string;
  uniforms: CustomUniformType[];
  error?: string;
}

/**
 * Evaluates custom uniform scripts in the extension host (Node.js context).
 * This allows scripts to use Node.js APIs and npm packages.
 */
export class ScriptEvaluator {
  private logger = Logger.getInstance();
  private uniformsFn: ((ctx: any) => Record<string, any>) | null = null;
  private inferredTypes: Record<string, string> = {};
  private pollTimer: NodeJS.Timeout | null = null;
  private lastValues: CustomUniformValue[] = [];
  private onValues: ((values: CustomUniformValue[]) => void) | null = null;
  private currentIntervalMs = 33;
  private startTime = Date.now();
  private runtimeState: (ScriptRuntimeState & { syncedAt: number }) | null = null;

  private static readonly BUILTIN_UNIFORMS = new Set([
    'iResolution', 'iTime', 'iTimeDelta', 'iFrameRate', 'iMouse',
    'iFrame', 'iDate', 'iChannelTime', 'iSampleRate',
    'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3',
    'iChannelResolution', 'iCh0', 'iCh1', 'iCh2', 'iCh3',
  ]);

  /**
   * Load and evaluate a bundled script in Node.js context.
   * @param scriptPath - path to the original script file, used to resolve require() from the script's directory
   */
  public loadScript(bundleCode: string, scriptPath?: string): ScriptLoadResult {
    this.stop();
    this.uniformsFn = null;
    this.inferredTypes = {};
    this.lastValues = [];

    try {
      // Create a require function that resolves from the script's directory
      const scriptRequire = scriptPath ? createRequire(scriptPath) : require;

      // Create a sandbox with require support
      const sandbox: any = {
        __shaderUniforms: undefined,
        console,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        // Allow require for Node.js modules (resolves from script's directory)
        require: scriptRequire,
      };
      vm.createContext(sandbox);

      // Run the IIFE bundle
      const script = new vm.Script(bundleCode + "\n", { filename: "uniforms-script.js" });
      script.runInContext(sandbox);

      const module = sandbox.__shaderUniforms;
      if (typeof module?.uniforms !== 'function') {
        return { declarations: "", uniforms: [], error: "Script must export a uniforms(ctx) function" };
      }

      this.uniformsFn = module.uniforms;

      // Initial call to infer types
      const dummyCtx = {
        iTime: 0, iTimeDelta: 0, iFrameRate: 60, iFrame: 0,
        iResolution: [800, 600, 800 / 600],
        iMouse: [0, 0, 0, 0],
        iDate: [2026, 1, 1, 0],
        iChannelTime: [0, 0, 0, 0],
        iSampleRate: 44100,
      };

      const result = this.uniformsFn!(dummyCtx);
      if (!result || typeof result !== 'object') {
        this.uniformsFn = null;
        return { declarations: "", uniforms: [], error: "uniforms(ctx) must return an object" };
      }

      const collisions: string[] = [];
      const declLines: string[] = [];
      const uniformTypes: CustomUniformType[] = [];

      for (const [name, value] of Object.entries(result)) {
        if (ScriptEvaluator.BUILTIN_UNIFORMS.has(name)) {
          collisions.push(name);
          continue;
        }
        const type = this.inferType(value);
        if (!type) {
          continue;
        }

        this.inferredTypes[name] = type;
        declLines.push(`uniform ${type} ${name};`);
        uniformTypes.push({ name, type: type as CustomUniformType['type'] });
      }

      if (collisions.length > 0) {
        this.uniformsFn = null;
        return {
          declarations: "",
          uniforms: [],
          error: `Custom uniform name(s) conflict with built-ins: ${collisions.join(', ')}`,
        };
      }

      return { declarations: declLines.join("\n"), uniforms: uniformTypes };
    } catch (err: any) {
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
    // Batches after the first carry only what changed, so a fresh consumer has
    // to be given everything: it knows nothing of what the last one was sent.
    this.lastValues = [];
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
    if (this.runtimeState) {
      this.runtimeState = { ...this.runtimeState, time: 0, frame: 0, syncedAt: Date.now() };
    }
  }

  /** A finite number, or the fallback: NaN passes `typeof === "number"`. */
  private static finite(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  /** Exactly `length` finite numbers, padding or truncating whatever arrived. */
  private static numbers(value: unknown, length: number): number[] {
    const source = Array.isArray(value) ? value : [];
    return Array.from({ length }, (_, index) => ScriptEvaluator.finite(source[index], 0));
  }

  private static normalizeRuntimeState(
    state: Partial<ScriptRuntimeState> | null | undefined,
  ): ScriptRuntimeState {
    return {
      // Only a real `true` pauses: a truthy string from a stray sender would
      // otherwise stop the script for good.
      paused: state?.paused === true,
      time: ScriptEvaluator.finite(state?.time, 0),
      frame: ScriptEvaluator.finite(state?.frame, 0),
      frameRate: ScriptEvaluator.finite(state?.frameRate, 30),
      sampleRate: ScriptEvaluator.finite(state?.sampleRate, 44100),
      resolution: ScriptEvaluator.numbers(state?.resolution, 3) as [number, number, number],
      mouse: ScriptEvaluator.numbers(state?.mouse, 4) as [number, number, number, number],
      channelTimes: ScriptEvaluator.numbers(state?.channelTimes, 4),
    };
  }

  /**
   * Take the viewer's word for what the shader is doing. A paused shader is not
   * asking for values, and a script call is free to touch hardware or the
   * network, so the loop stops with the picture rather than running under it.
   *
   * The report arrives as plain JSON over a socket, so it is normalised here
   * rather than vetted at the router: a field that is missing or nonsense gets
   * a default, and the report is still acted on. Dropping the whole report
   * instead would throw away the pause flag - the part that matters - whenever
   * a sender is a version behind on the rest.
   */
  public setRuntimeState(state: Partial<ScriptRuntimeState> | null | undefined): void {
    const wasPaused = this.runtimeState?.paused ?? false;
    const normalized = ScriptEvaluator.normalizeRuntimeState(state);
    this.runtimeState = { ...normalized, syncedAt: Date.now() };

    if (normalized.paused === wasPaused) {
      return;
    }
    if (normalized.paused) {
      this.suspendPollLoop();
    } else if (this.onValues) {
      this.startPollLoop();
    }
  }

  /** Stops the timer while keeping the callback, so the loop can resume. */
  private suspendPollLoop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startPollLoop(): void {
    if (!this.uniformsFn || Object.keys(this.inferredTypes).length === 0) {
      return;
    }
    if (this.runtimeState?.paused) {
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

  /**
   * Every uniform the script produces right now, not just the ones that moved.
   * The poll loop emits deltas, so this is what a client that lost its uniform
   * state has to be given to get its constants back. Answers while the shader
   * is paused too - a paused picture still has to be drawn with the values the
   * script last stood at.
   */
  public currentValues(): CustomUniformValue[] {
    if (!this.uniformsFn) {
      return [];
    }
    // The renderer is frozen while paused, so a request to restore a rebuilt
    // uniform manager must restore the last poll's snapshot. Re-evaluating
    // here could both change a stateful value and run arbitrary user code
    // while the picture is paused. There is no snapshot only on startup; take
    // that one initial reading so a shader opened paused still gets constants.
    if (this.runtimeState?.paused && this.lastValues.length > 0) {
      return this.lastValues;
    }
    const values = this.evaluate(this.startTime);
    if (values.length > 0) {
      this.lastValues = values;
    }
    return values;
  }

  public hasUniforms(): boolean {
    return Object.keys(this.inferredTypes).length > 0;
  }

  public dispose(): void {
    this.stop();
    this.uniformsFn = null;
    this.inferredTypes = {};
    this.lastValues = [];
  }

  /**
   * The shader's own time and inputs where the viewer has reported them, and
   * this evaluator's wall clock only until the first report arrives - a script
   * is loaded and type-inferred before the first frame is ever drawn.
   */
  private shaderContext(startTime: number): {
    iTime: number;
    iTimeDelta: number;
    iFrameRate: number;
    iFrame: number;
    iResolution: number[];
    iMouse: number[];
    iChannelTime: number[];
    iSampleRate: number;
  } {
    const state = this.runtimeState;
    if (!state) {
      const elapsed = (Date.now() - startTime) / 1000;
      return {
        iTime: elapsed,
        iTimeDelta: 0.033,
        iFrameRate: 30,
        iFrame: Math.floor(elapsed * 30),
        iResolution: [800, 600, 800 / 600],
        iMouse: [0, 0, 0, 0],
        iChannelTime: [0, 0, 0, 0],
        iSampleRate: 44100,
      };
    }

    // Between syncs the shader keeps running, so time is carried forward from
    // the last report rather than held at it. A paused shader carries nothing.
    const sinceSync = state.paused ? 0 : (Date.now() - state.syncedAt) / 1000;
    const frameRate = state.frameRate > 0 ? state.frameRate : 30;
    return {
      iTime: state.time + sinceSync,
      iTimeDelta: 1 / frameRate,
      iFrameRate: frameRate,
      iFrame: state.frame + Math.floor(sinceSync * frameRate),
      iResolution: [...state.resolution],
      iMouse: [...state.mouse],
      iChannelTime: [...state.channelTimes],
      iSampleRate: state.sampleRate,
    };
  }

  private evaluate(startTime: number): CustomUniformValue[] {
    if (!this.uniformsFn) {
      return [];
    }

    const date = new Date();
    const ctx = {
      ...this.shaderContext(startTime),
      iDate: [date.getFullYear(), date.getMonth(), date.getDate(),
        date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()],
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
          continue;
        }

        values.push({ name, type: expectedType, value });
      }
      return values;
    } catch (err: any) {
      this.logger.warn(`Script runtime error: ${err?.message || err}`);
      return this.getZeroValues();
    }
  }

  private getZeroValues(): CustomUniformValue[] {
    return Object.entries(this.inferredTypes).map(([name, type]) => {
      let value: number | number[] | boolean;
      switch (type) {
        case 'float': value = 0; break;
        case 'vec2': value = [0, 0]; break;
        case 'vec3': value = [0, 0, 0]; break;
        case 'vec4': value = [0, 0, 0, 0]; break;
        case 'bool': value = false; break;
        default: value = 0;
      }
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

  private inferType(value: any): string | null {
    if (typeof value === 'number') {
      return 'float';
    }
    if (typeof value === 'boolean') {
      return 'bool';
    }
    if (Array.isArray(value)) {
      switch (value.length) {
        case 2: return 'vec2';
        case 3: return 'vec3';
        case 4: return 'vec4';
      }
    }
    return null;
  }
}
