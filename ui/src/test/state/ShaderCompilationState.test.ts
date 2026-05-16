import { describe, expect, it } from 'vitest';
import { ShaderCompilationState } from '../../lib/state/ShaderCompilationState.svelte';

describe('ShaderCompilationState', () => {
  it('stores and clears the latest compilation result', () => {
    const state = new ShaderCompilationState();

    expect(state.latest).toBeNull();

    state.setResult({ success: false, errors: ['compile failed'] });

    expect(state.latest).toEqual({ success: false, errors: ['compile failed'] });

    state.clear();

    expect(state.latest).toBeNull();
  });
});
