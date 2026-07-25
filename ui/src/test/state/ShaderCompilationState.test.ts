import { describe, expect, it } from 'vitest';
import {
  GLOBAL_SHADER_REQUEST_SCOPE,
  getShaderRequestScope,
  ShaderCompilationState,
} from '../../lib/state/ShaderCompilationState.svelte';

describe('ShaderCompilationState', () => {
  it('stores and clears the latest compilation result', () => {
    const state = new ShaderCompilationState();

    expect(state.latest).toBeNull();

    state.setResult({ success: false, errors: ['compile failed'] });

    expect(state.latest).toEqual({ success: false, errors: ['compile failed'] });

    state.clear();

    expect(state.latest).toBeNull();
  });

  it('rejects older root and global requests without blocking another root', () => {
    const state = new ShaderCompilationState();

    expect(state.acceptRequest({ requestId: 3 }, 'file:///project/a.slang')).toBe(true);
    expect(state.acceptRequest({ requestId: 4 }, 'file:///project/b.slang')).toBe(true);
    expect(state.acceptRequest({ requestId: 2 }, 'file:///project/a.slang')).toBe(false);
    expect(state.acceptRequest({ requestId: 2 }, GLOBAL_SHADER_REQUEST_SCOPE)).toBe(false);
  });

  it('uses locked path before message path and preserves the latest accepted request through clear', () => {
    const state = new ShaderCompilationState();
    const locked = getShaderRequestScope('file:///project/a.slang', 'file:///project/locked.slang');

    expect(locked).toBe('file:///project/locked.slang');
    expect(getShaderRequestScope()).toBe(GLOBAL_SHADER_REQUEST_SCOPE);
    expect(state.acceptRequest({ requestId: 7 }, locked)).toBe(true);
    state.clear();
    expect(state.acceptRequest({ requestId: 6 }, locked)).toBe(false);
  });
});
