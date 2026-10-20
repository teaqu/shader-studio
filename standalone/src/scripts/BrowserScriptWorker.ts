import { transform } from 'sucrase';
import { ScriptRuntime } from '@shader-studio/utils';
import type { ScriptRuntimeState } from '@shader-studio/utils';
import type { BrowserScriptMessage } from './BrowserScriptSession';

/** Browser worker adapter; no Node require, DOM, or workspace access is exposed. */
export class BrowserScriptWorker {
  private keyboard = new Set<(event: unknown) => void>();
  private readonly runtime: ScriptRuntime;
  constructor(private readonly send: (message: BrowserScriptMessage) => void, globals: Record<string, unknown> = {}) {
    this.runtime = new ScriptRuntime({
      warn: message => send({ type: 'warning', payload: [message] }),
      globals,
      streamContext: {
        onKeyboard: (listener: (event: unknown) => void) => {
          if (typeof listener !== 'function') {
            throw new Error('onKeyboard expects a function');
          }
          this.keyboard.add(listener);
          return () => this.keyboard.delete(listener);
        },
      },
      evaluate(code, scope) {
        const compiled = transform(code, { transforms: ['typescript', 'imports'], disableESTransforms: true }).code;
        const module = { exports: {} };
        const require = (name: string) => {
          throw new Error(`Browser scripts cannot import ${name}. Use browser APIs and self-contained JS/TS scripts.`);
        };
        // User opted into running workspace code. It executes inside its worker.
        new Function(...Object.keys(scope), 'module', 'exports', 'require', compiled)(...Object.values(scope), module, module.exports, require);
        return module.exports;
      },
    });
  }

  handle(message: BrowserScriptMessage): void {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    switch (message.type) {
      case 'load': {
        this.keyboard.clear();
        const result = this.runtime.loadScript(String(message.code), String(message.path), message.allowStreams === true);
        if (result.error) {
          this.keyboard.clear();
        }
        this.send({ type: 'loaded', result, ...(message.snapshot === true && !result.error ? {values: this.runtime.currentValues()} : {}) }); return;
      }
      case 'start':
        this.runtime.startPolling(values => this.send({ type: 'customUniformValues', payload: { values } }), this.interval(payload.fps)); return;
      case 'requestCustomUniformValues':
        this.send({ type: 'customUniformValues', payload: { values: this.runtime.currentValues() } }); return;
      case 'scriptRuntimeState':
        this.runtime.setRuntimeState(payload as Partial<ScriptRuntimeState>); return;
      case 'resetScriptTime': this.runtime.resetTime(); return;
      case 'updateScriptPollingRate': this.runtime.updatePollingRate(this.interval(payload.fps)); return;
      case 'requestScriptStreamFrame': this.streamFrame(payload); return;
      case 'scriptKeyboardInput':
        for (const listener of this.keyboard) {
          try {
            listener(payload);
          } catch (error) {
            this.send({ type: 'warning', payload: [`Script keyboard error: ${String(error)}`] });
          }
        }
        return;
      case 'dispose': this.runtime.dispose(); this.keyboard.clear(); this.send({type:'disposed'});
    }
  }

  private interval(fps: unknown): number {
    return 1000 / (typeof fps === 'number' && Number.isFinite(fps) ? Math.min(120, Math.max(1, fps)) : 30);
  }

  private streamFrame(payload: Record<string, unknown>): void {
    const { session, request, consumer, acknowledgedSequence } = payload;
    if (!Number.isSafeInteger(session) || Number(session) < 1 || !Number.isSafeInteger(request) || Number(request) < 1 ||
      typeof consumer !== 'string' || !consumer.length || consumer.length > 128 ||
      (acknowledgedSequence !== undefined && (!Number.isSafeInteger(acknowledgedSequence) || Number(acknowledgedSequence) < 1))) {
      return;
    }
    if (payload.release === true) {
      this.runtime.releaseStreamConsumer(Number(session), consumer); return;
    }
    if (payload.status === true) {
      const streams = this.runtime.getStreamQueues(Number(session), consumer);
      if (streams) {
        this.send({ type: 'scriptStreamStatus', payload: { session, request, consumer, streams } });
      }
      return;
    }
    const frame = this.runtime.requestStreamFrame(Number(session), acknowledgedSequence as number | undefined, consumer);
    if (frame) {
      this.send({ type: 'scriptStreamFrame', payload: { frame, request } });
    }
  }
}
