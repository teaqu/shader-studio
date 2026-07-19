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

  it('rejects stale requests while accepting sibling messages from one request', () => {
    const state = new ShaderCompilationState();

    expect(state.acceptRequest({ requestId: 8 })).toBe(true);
    expect(state.acceptRequest({ requestId: 8 })).toBe(true);
    expect(state.acceptRequest({ requestId: 7 })).toBe(false);
    expect(state.acceptRequest({ requestId: 9 })).toBe(true);
  });

  it('tracks locked shader requests independently from the unlocked stream', () => {
    const state = new ShaderCompilationState();

    expect(state.acceptRequest({ requestId: 12 }, 'global')).toBe(true);
    expect(state.acceptRequest({ requestId: 4 }, '/locked.slang')).toBe(true);
    expect(state.acceptRequest({ requestId: 3 }, '/locked.slang')).toBe(false);
  });
});
