import { describe, expect, it } from 'vitest';
import { parseWgslDocument } from '@shader-studio/wgsl-analysis';
import { planWgslTraceValues } from '../WgslTraceAggregate';

function plan(source: string, names: string[]) {
  const document = parseWgslDocument('/aggregate.wgsl', source, 'fragment');
  const locals = document.symbols.filter(symbol => names.includes(symbol.name));
  return planWgslTraceValues(document, locals);
}

describe('planWgslTraceValues', () => {
  it('expands fixed arrays, matrices and nested structs into read-expression leaves', () => {
    const result = plan(`
      const WIDTH = 2u + 1u;
      alias Weight = f32;
      alias Weights = array<Weight, WIDTH>;
      struct Particle { position: vec4f, basis: mat2x2f, }
      struct Scene { particles: array<Particle, 2>, weights: Weights, }
      fn mainImage(p: vec2f) -> vec4f {
        let scene = Scene();
        return vec4f(p, 0.0, 1.0);
      }
    `, ['scene']);

    expect(result.unavailableVariables).toEqual([]);
    expect(result.variables).toEqual([
      { name: 'scene.particles[0].position', type: 'vec4f', component: 'f32', width: 4 },
      { name: 'scene.particles[0].basis[0]', type: 'vec2f', component: 'f32', width: 2 },
      { name: 'scene.particles[0].basis[1]', type: 'vec2f', component: 'f32', width: 2 },
      { name: 'scene.particles[1].position', type: 'vec4f', component: 'f32', width: 4 },
      { name: 'scene.particles[1].basis[0]', type: 'vec2f', component: 'f32', width: 2 },
      { name: 'scene.particles[1].basis[1]', type: 'vec2f', component: 'f32', width: 2 },
      { name: 'scene.weights[0]', type: 'f32', component: 'f32', width: 1 },
      { name: 'scene.weights[1]', type: 'f32', component: 'f32', width: 1 },
      { name: 'scene.weights[2]', type: 'f32', component: 'f32', width: 1 },
    ]);
    expect(result.valueShapes).toMatchObject([{
      name: 'scene', type: 'Scene', children: [
        { name: 'particles', children: [
          { name: '[0]', children: [{ name: 'position', slot: 0 }, { name: 'basis', children: [{ name: '[0]', slot: 1 }, { name: '[1]', slot: 2 }] }] },
          { name: '[1]', children: [{ name: 'position', slot: 3 }, { name: 'basis', children: [{ name: '[0]', slot: 4 }, { name: '[1]', slot: 5 }] }] },
        ] },
        { name: 'weights', children: [{ name: '[0]', slot: 6 }, { name: '[1]', slot: 7 }, { name: '[2]', slot: 8 }] },
      ],
    }]);
  });

  it('supports the corpus gravity local array of structs', () => {
    const result = plan(`
      struct Body { position: vec4f, velocity: vec4f, }
      fn mainImage(p: vec2f) -> vec4f {
        var forceSources: array<Body, 32>;
        return vec4f(p, 0.0, 1.0);
      }
    `, ['forceSources']);
    expect(result.unavailableVariables).toEqual([]);
    expect(result.variables).toHaveLength(64);
    expect(result.variables[0]).toMatchObject({ name: 'forceSources[0].position', type: 'vec4f' });
    expect(result.variables.at(-1)).toMatchObject({ name: 'forceSources[31].velocity', type: 'vec4f' });
  });

  it('captures boolean vector leaves', () => {
    const result = plan(`fn mainImage(p: vec2f) -> vec4f {
      let mask = vec3<bool>(true, false, true);
      return vec4f(p, 0.0, 1.0);
    }`, ['mask']);
    expect(result.variables).toEqual([{ name: 'mask', type: 'vec3<bool>', component: 'bool', width: 3 }]);
    expect(result.valueShapes).toMatchObject([{ name: 'mask', type: 'vec3<bool>', slot: 0 }]);
  });

  it('uses global const array sizes with truncating integer division, but rejects overrides', () => {
    const constant = plan(`const WIDTH = 5u / 2u;
      fn mainImage(p: vec2f) -> vec4f { var values: array<f32, WIDTH>; return vec4f(p, 0.0, 1.0); }`, ['values']);
    expect(constant.variables.map(value => value.name)).toEqual(['values[0]', 'values[1]']);

    const override = plan(`override WIDTH: u32 = 2u;
      fn mainImage(p: vec2f) -> vec4f { var values: array<f32, WIDTH>; return vec4f(p, 0.0, 1.0); }`, ['values']);
    expect(override.unavailableVariables).toEqual([{ name: 'values', type: 'array<f32, WIDTH>' }]);
  });

  it.each([
    ['runtime array', 'array<f32>'],
    ['pointer', 'ptr<function, f32>'],
    ['atomic', 'atomic<u32>'],
    ['f16 leaf', 'array<f16, 2>'],
    ['zero-length fixed array', 'array<f32, 0>'],
    ['oversized fixed array', 'array<f32, 257>'],
  ])('rejects an entire unsupported root: %s', (_label, type) => {
    const result = plan(`fn mainImage(p: vec2f) -> vec4f { var value: ${type}; return vec4f(p, 0.0, 1.0); }`, ['value']);
    expect(result.variables).toEqual([]);
    expect(result.valueShapes).toEqual([]);
    expect(result.unavailableVariables).toEqual([{ name: 'value', type }]);
  });

  it('does not recurse through alias cycles or recursive struct paths', () => {
    const result = plan(`
      alias A = B; alias B = A;
      struct Node { child: Node, }
      fn mainImage(p: vec2f) -> vec4f { var aliasValue: A; var node: Node; return vec4f(p, 0.0, 1.0); }
    `, ['aliasValue', 'node']);
    expect(result.variables).toEqual([]);
    expect(result.unavailableVariables).toEqual([
      { name: 'aliasValue', type: 'A' }, { name: 'node', type: 'Node' },
    ]);
  });
});
