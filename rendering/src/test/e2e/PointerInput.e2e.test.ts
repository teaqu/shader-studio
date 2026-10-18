import { describe, expect, it, vi } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { createDefaultWorkspaceFiles } from '../../../../standalone/src/defaultWorkspace';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

describe.each(['glsl', 'slang', 'wgsl'] as const)('%s pointer uniforms', language => {
  it('renders button/modifier/wheel state, consumes edges, and freezes while paused', { timeout: 30_000 }, async () => {
    const expression = 'iPointer.held == 2 && iPointer.pressed == 2 && iPointer.modifiers == 1';
    const hover = 'iPointer.position.x > 0.0 && iPointer.inside == 1';
    const wheel = 'iPointer.wheelDelta.y == 16.0 && iPointer.wheel.y == 16.0';
    const image = language === 'wgsl'
      ? `fn mainImage(p: vec2f) -> vec4f { return vec4f(select(0.0, 1.0, ${expression}), select(0.0, 1.0, ${hover}), select(0.0, 1.0, ${wheel}), 1.0); }`
      : language === 'slang'
        ? `float4 mainImage(float2 p) { return float4(${expression} ? 1.0 : 0.0, ${hover} ? 1.0 : 0.0, ${wheel} ? 1.0 : 0.0, 1.0); }`
        : `void mainImage(out vec4 c, in vec2 p) { c = vec4(${expression} ? 1.0 : 0.0, ${hover} ? 1.0 : 0.0, ${wheel} ? 1.0 : 0.0, 1.0); }`;
    const harness = createShaderCanvasHarness(language);
    harness.canvas.setPointerCapture = () => {};
    try {
      await harness.compile({ image });
      const rect = harness.canvas.getBoundingClientRect();
      harness.canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 2, button: 2, shiftKey: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      const event = new WheelEvent('wheel', { deltaY: 1, deltaMode: 1, shiftKey: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
      harness.canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect((await harness.renderAndReadPixels())[0]).toEqual([255, 255, 255, 255]);
      expect((await harness.renderAndReadPixels())[0]).toEqual([0, 255, 0, 255]);
      harness.engine.togglePause();
      expect((await harness.renderAndReadPixels())[0]).toEqual([0, 255, 0, 255]);
      harness.canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 0, clientX: rect.right + 10, clientY: rect.bottom + 10 }));
      expect((await harness.renderAndReadPixels())[0]).toEqual([0, 255, 0, 255]);
      harness.engine.togglePause();
      expect((await harness.renderAndReadPixels())[0]).toEqual([0, 0, 0, 255]);
    } finally {
      harness.dispose();
    }
  });
});

describe('Particle Swarm pointer forces', () => {
  it.each([1, 2, 3])('attracts with left and repels with right (buttons=%i)', { timeout: 30_000 }, async buttons => {
    const files = createDefaultWorkspaceFiles();
    const read = (path: string) => files.find(file => file.path === path)!.contents;
    const config = JSON.parse(read('/particle-swarm.sha.json')) as ShaderConfig;
    const common = read('/particle-swarm/common.buffer.wgsl');
    // Isolate the bundled pointer force from the ambient flow, with a fixed
    // integration step because the harness deliberately freezes elapsed time.
    const kernels = read('/particle-swarm/swarm.buffer.wgsl')
      .replace('let dt = clamp(iTimeDelta, 0.0, 0.05);', 'let dt = 1.0 / 60.0;')
      .replace('var desired = flowField(position * aspect, iTime) * 0.08;', 'var desired = vec2f(0.0);');
    const harness = createShaderCanvasHarness('wgsl');
    harness.resize(100, 100);
    const capture = vi.spyOn(harness.canvas, 'setPointerCapture').mockImplementation(() => {});
    try {
      await harness.compile({
        config, buffers: { common, Seed: kernels, Fade: kernels, Advect: kernels },
        image: `fn mainImage(coord: vec2f) -> vec4f {
          let particle = particles[0];
          let toward = iPointer.position / iResolution.xy - particle.xy;
          let force = dot(particle.zw, toward);
          return vec4f(select(0.0, 1.0, force < 0.0), select(0.0, 1.0, force > 0.0), 0.0, 1.0);
        }`,
      });
      const rect = harness.canvas.getBoundingClientRect();
      harness.canvas.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1, buttons, button: buttons === 1 ? 0 : 2,
        clientX: rect.left + rect.width * 0.75, clientY: rect.top + rect.height * 0.75,
      }));
      const pixels = await harness.renderAndReadPixels();
      expect(pixels[0]).toEqual(buttons === 1 ? [0, 255, 0, 255] : [255, 0, 0, 255]);
    } finally {
      capture.mockRestore(); harness.dispose();
    }
  });
});
