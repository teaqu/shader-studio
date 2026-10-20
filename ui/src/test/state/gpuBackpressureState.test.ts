import { afterEach, describe, expect, it } from 'vitest';
import { getGpuBackpressureDefaults, setGpuBackpressureDefaults } from '../../lib/state/gpuBackpressureState.svelte';

afterEach(() => setGpuBackpressureDefaults());

describe('GPU defaults state', () => {
  it('updates validated defaults and restores inheritance', () => {
    setGpuBackpressureDefaults({ framesInFlight: 4 });
    expect(getGpuBackpressureDefaults()).toEqual({ framesInFlight: 4, stallTimeoutMs: 2000 });
    setGpuBackpressureDefaults({ framesInFlight: 0, stallTimeoutMs: 350 });
    expect(getGpuBackpressureDefaults()).toEqual({ framesInFlight: 2, stallTimeoutMs: 350 });
    setGpuBackpressureDefaults();
    expect(getGpuBackpressureDefaults()).toEqual({ framesInFlight: 2, stallTimeoutMs: 2000 });
  });
});
