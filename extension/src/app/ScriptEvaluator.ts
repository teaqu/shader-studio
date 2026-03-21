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
        if (!type) continue;

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
    this.onValues = onValues;
    this.currentIntervalMs = intervalMs;
    this.startTime = Date.now();

    this.startPollLoop();
  }

  /**
   * Change the polling interval without resetting the shader time or reloading the script.
   */
  public updatePollingRate(intervalMs: number): void {
    if (intervalMs === this.currentIntervalMs) return;
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
  }

  private startPollLoop(): void {
    if (!this.uniformsFn || Object.keys(this.inferredTypes).length === 0) {
      return;
    }

    const intervalMs = this.currentIntervalMs;
    let nextTickAt = Date.now() + intervalMs;

    const tick = () => {
      if (!this.pollTimer) return;

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

  public dispose(): void {
    this.stop();
    this.uniformsFn = null;
    this.inferredTypes = {};
    this.lastValues = [];
  }

  private evaluate(startTime: number): CustomUniformValue[] {
    if (!this.uniformsFn) return [];

    const now = Date.now();
    const elapsed = (now - startTime) / 1000;
    const date = new Date();

    const ctx = {
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
      if (!result || typeof result !== 'object') return this.getZeroValues();

      const values: CustomUniformValue[] = [];
      for (const [name, expectedType] of Object.entries(this.inferredTypes)) {
        const value = result[name];
        if (value === undefined) continue;

        const actualType = this.inferType(value);
        if (actualType !== expectedType) continue;

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
    if (this.lastValues.length === 0) return newValues;
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
          if (a.value[j] !== (b.value as number[])[j]) { diff = true; break; }
        }
        if (diff) changed.push(a);
      } else if (a.value !== b.value) {
        changed.push(a);
      }
    }
    return changed;
  }

  private inferType(value: any): string | null {
    if (typeof value === 'number') return 'float';
    if (typeof value === 'boolean') return 'bool';
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
