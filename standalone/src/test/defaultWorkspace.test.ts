import { describe, expect, it, vi } from 'vitest';
import { createDefaultWorkspaceFiles } from '../defaultWorkspace';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { WebExtensionHost } from '../WebExtensionHost';

describe('default workspace', () => {
  it('does not seed video shaders or video inputs', () => {
    const files = createDefaultWorkspaceFiles();
    expect(files.filter(({ path }) => /\.(glsl|slang)$/.test(path)).map(({ path }) => path))
      .toEqual([
        '/shaders/aurora.glsl', '/shaders/aurora-slang.slang',
        '/shaders/nebula-texture.glsl', '/shaders/desert-cubemap.glsl',
        '/shaders/glow-trails.glsl', '/shaders/glow-trails/trails.buffer.glsl',
        '/shaders/glow-trails/glow.buffer.glsl',
      ]);
    for (const file of files.filter(({ path }) => path.endsWith('.sha.json'))) {
      const config = JSON.parse(file.contents);
      expect(Object.values(config.passes.Image.inputs).some((input) =>
        (input as { type: string }).type === 'video')).toBe(false);
    }
  });

  it('loads the feedback and blur passes of Glow Trails, including after reload', async () => {
    const files = createDefaultWorkspaceFiles();
    expect(new Set(files.map(({ path }) => path)).size).toBe(files.length);
    const store = new MemoryWorkspaceStore();
    const workspace = await VirtualWorkspace.open(store, files);
    const config = JSON.parse(workspace.readText('/shaders/glow-trails.sha.json'));
    expect(config.passes).toEqual({
      Trails: {
        path: 'glow-trails/trails.buffer.glsl',
        inputs: { iChannel0: { type: 'buffer', source: 'Trails' } },
      },
      Glow: {
        path: 'glow-trails/glow.buffer.glsl',
        inputs: { iChannel0: { type: 'buffer', source: 'Trails' } },
      },
      Image: { inputs: {
        iChannel0: { type: 'buffer', source: 'Trails' },
        iChannel1: { type: 'buffer', source: 'Glow' },
      } },
    });
    for (const loaded of [workspace, await VirtualWorkspace.open(store, [])]) {
      const host = new WebExtensionHost(loaded);
      const receive = vi.fn();
      host.onViewerMessage(receive);
      await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/glow-trails.glsl' });
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({
        type: 'shaderSource',
        path: '/shaders/glow-trails.glsl',
        code: workspace.readText('/shaders/glow-trails.glsl'),
        buffers: {
          Trails: workspace.readText('/shaders/glow-trails/trails.buffer.glsl'),
          Glow: workspace.readText('/shaders/glow-trails/glow.buffer.glsl'),
        },
      }));
    }
  });

  it('names the Slang Aurora shader aurora-slang', () => {
    const files = createDefaultWorkspaceFiles();

    expect(files.find(({ path }) => path === '/shaders/aurora-slang.slang')?.contents)
      .toContain('Shader Studio aurora-slang / WebGPU');
    expect(files.some(({ path }) => path === '/shaders/aurora.slang')).toBe(false);
  });

  it('preserves the display aspect ratio in the cubemap camera direction', () => {
    const cubemapShader = createDefaultWorkspaceFiles().find(
      ({ path }) => path === '/shaders/desert-cubemap.glsl',
    );

    expect(cubemapShader?.contents).toContain(
      'vec2 p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;',
    );
  });
});
