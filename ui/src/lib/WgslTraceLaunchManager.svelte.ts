import {
  validateWgslTraceLaunch,
  type ShaderConfig,
  type WgslTraceFrameUniforms,
  type WgslTraceLaunch,
  type WgslTraceUniform,
} from '@shader-studio/types';
import type { Transport } from './transport/MessageTransport';
import { getInspectorState } from './state/pixelInspectorState.svelte';
import {
  registerWgslTraceStartHandler,
  setWgslTraceState,
} from './state/wgslTraceState.svelte';

export interface WgslTraceViewerSession {
  source: string;
  path: string;
  config: ShaderConfig | null;
  /** The source is the successfully installed Image preview, not a pending editor edit. */
  isCurrentPreviewSource: boolean;
}

interface Dependencies {
  transport: Pick<Transport, 'getType' | 'postMessage'>;
  getEngine: () => TraceEngine | undefined;
  getViewerSession: () => WgslTraceViewerSession;
}

interface TraceEngine {
  getShaderLanguage(): string;
  getCaptureUniforms(): {
    time: number;
    timeDelta: number;
    frameRate: number;
    frame: number;
    res: number[];
    mouse: number[];
    date: number[];
    cameraPos: number[];
    cameraDir: number[];
    sampleRate?: number;
  };
  getCurrentCustomUniforms(): { name: string; type: string; value: number | number[] | boolean }[];
}

/** Creates trace launches from the exact image-preview state currently inspected. */
export class WgslTraceLaunchManager {
  private readonly stopReactiveRefresh: () => void;

  constructor(private readonly dependencies: Dependencies) {
    registerWgslTraceStartHandler(() => this.start());
    this.stopReactiveRefresh = $effect.root(() => {
      $effect(() => this.refresh());
    });
  }

  public refresh(): void {
    const reason = this.reason();
    setWgslTraceState({ available: reason === null, reason });
  }

  public start(): void {
    const reason = this.reason();
    if (reason) {
      setWgslTraceState({ available: false, reason });
      return;
    }
    const launch = this.createLaunch();
    this.dependencies.transport.postMessage({
      type: 'startWgslTrace',
      payload: {
        program: launch.path,
        ...launch,
      },
    });
  }

  public dispose(): void {
    this.stopReactiveRefresh();
    registerWgslTraceStartHandler(null);
  }

  private reason(): string | null {
    const { transport, getEngine, getViewerSession } = this.dependencies;
    if (transport.getType() === 'web') {
      return 'WGSL tracing is available from VS Code or the connected preview host.';
    }
    const engine = getEngine();
    if (!engine || engine.getShaderLanguage() !== 'wgsl') {
      return 'WGSL tracing requires a WebGPU WGSL Image preview.';
    }
    const session = getViewerSession();
    if (!session.path.endsWith('.wgsl') || !session.source.trim()) {
      return 'The preview has no current WGSL source snapshot to trace.';
    }
    if (!session.isCurrentPreviewSource) {
      return 'Refresh the Image preview before tracing; it does not match the current source.';
    }
    const pixel = getInspectorState().canvasPosition;
    if (!pixel) {
      return 'Select a pixel to trace.';
    }
    if (!isSingleFullscreenImage(session.config)) {
      return 'This trace PoC supports one fullscreen Image pass without resources, buffers, or Common code.';
    }
    try {
      this.createLaunch();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'The current preview cannot be traced.';
    }
  }

  private createLaunch(): WgslTraceLaunch {
    const engine = this.dependencies.getEngine()!;
    const session = this.dependencies.getViewerSession();
    const pixel = getInspectorState().canvasPosition!;
    const capture = engine.getCaptureUniforms();
    const launch: WgslTraceLaunch = {
      source: session.source,
      path: session.path,
      width: capture.res[0]!,
      height: capture.res[1]!,
      pixel: [pixel.x, pixel.y],
      time: capture.time,
      frame: capture.frame,
      capacity: 4096,
      customUniforms: copyUniforms(engine.getCurrentCustomUniforms()),
      uniforms: copyFrameUniforms(capture),
    };
    validateWgslTraceLaunch(launch);
    return launch;
  }
}

function copyFrameUniforms(capture: ReturnType<TraceEngine['getCaptureUniforms']>): WgslTraceFrameUniforms {
  return {
    timeDelta: capture.timeDelta,
    frameRate: capture.frameRate,
    mouse: [...capture.mouse],
    date: [...capture.date],
    cameraPos: [...capture.cameraPos],
    cameraDir: [...capture.cameraDir],
    sampleRate: capture.sampleRate ?? 44_100,
  };
}

function copyUniforms(uniforms: ReturnType<TraceEngine['getCurrentCustomUniforms']>): WgslTraceUniform[] {
  return uniforms.map(uniform => ({ ...uniform, value: Array.isArray(uniform.value) ? [...uniform.value] : uniform.value })) as WgslTraceUniform[];
}

function isSingleFullscreenImage(config: ShaderConfig | null): boolean {
  if (!config) {
    return true;
  }
  if (Object.keys(config.storage ?? {}).length > 0) {
    return false;
  }
  const passNames = Object.keys(config.passes).filter(name => config.passes[name] !== undefined);
  if (passNames.length !== 1 || passNames[0] !== 'Image') {
    return false;
  }
  const image = config.passes.Image;
  return !image.inputs || Object.keys(image.inputs).length === 0
    ? !image.geometry || image.geometry.type === 'fullscreen'
      ? !image.vertex
      : false
    : false;
}
