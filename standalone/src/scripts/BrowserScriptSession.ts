import { configPathForShader, resolveConfiguredPath } from '@shader-studio/types';
import type { ScriptLoadResult } from '@shader-studio/utils';
import { virtualConfiguredPathHost } from '../passSources';

export type BrowserScriptMessage = { type: string; [key: string]: unknown };
interface Options {
  send(message: BrowserScriptMessage): void;
  read(path: string): Promise<string | null>;
  enabled: boolean;
  snapshot?: boolean;
  createWorker?: () => Worker;
}
const SCRIPT_MESSAGES = new Set(['requestScriptStreamFrame', 'requestCustomUniformValues', 'scriptRuntimeState', 'resetScriptTime', 'updateScriptPollingRate', 'scriptKeyboardInput']);

/** One viewer owns one worker; switching, disabling and closing terminate it. */
export class BrowserScriptSession {
  private worker: Worker | null = null;
  private source: BrowserScriptMessage | null = null;
  private signature = '';
  private generation = 0;
  private compileSequence = 0;
  private enabled: boolean;
  private result?: ScriptLoadResult;
  private initialValues: unknown[] = [];
  private loading: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly retiring = new Map<Worker, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: Options) {
    this.enabled = options.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled || this.disposed) {
      return;
    }
    this.enabled = enabled;
    this.stop();
    if (this.source) {
      void this.receive(this.source);
    }
  }

  async receive(message: BrowserScriptMessage): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (message.type !== 'shaderSource') {
      this.options.send(message); return;
    }
    this.source = message;
    const generation = ++this.generation;
    const config = message.config as { script?: unknown; scriptMaxPollingFps?: number } | null;
    if (typeof config?.script !== 'string' || !config.script) {
      this.stop(); this.emitSource(message); return;
    }
    if (!this.enabled) {
      this.stop(); this.fail('Enable workspace scripts in Settings to run this script. Only enable scripts you trust.'); return;
    }
    let path: string;
    let code: string | null;
    try {
      path = resolveConfiguredPath(virtualConfiguredPathHost, configPathForShader(String(message.path)), config.script);
      code = await this.options.read(path);
    } catch (error) {
      if (generation === this.generation) {
        this.stop(); this.fail(String(error));
      }
      return;
    }
    if (generation !== this.generation || this.disposed) {
      return;
    }
    if (code === null) {
      this.stop(); this.fail(`Script not found: ${path}`); return;
    }
    const signature = JSON.stringify([message.path, message.language, path, code]);
    if (signature === this.signature && this.result) {
      this.publish();
      this.handle({ type: 'updateScriptPollingRate', payload: { fps: config.scriptMaxPollingFps ?? 30 } });
      return;
    }
    this.stop();
    this.signature = signature;
    try {
      const worker = this.worker = this.options.createWorker?.() ?? new Worker(new URL('./script.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = event => {
        if (this.worker !== worker || this.disposed) {
          return;
        }
        const response = event.data as BrowserScriptMessage;
        if (response.type === 'loaded') {
          clearTimeout(this.loading); this.loading = undefined;
          this.result = response.result as ScriptLoadResult;
          if (this.result.error) {
            this.stop(); this.fail(String((response.result as ScriptLoadResult).error)); return;
          }
          this.initialValues = Array.isArray(response.values) ? response.values : [];
          this.publish();
          if (this.options.snapshot) {
            return;
          }
          this.handle({ type: 'start', payload: { fps: config.scriptMaxPollingFps ?? 30 } });
        } else {
          this.options.send(response);
        }
      };
      worker.onerror = event => {
        if (this.worker === worker) {
          this.stop(); this.fail(event.message || 'Browser script worker failed');
        }
      };
      this.loading = setTimeout(() => {
        if (this.worker === worker) {
          this.stop(); this.fail('Script initialization timed out');
        }
      }, 5000);
      worker.postMessage({ type: 'load', code, path, allowStreams: message.language === 'slang' || message.language === 'wgsl', snapshot: this.options.snapshot });
    } catch (error) {
      this.stop(); this.fail(String(error));
    }
  }

  handle(message: BrowserScriptMessage): boolean {
    if (!SCRIPT_MESSAGES.has(message.type) && message.type !== 'start') {
      return false;
    }
    this.worker?.postMessage(message);
    return true;
  }

  private emitSource(message: BrowserScriptMessage): void {
    // Script settings and worker loads can change source metadata independently
    // of workspace edits; every delivered source needs a fresh viewer revision.
    this.options.send({ ...message, compileSequence: ++this.compileSequence });
  }

  private publish(): void {
    if (!this.source || !this.result) {
      return;
    }
    this.emitSource({ ...this.source,
      customUniformDeclarations: this.result.declarations, customUniformInfo: this.result.uniforms,
      scriptStreams: this.result.streams ?? [], scriptSession: this.result.session ?? 0,
      ...(this.options.snapshot ? { customUniformValues: this.initialValues } : {}),
    });
  }

  private fail(error: string): void {
    if (this.source) {
      this.emitSource({ ...this.source, scriptBundleError: error,
        customUniformDeclarations: '', customUniformInfo: [], scriptStreams: [], scriptSession: 0 });
    }
  }

  private stop(): void {
    clearTimeout(this.loading); this.loading = undefined;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      const finish = () => {
        clearTimeout(this.retiring.get(worker)); this.retiring.delete(worker);
        worker.terminate();
      };
      worker.onmessage = event => {
        if (event.data?.type === 'disposed') {
          finish();
        }
      };
      worker.onerror = finish;
      this.retiring.set(worker, setTimeout(finish, 250));
      worker.postMessage({ type: 'dispose' });
    }
    this.signature = ''; this.result = undefined; this.initialValues = [];
  }

  dispose(): void {
    this.disposed = true; ++this.generation; this.stop(); this.source = null;
  }
}
