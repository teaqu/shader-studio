import { describe, expect, it } from 'vitest';
import { vertexPassKey, type ShaderConfig } from '@shader-studio/types';
import { passNameForFile } from '../passSources';

const config: ShaderConfig = {
  version: '1.0',
  storage: { particles: { count: 4, elementType: 'vec4<f32>' } },
  passes: {
    common: { path: 'swarm/common.buffer.wgsl' },
    Advect: { type: 'compute', path: 'swarm/swarm.buffer.wgsl', entryPoint: 'advect' },
    Seed: { type: 'compute', path: 'swarm/swarm.buffer.wgsl', entryPoint: 'seed' },
    Image: { inputs: {}, vertex: 'swarm.vert.wgsl' },
  },
};

describe('passNameForFile', () => {
  it('names the pass whose source is the file, relative to the config', () => {
    expect(passNameForFile(config, '/shaders/swarm.wgsl', '/shaders/swarm/common.buffer.wgsl')).toBe('common');
    expect(passNameForFile(config, '/shaders/swarm.wgsl', '/shaders/swarm/swarm.buffer.wgsl')).toBe('Advect');
  });

  it('names the vertex source separately from the pass body', () => {
    expect(passNameForFile(config, '/shaders/swarm.wgsl', '/shaders/swarm.vert.wgsl')).toBe(vertexPassKey('Image'));
  });

  it('resolves workspace-root and parent references the way the host does', () => {
    const rooted: ShaderConfig = {
      version: '1.0',
      passes: { Image: { inputs: {} }, Sim: { type: 'compute', path: '@/shared/sim.wgsl' } },
    };
    expect(passNameForFile(rooted, '/shaders/deep/swarm.wgsl', '/shared/sim.wgsl')).toBe('Sim');
    const relative: ShaderConfig = {
      version: '1.0',
      passes: { Image: { inputs: {} }, Sim: { type: 'compute', path: '../shared/sim.wgsl' } },
    };
    expect(passNameForFile(relative, '/shaders/deep/swarm.wgsl', '/shaders/shared/sim.wgsl')).toBe('Sim');
  });

  it('reports nothing for the shader itself, an unrelated file, or no config', () => {
    expect(passNameForFile(config, '/shaders/swarm.wgsl', '/shaders/swarm.wgsl')).toBeUndefined();
    expect(passNameForFile(config, '/shaders/swarm.wgsl', '/shaders/other/thing.wgsl')).toBeUndefined();
    expect(passNameForFile(null, '/shaders/swarm.wgsl', '/shaders/swarm/common.buffer.wgsl')).toBeUndefined();
  });
});
