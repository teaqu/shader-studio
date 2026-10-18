import type { ViewerInputs as InputSnapshot, ViewerUniformValue } from '@shader-studio/types';
import type { RenderingEngineInterface as RenderingEngine } from '@shader-studio/rendering';

type Uniform = { name: string; type: string; value: ViewerUniformValue };
type InputEngine = Pick<RenderingEngine, 'getUniforms' | 'getCanvas' | 'getMouse'
  | 'getChannelTimes' | 'getAudioSampleRate' | 'getCurrentCustomUniforms' | 'getDisplayedCustomUniforms'> & {
  getTimeManager(): Pick<ReturnType<RenderingEngine['getTimeManager']>, 'getCurrentTime' | 'getFrame' | 'isPaused'>;
};
const copyValue = (value: ViewerUniformValue): ViewerUniformValue => Array.isArray(value) ? [...value] : value;

/** Records observed writers without claiming a script's future scheduling state. */
export class ViewerInputs {
  private writers = new Map<string, 'script' | 'mcp'>();

  reset(): void {
    this.writers.clear();
  }

  record(values: readonly Uniform[], writer: 'script' | 'mcp'): void {
    for (const value of values) {
      this.writers.set(value.name, writer);
    }
  }

  snapshot(engine: InputEngine, scriptPath: string | null): InputSnapshot {
    const base = engine.getUniforms();
    const clock = engine.getTimeManager();
    const canvas = engine.getCanvas();
    const width = canvas?.width ?? 0;
    const height = canvas?.height ?? 0;
    const displayed = new Map(engine.getDisplayedCustomUniforms().map(uniform => [uniform.name, uniform.value]));
    const builtins: InputSnapshot['builtins'] = {
      iTime: clock.getCurrentTime(performance.now()),
      iFrame: clock.getFrame(),
      iTimeDelta: base.timeDelta,
      iFrameRate: base.frameRate,
      iResolution: [width, height, height === 0 ? 1 : width / height],
      iMouse: [...engine.getMouse()],
      iDate: Array.from(base.date),
      iChannelTime: [...engine.getChannelTimes()],
      iSampleRate: engine.getAudioSampleRate(),
    };
    // The global getter cannot report per-pass channel bindings or mesh matrices.
    // Do not expose its zero-filled placeholder channel arrays as effective values.
    if (base.cameraPos) {
      builtins.iCameraPos = Array.from(base.cameraPos);
    }
    if (base.cameraDir) {
      builtins.iCameraDir = Array.from(base.cameraDir);
    }
    return {
      scope: 'live-preview', pass: 'Image', builtins,
      unavailable: ['iChannelResolution', 'iChannelLoaded', 'per-pass inputs', 'mesh transforms', 'texture contents'],
      script: { path: scriptPath },
      customUniforms: engine.getCurrentCustomUniforms().map(uniform => ({
        ...uniform,
        value: copyValue(uniform.value),
        pausedValue: clock.isPaused() ? copyValue(displayed.get(uniform.name) ?? uniform.value) : null,
        lastWriter: this.writers.get(uniform.name) ?? 'unknown',
        scriptMayOverwrite: scriptPath !== null,
        defaultValue: null, range: null,
      })),
    };
  }
}
