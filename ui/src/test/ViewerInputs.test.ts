import { describe, it, expect } from 'vitest';
import { ViewerInputs } from '../lib/ViewerInputs';

function fixture() {
  const current = [{ name: 'color', type: 'vec3', value: [1, 2, 3] }];
  const displayed = [{ name: 'color', type: 'vec3', value: [4, 5, 6] }];
  const mouse: [number, number, number, number] = [40, 50, -3, -4];
  const engine = {
    getUniforms: () => ({ time: 100, timeDelta: 0.02, frameRate: 50, res: [1, 1, 1],
      date: new Float32Array([2026, 9, 15, 123]), cameraPos: [1, 2, 3], cameraDir: [0, 0, -1] }),
    getTimeManager: () => ({ getCurrentTime: () => 2, getFrame: () => 10, isPaused: () => true }),
    getCanvas: () => ({ width: 800, height: 400 }),
    getMouse: () => mouse,
    getChannelTimes: () => [1, 2, 3, 4],
    getAudioSampleRate: () => 48000,
    getCurrentCustomUniforms: () => current,
    getDisplayedCustomUniforms: () => displayed,
  } as unknown as Parameters<ViewerInputs['snapshot']>[0];
  return { engine, current, displayed, mouse, inputs: new ViewerInputs() };
}

describe('ViewerInputs', () => {
  it('reads live Image context without reporting base channel placeholders as effective data', () => {
    const { inputs, engine, mouse } = fixture();
    const snapshot = inputs.snapshot(engine, null);
    expect(snapshot).toMatchObject({ scope: 'live-preview', pass: 'Image', script: { path: null },
      builtins: { iTime: 2, iFrame: 10, iTimeDelta: 0.02, iFrameRate: 50, iResolution: [800, 400, 2],
        iMouse: [40, 50, -3, -4], iChannelTime: [1, 2, 3, 4], iSampleRate: 48000,
        iDate: [2026, 9, 15, 123], iCameraPos: [1, 2, 3], iCameraDir: [0, 0, -1] } });
    expect(snapshot.unavailable).toContain('iChannelResolution');
    expect(snapshot.builtins).not.toHaveProperty('iChannelLoaded');
    mouse[0] = 99;
    expect(snapshot.builtins.iMouse).toEqual([40, 50, -3, -4]);
  });

  it('distinguishes last writer, live values and displayed values without inventing metadata', () => {
    const { inputs, engine, current, displayed } = fixture();
    expect(inputs.snapshot(engine, null).customUniforms[0]).toMatchObject({
      lastWriter: 'unknown', scriptMayOverwrite: false, defaultValue: null, range: null,
      value: [1, 2, 3], pausedValue: [4, 5, 6],
    });
    inputs.record(current, 'script');
    expect(inputs.snapshot(engine, 'controls.ts').customUniforms[0]).toMatchObject({ lastWriter: 'script', scriptMayOverwrite: true });
    inputs.record(current, 'mcp');
    const snapshot = inputs.snapshot(engine, 'controls.ts');
    expect(snapshot.customUniforms[0].lastWriter).toBe('mcp');
    current[0].value[0] = 99;
    displayed[0].value[0] = 98;
    expect(snapshot.customUniforms[0]).toMatchObject({ value: [1, 2, 3], pausedValue: [4, 5, 6] });
    inputs.record(current, 'script');
    expect(inputs.snapshot(engine, 'controls.ts').customUniforms[0].lastWriter).toBe('script');
    inputs.reset();
    expect(inputs.snapshot(engine, null).customUniforms[0].lastWriter).toBe('unknown');
  });

  it('supports scalar/boolean uniforms and an unavailable canvas or camera', () => {
    const { inputs, engine } = fixture();
    engine.getCanvas = () => null;
    engine.getUniforms = () => ({ timeDelta: 0, frameRate: 0, date: [2026, 9, 15, 0] }) as ReturnType<typeof engine.getUniforms>;
    engine.getCurrentCustomUniforms = () => [{ name: 'gain', type: 'float', value: 0 }, { name: 'enabled', type: 'bool', value: false }];
    engine.getDisplayedCustomUniforms = () => [];
    const snapshot = inputs.snapshot(engine, null);
    expect(snapshot.builtins.iResolution).toEqual([0, 0, 1]);
    expect(snapshot.builtins).not.toHaveProperty('iCameraPos');
    expect(snapshot.builtins).not.toHaveProperty('iCameraDir');
    expect(snapshot.customUniforms.map(value => value.pausedValue)).toEqual([0, false]);
    engine.getTimeManager = () => ({ isPaused: () => false, getCurrentTime: () => 1, getFrame: () => 2 }) as unknown as ReturnType<typeof engine.getTimeManager>;
    expect(inputs.snapshot(engine, null).customUniforms.map(value => value.pausedValue)).toEqual([null, null]);
  });
});
