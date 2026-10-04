import type { WgslProjectTraceRequest, WgslProjectTraceTarget, WgslTraceRecording } from '@shader-studio/types';
import { untrack } from 'svelte';
import type { Transport } from './transport/MessageTransport';
import { getInspectorState } from './state/pixelInspectorState.svelte';
import { getWgslTraceState, registerWgslTraceControls, registerWgslTraceStartHandler, setWgslTraceState } from './state/wgslTraceState.svelte';

interface TraceEngine {
  getShaderLanguage(): string;
  getWgslTraceTargets?(): WgslProjectTraceTarget[];
  captureWgslProjectTrace?(request: WgslProjectTraceRequest, signal?: AbortSignal): Promise<WgslTraceRecording>;
  getCanvas?(): Pick<HTMLCanvasElement, 'width' | 'height'> | null;
  getCaptureUniforms(): { res: number[] };
}
interface Dependencies {
  transport: Pick<Transport, 'getType' | 'postMessage'>;
  getEngine: () => TraceEngine | undefined;
  getViewerSession: () => WgslTraceViewerSession;
}
export interface WgslTraceViewerSession {
  isCurrentPreviewSource: boolean;
  sources?: Array<{ path: string; source: string }>;
}

/** Captures an installed pass on the preview GPU before handing the immutable recording to DAP. */
export class WgslTraceLaunchManager {
  private readonly stopReactiveRefresh: () => void;
  private readonly unregisterStart: () => void;
  private readonly unregisterControls: () => void;
  private controller: AbortController | null = null;
  private disposed = false;
  private refreshing = false;

  constructor(private readonly dependencies: Dependencies) {
    this.unregisterStart = registerWgslTraceStartHandler(() => void this.start());
    this.unregisterControls = registerWgslTraceControls({ target: key => this.selectTarget(key), invocation: (axis, value) => this.setInvocation(axis, value), vertex: value => this.setVertex(value) });
    this.stopReactiveRefresh = $effect.root(() => {
      $effect(() => this.refresh());
    });
    this.refresh();
  }

  public refresh(): void {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      const prior = untrack(() => getWgslTraceState());
      const targets = this.targets();
      const selectedTarget = targets.some(target => targetKey(target) === prior.selectedTarget)
        ? prior.selectedTarget : targetKey(targets.find(target => target.passName === 'Image' && target.stage === 'fragment') ?? targets[0]);
      const reason = this.reason(targets);
      untrack(() => setWgslTraceState({ ...prior, targets, selectedTarget, available: reason === null, reason }));
    } finally {
      this.refreshing = false;
    }
  }

  public async start(): Promise<void> {
    if (this.disposed || this.controller) {
      return;
    }
    const targets = this.targets();
    const reason = this.reason(targets);
    if (reason) {
      this.publish({ available: false, reason }); return;
    }
    const engine = this.dependencies.getEngine()!;
    const state = getWgslTraceState();
    const target = targets.find(candidate => targetKey(candidate) === state.selectedTarget)!;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ busy: true, reason: null });
    try {
      const recording = await engine.captureWgslProjectTrace!(this.request(target), controller.signal);
      if (!this.disposed && !controller.signal.aborted) {
        this.dependencies.transport.postMessage({ type: 'startWgslTrace', payload: { program: recording.path, source: recording.source, recording } });
      }
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) {
        this.publish({ reason: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }
      if (!this.disposed) {
        this.publish({ busy: false });
      }
    }
  }

  public dispose(): void {
    this.disposed = true; this.controller?.abort(); this.stopReactiveRefresh();
    this.unregisterStart(); this.unregisterControls();
  }

  private targets(): WgslProjectTraceTarget[] {
    const engine = this.dependencies.getEngine();
    return engine?.getShaderLanguage() === 'wgsl' ? engine.getWgslTraceTargets?.() ?? [] : [];
  }
  private reason(targets: readonly WgslProjectTraceTarget[]): string | null {
    if (this.dependencies.transport.getType() === 'web') {
      return 'WGSL tracing is available from VS Code or the connected preview host.';
    }
    if (!this.dependencies.getViewerSession().isCurrentPreviewSource) {
      return 'Refresh the Image preview before tracing; it does not match the current source.';
    }
    if (!this.dependencies.getEngine()?.captureWgslProjectTrace) {
      return 'WGSL tracing requires a ready WebGPU preview.';
    }
    if (!targets.length) {
      return 'This installed WGSL project has no traceable passes.';
    }
    if (!getInspectorState().canvasPosition) {
      return 'Select a pixel to trace.';
    }
    return null;
  }
  private request(target: WgslProjectTraceTarget): WgslProjectTraceRequest {
    const state = getWgslTraceState(); const pixel = getInspectorState().canvasPosition!; const engine = this.dependencies.getEngine()!;
    const canvas = engine.getCanvas?.(); const res = engine.getCaptureUniforms().res;
    const width = canvas?.width || res[0] || target.width; const height = canvas?.height || res[1] || target.height;
    return { passName: target.passName, stage: target.stage, capacity: 4096,
      pixel: [scale(pixel.x, width, target.width), scale(pixel.y, height, target.height)],
      ...(this.dependencies.getViewerSession().sources ? { sources: this.dependencies.getViewerSession().sources } : {}),
      ...(target.stage === 'compute' ? { invocation: [...state.invocation] as [number, number, number] } : {}),
      ...(target.stage === 'vertex' ? { vertexIndex: state.vertexIndex } : {}),
    };
  }
  private selectTarget(key: string): void {
    this.publish({ selectedTarget: key });
  }
  private setInvocation(axis: 0 | 1 | 2, value: number): void {
    const invocation = [...getWgslTraceState().invocation] as [number, number, number]; invocation[axis] = normalized(value); this.publish({ invocation });
  }
  private setVertex(value: number): void {
    this.publish({ vertexIndex: normalized(value) });
  }
  private publish(change: Partial<ReturnType<typeof getWgslTraceState>>): void {
    setWgslTraceState({ ...getWgslTraceState(), ...change });
  }
}
function targetKey(target: WgslProjectTraceTarget | undefined): string | null {
  return target ? `${target.passName}:${target.stage}` : null;
}
function scale(value: number, from: number, to: number): number {
  return Math.min(to - 1, Math.max(0, Math.floor(value * to / from)));
}
function normalized(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
