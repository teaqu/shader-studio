import { describe, expect, it } from 'vitest';
import type { ComputePass, ShaderConfig } from '@shader-studio/types';
import {
  addStorageBuffer,
  applyStorageBuffer,
  getStorageCoverReferences,
  removeStorageBuffer,
  validateComputePass,
} from '../../lib/config/ComputeConfigMutations';

function config(overrides: Partial<ShaderConfig> = {}): ShaderConfig {
  return {
    version: '1.0',
    passes: { Image: { inputs: {} } },
    ...overrides,
  };
}

describe('compute config mutations', () => {
  describe('validateComputePass', () => {
    it.each<ComputePass>([
      { type: 'compute', path: 'sim.slang' },
      { type: 'compute', path: 'sim.slang', dispatch: { count: 4096 } },
      { type: 'compute', path: 'sim.slang', dispatch: { x: 8, y: 4, z: 1 } },
      { type: 'compute', path: 'sim.slang', dispatch: { cover: 'particles' } },
      { type: 'compute', path: 'sim.slang', inputs: { source: { type: 'texture', path: 'x.png' } }, dispatch: { cover: 'source' } },
    ])('accepts valid compute config %#', (pass) => {
      expect(validateComputePass(config({
        storage: { particles: { count: 4, elementType: 'float4' } },
      }), 'ComputeSim', pass)).toEqual({});
    });

    it('validates repeats, one-shot, and layers', () => {
      expect(validateComputePass(config(), 'ComputeSim', {
        type: 'compute',
        path: 'sim.slang', dispatchCount: 2, dispatchOnce: true, outputLayers: 9,
      })).toEqual({
        dispatchOnce: 'Run once cannot be combined with repeats greater than 1',
        outputLayers: 'Output layers must be an integer from 1 through 8',
      });
      expect(validateComputePass(config(), 'ComputeSim', {
        type: 'compute',
        path: 'sim.slang', dispatchCount: 0,
      })).toEqual({ dispatchCount: 'Repeats must be an integer from 1 through 1024' });
    });

    it('validates every dispatch variant', () => {
      expect(validateComputePass(config(), 'ComputeSim', {
        type: 'compute',
        path: 'sim.slang', dispatch: { count: 0 },
      })).toEqual({ dispatch: 'Element count must be a positive integer' });
      expect(validateComputePass(config(), 'ComputeSim', {
        type: 'compute',
        path: 'sim.slang', dispatch: { x: 1, y: 0, z: 1 },
      })).toEqual({ dispatch: 'Raw workgroup axes must be positive integers' });
      expect(validateComputePass(config(), 'ComputeSim', {
        type: 'compute',
        path: 'sim.slang', dispatch: { cover: 'missing' },
      })).toEqual({ dispatch: 'Cover target "missing" is not a storage buffer or input on ComputeSim' });
    });
  });

  it('adds immutable uniquely named storage defaults', () => {
    const original = config({ storage: { storageA: { count: 1, elementType: 'uint' } } });
    const added = addStorageBuffer(original);
    expect(added.name).toBe('storageB');
    expect(added.config.storage?.storageB).toEqual({ count: 1024, elementType: 'float4' });
    expect(original.storage?.storageB).toBeUndefined();
  });

  it('renames storage and rewrites compute cover references immutably', () => {
    const original = config({
      storage: { particles: { count: 4, elementType: 'float4' } },
      passes: {
        Image: { inputs: {} },
        ComputeSim: { type: 'compute', path: 'sim.slang', dispatch: { cover: 'particles' } },
      },
    });
    const result = applyStorageBuffer(original, 'particles', 'positions', {
      count: 8, elementType: 'float4',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.config.storage).toEqual({ positions: { count: 8, elementType: 'float4' } });
    expect((result.config.passes.ComputeSim as ComputePass).dispatch).toEqual({ cover: 'positions' });
    expect((original.passes.ComputeSim as ComputePass).dispatch).toEqual({ cover: 'particles' });
  });

  it.each([
    ['bad name', { name: 'Invalid storage buffer name' }],
    ['Image', { name: 'Storage buffer name is reserved' }],
  ] as const)('rejects storage name %s', (name, errors) => {
    expect(applyStorageBuffer(config(), null, name, {
      count: 1, elementType: 'uint',
    })).toEqual({ ok: false, errors });
  });

  it('rejects duplicate names, invalid values, unsafe sizes, and total allocation overflow', () => {
    const existing = config({ storage: { particles: { count: 1, elementType: 'uint' } } });
    expect(applyStorageBuffer(existing, null, 'particles', { count: 1, elementType: 'uint' }))
      .toEqual({ ok: false, errors: { name: 'Storage buffer name is already in use' } });
    expect(applyStorageBuffer(config(), null, 'values', { count: 0, elementType: '' }))
      .toEqual({ ok: false, errors: {
        count: 'Element count must be a positive integer',
        elementType: 'Element type is required',
      } });
    expect(applyStorageBuffer(config(), null, 'values', {
      count: Number.MAX_SAFE_INTEGER, elementType: 'uint',
    })).toEqual({ ok: false, errors: { count: 'Count multiplied by stride must be a safe integer' } });
    expect(applyStorageBuffer(config(), null, 'values', {
      count: 256 * 1024 * 1024 / 4 + 1, elementType: 'uint',
    })).toEqual({ ok: false, errors: { count: 'Total storage allocation must not exceed 256 MiB' } });
  });

  it('finds cover references and blocks referenced deletion', () => {
    const source = config({
      storage: { particles: { count: 1, elementType: 'uint' } },
      passes: {
        Image: { inputs: {} },
        ComputeA: { type: 'compute', path: 'a.slang', dispatch: { cover: 'particles' } },
        ComputeB: { type: 'compute', path: 'b.slang', dispatch: { cover: 'particles' } },
      },
    });
    expect(getStorageCoverReferences(source, 'particles')).toEqual(['ComputeA', 'ComputeB']);
    expect(removeStorageBuffer(source, 'particles')).toEqual({
      ok: false,
      errors: { name: 'Used as a dispatch target by ComputeA, ComputeB' },
    });
  });

  it('removes unreferenced storage immutably', () => {
    const original = config({ storage: { values: { count: 1, elementType: 'uint' } } });
    const result = removeStorageBuffer(original, 'values');
    expect(result).toEqual({ ok: true, config: { ...original, storage: undefined } });
    expect(original.storage?.values).toBeDefined();
  });
});
