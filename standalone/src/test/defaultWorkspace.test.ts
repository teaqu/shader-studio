import { describe, expect, it, vi } from 'vitest';
import { buildSlangPassGraph } from '@shader-studio/rendering/webgpu/SlangPassGraph';
import { createDefaultWorkspaceFiles } from '../defaultWorkspace';
import { MemoryWorkspaceStore, VirtualWorkspace } from '../VirtualWorkspace';
import { WebExtensionHost } from '../WebExtensionHost';

describe('default workspace', () => {
  it('does not seed video shaders or video inputs', () => {
    const files = createDefaultWorkspaceFiles();
    expect(files.filter(({ path }) => /\.(glsl|slang|wgsl)$/.test(path)).map(({ path }) => path))
      .toEqual([
        '/shaders/aurora.glsl', '/shaders/aurora-slang.slang', '/shaders/aurora-wgsl.wgsl',
        '/shaders/particle-swarm.wgsl', '/shaders/particle-swarm/common.buffer.wgsl',
        '/shaders/particle-swarm/swarm.buffer.wgsl',
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

    expect(files.some(({ path }) => path === '/shaders/aurora-slang.slang')).toBe(true);
    expect(files.some(({ path }) => path === '/shaders/aurora.slang')).toBe(false);
  });

  it('seeds a WGSL Aurora sample shader', () => {
    const files = createDefaultWorkspaceFiles();
    const wgsl = files.find(({ path }) => path === '/shaders/aurora-wgsl.wgsl');

    expect(wgsl).toBeDefined();
    expect(wgsl?.contents).toContain('fn mainImage(coord: vec2f) -> vec4f');
    expect(files.some(({ path }) => path === '/shaders/aurora-wgsl.sha.json')).toBe(true);
  });

  describe('the WGSL Particle Swarm compute sample', () => {
    const files = createDefaultWorkspaceFiles();
    const read = (path: string) => files.find((file) => file.path === path)?.contents ?? '';
    const config = JSON.parse(read('/shaders/particle-swarm.sha.json'));
    const kernels = read('/shaders/particle-swarm/swarm.buffer.wgsl');
    const passSources: Record<string, string> = {
      common: read('/shaders/particle-swarm/common.buffer.wgsl'),
      Seed: kernels,
      Clear: kernels,
      Advect: kernels,
    };

    it('hides its pass sources from the explorer by naming them buffers', () => {
      // The explorer's default "Hide Buffers" filter matches on the file name.
      for (const [name, pass] of Object.entries<{ path?: string }>(config.passes)) {
        if (pass?.path) {
          expect(pass.path.split('/').pop()?.toLowerCase(), `${name} source is listed as a shader`)
            .toContain('buffer');
        }
      }
    });

    it('declares every configured pass source as a seeded file', () => {
      for (const [name, pass] of Object.entries<{ path?: string }>(config.passes)) {
        if (!pass?.path) {
          continue;
        }
        expect(read(`/shaders/${pass.path}`), `${name} source is missing`).not.toBe('');
      }
      expect(Object.keys(passSources).every((name) => passSources[name] !== '')).toBe(true);
    });

    it('sizes the density grid to match the GRID constant in common', () => {
      const grid = /const GRID = vec2u\((\d+)u, (\d+)u\)/.exec(passSources.common);
      expect(grid).not.toBeNull();
      expect(config.storage.density.count).toBe(Number(grid![1]) * Number(grid![2]));
      expect(config.storage.density.elementType).toBe('atomic<u32>');
      expect(kernels).toContain('atomicAdd(&density[densityIndex(position)], 1u);');
      expect(read('/shaders/particle-swarm.wgsl')).toContain('atomicLoad(&density[');
    });

    it('builds a WGSL pass graph with no errors or warnings', () => {
      const graph = buildSlangPassGraph({
        imageCode: read('/shaders/particle-swarm.wgsl'),
        config,
        buffers: passSources,
        canvasWidth: 320,
        canvasHeight: 180,
        language: 'wgsl',
      });

      expect(graph.errors).toEqual([]);
      expect(graph.warnings).toEqual([]);
      expect(graph.storage).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'particles', elementType: 'vec4<f32>', count: 16384 }),
        expect.objectContaining({ name: 'density', elementType: 'atomic<u32>', containsAtomic: true }),
      ]));
      // Seed scatters once, then Clear zeroes the grid before Advect tallies it.
      expect(graph.passes.map(({ name, kind }) => [name, kind])).toEqual([
        ['Seed', 'compute'], ['Clear', 'compute'], ['Advect', 'compute'], ['Image', 'render'],
      ]);
      expect(graph.passes.map(({ name, dispatch, dispatchOnce }) => [name, dispatch, dispatchOnce]))
        .toEqual([
          ['Seed', { mode: 'cover-storage', name: 'particles' }, true],
          ['Clear', { mode: 'cover-storage', name: 'density' }, false],
          ['Advect', { mode: 'cover-storage', name: 'particles' }, false],
          ['Image', undefined, false],
        ]);
      expect(graph.passes.filter(({ kind }) => kind === 'compute')
        .every(({ workgroupSize }) => workgroupSize[0] === 64)).toBe(true);
    });

    it('sends every compute pass source to the viewer when activated', async () => {
      const store = new MemoryWorkspaceStore();
      const workspace = await VirtualWorkspace.open(store, createDefaultWorkspaceFiles());
      const host = new WebExtensionHost(workspace);
      const receive = vi.fn();
      host.onViewerMessage(receive);

      await host.handleExplorerMessage({ type: 'activateShader', path: '/shaders/particle-swarm.wgsl' });

      expect(receive).toHaveBeenCalledWith(expect.objectContaining({
        type: 'shaderSource',
        path: '/shaders/particle-swarm.wgsl',
        buffers: passSources,
      }));
    });
  });

  it('credits the Poly Haven source of the bundled cubemap in the shader', () => {
    const cubemapShader = createDefaultWorkspaceFiles().find(
      ({ path }) => path === '/shaders/desert-cubemap.glsl',
    );

    expect(cubemapShader?.contents).toContain(
      '// Cubemap: Rogland Sunset by Greg Zaal / Poly Haven, released under CC0.',
    );
    expect(cubemapShader?.contents).toContain('// https://polyhaven.com/a/rogland_sunset');
    // Attribution stays in comments, ahead of the first line of GLSL.
    expect(cubemapShader?.contents.indexOf('polyhaven.com'))
      .toBeLessThan(cubemapShader!.contents.indexOf('mat2 rotate'));
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
