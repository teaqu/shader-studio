import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoTransport } from '../../lib/transport/DemoTransport';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DemoTransport', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('delivers the bundled GLSL shader after a handler is registered', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();

    transport.onMessage(handler);
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].data).toMatchObject({
      type: 'shaderSource',
      path: '/examples/aurora.glsl',
      language: 'glsl',
      buffers: {},
      config: { version: '1.0', passes: { Image: { inputs: {} } } },
    });
    expect(handler.mock.calls[0][0].data.code).toContain('mainImage');
  });

  it('uses tabs for bundled shader indentation', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    const source = handler.mock.calls[0][0].data.code as string;
    expect(source).toContain('\n\tvec2 uv = fragCoord / iResolution.xy;');
    expect(source).not.toContain('\n  vec2 uv = fragCoord / iResolution.xy;');
  });

  it('enables language services when the editor signals that it is ready', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    transport.postMessage({ type: 'languageServiceReady' });

    expect(handler.mock.calls.at(-1)?.[0].data).toEqual({
      type: 'languageServiceSettings',
      payload: {
        glslEnabled: true,
        slangEnabled: true,
        colorDecorators: true,
        trace: 'off',
      },
    });
  });

  it('re-emits shaderSource with edited code', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    transport.postMessage({
      type: 'updateShaderSource',
      payload: { path: '/examples/aurora.glsl', code: 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }' },
    });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].data).toMatchObject({
      type: 'shaderSource',
      path: '/examples/aurora.glsl',
      code: 'void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }',
    });
  });

  it('updates the shader configuration before re-emitting shaderSource', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    const config = { version: '1.0', passes: { Image: { inputs: {}, resolution: [640, 360] } } };
    transport.postMessage({ type: 'updateConfig', payload: { config, text: '{}' } });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].data).toMatchObject({ type: 'shaderSource', config });
  });

  it('switches to the bundled Slang example', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    transport.postMessage({ type: 'selectDemoExample', payload: { id: 'slang' } });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].data).toMatchObject({
      type: 'shaderSource',
      path: '/examples/nebula.slang',
      language: 'slang',
    });
    expect(handler.mock.calls[1][0].data.code).toContain('Aurora Slang');
    expect(handler.mock.calls[1][0].data.code).toContain('float4 mainImage');
  });

  it.each([
    ['image', '/examples/image.glsl', 'texture', './demo-assets/nebula-texture.png'],
    ['video', '/examples/video.glsl', 'video', './demo-assets/nebula-motion.mp4'],
    ['cubemap', '/examples/cubemap.glsl', 'cubemap', './demo-assets/desert-cubemap-cross.png'],
  ] as const)('switches to the bundled %s asset example', async (id, path, inputType, resolvedPath) => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    transport.postMessage({ type: 'selectDemoExample', payload: { id } });

    expect(handler.mock.calls.at(-1)?.[0].data).toMatchObject({
      type: 'shaderSource',
      path,
      language: 'glsl',
      config: {
        passes: {
          Image: {
            inputs: {
              iChannel0: { type: inputType, resolved_path: resolvedPath },
            },
          },
        },
      },
      pathMap: expect.objectContaining({ [`demo-assets/${resolvedPath.split('/').at(-1)}`]: resolvedPath }),
    });
  });

  it('uses iMouse to rotate the bundled cubemap view', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    transport.postMessage({ type: 'selectDemoExample', payload: { id: 'cubemap' } });

    const code = handler.mock.calls.at(-1)?.[0].data.code as string;
    expect(code).toContain('iMouse.xy');
    expect(code).toContain('rotate');
  });

  it('upgrades the previous bundled cubemap source without replacing user edits', async () => {
    const previousBundledCubemap = `// Bundled cubemap input demo
// iChannel0 is a generated desert skybox cross layout.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  vec3 direction = normalize(vec3(p, 1.5));
  fragColor = vec4(texture(iChannel0, direction).rgb, 1.0);
}`;
    localStorage.setItem('shader-studio-demo-state', JSON.stringify({
      selectedExample: 'cubemap',
      codeByExample: { cubemap: previousBundledCubemap },
      config: { version: '1.0', passes: { Image: { inputs: {} } } },
    }));

    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    expect(handler.mock.calls[0][0].data.code).toContain('Drag in the preview');
  });

  it('restores edited source and the selected example from localStorage', async () => {
    const firstTransport = new DemoTransport();
    firstTransport.postMessage({ type: 'selectDemoExample', payload: { id: 'slang' } });
    firstTransport.postMessage({
      type: 'updateShaderSource',
      payload: { path: '/examples/nebula.slang', code: 'float4 mainImage(float2 p) { return 1; }' },
    });

    const restoredTransport = new DemoTransport();
    const handler = vi.fn();
    restoredTransport.onMessage(handler);
    await flushMicrotasks();

    expect(handler.mock.calls[0][0].data).toMatchObject({
      path: '/examples/nebula.slang',
      language: 'slang',
      code: 'float4 mainImage(float2 p) { return 1; }',
    });
  });

  it('falls back to the bundled GLSL example when saved data is malformed', async () => {
    localStorage.setItem('shader-studio-demo-state', 'not-json');
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();

    expect(handler.mock.calls[0][0].data).toMatchObject({
      path: '/examples/aurora.glsl',
      language: 'glsl',
    });
  });

  it('clears saved changes and restores the bundled GLSL example', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    await flushMicrotasks();
    transport.postMessage({ type: 'selectDemoExample', payload: { id: 'slang' } });

    transport.postMessage({ type: 'resetDemoState' });

    expect(handler.mock.calls.at(-1)?.[0].data).toMatchObject({
      path: '/examples/aurora.glsl',
      language: 'glsl',
    });
    expect(localStorage.getItem('shader-studio-demo-state')).toBeNull();
  });

  it('does not deliver messages after disposal', async () => {
    const transport = new DemoTransport();
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.dispose();
    await flushMicrotasks();

    transport.postMessage({
      type: 'updateShaderSource',
      payload: { path: '/examples/aurora.glsl', code: 'ignored' },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(transport.isConnected()).toBe(false);
  });
});
