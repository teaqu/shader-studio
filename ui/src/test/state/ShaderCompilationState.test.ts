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

  it('seeds locked shader request scopes from the global watermark', () => {
    const state = new ShaderCompilationState();

    expect(state.acceptRequest({ requestId: 12 }, 'global')).toBe(true);
    expect(state.acceptRequest({ requestId: 4 }, '/locked.slang')).toBe(false);
    expect(state.acceptRequest({ requestId: 12 }, '/locked.slang')).toBe(true);
    expect(state.acceptRequest({ requestId: 11 }, '/locked.slang')).toBe(false);
  });

  it('tracks request watermarks independently for each compile root URI', () => {
    const state = new ShaderCompilationState();
    const request = (id: number, rootUri: string) => ({
      requestId: id,
      compileScope: { rootUris: [rootUri], generationId: id },
    });

    expect(state.acceptRequest(request(11, 'file:///b.slang'), 'file:///b.slang')).toBe(true);
    expect(state.acceptRequest(request(10, 'file:///a.slang'), 'file:///a.slang')).toBe(true);
    expect(state.acceptRequest(request(9, 'file:///a.slang'), 'file:///a.slang')).toBe(false);
  });
});
