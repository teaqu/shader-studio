import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('aspectRatioStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/aspectRatioStore');
    return mod.aspectRatioStore;
  }

  it('should have default mode 16:9', async () => {
    const store = await importStore();
    expect(get(store).mode).toBe('16:9');
  });

  it('should load mode from localStorage', async () => {
    localStorage.setItem('shader-studio-aspect-ratio', JSON.stringify({ mode: '4:3' }));
    const store = await importStore();
    expect(get(store).mode).toBe('4:3');
  });

  it('setMode should update and persist to localStorage', async () => {
    const store = await importStore();
    store.setMode('1:1');
    expect(get(store).mode).toBe('1:1');
    const stored = JSON.parse(localStorage.getItem('shader-studio-aspect-ratio')!);
    expect(stored.mode).toBe('1:1');
  });

  // --- setFromConfig no-op guard ---

  it('setFromConfig should not notify subscribers when called with same mode', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');
    expect(get(store).mode).toBe('4:3');

    let callCount = 0;
    const unsub = store.subscribe(() => { callCount++; });
    callCount = 0;

    store.setFromConfig('4:3');
    store.setFromConfig('4:3');
    store.setFromConfig('4:3');
    expect(callCount).toBe(0);
    unsub();
  });

  it('setFromConfig should notify subscribers when mode actually changes', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');

    let callCount = 0;
    const unsub = store.subscribe(() => { callCount++; });
    callCount = 0;

    store.setFromConfig('1:1');
    expect(callCount).toBe(1);
    expect(get(store).mode).toBe('1:1');
    unsub();
  });

  it('setFromConfig should ignore invalid modes', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');

    let callCount = 0;
    const unsub = store.subscribe(() => { callCount++; });
    callCount = 0;

    store.setFromConfig('invalid' as any);
    expect(callCount).toBe(0);
    expect(get(store).mode).toBe('4:3');
    unsub();
  });

  it('setFromConfig should ignore undefined', async () => {
    const store = await importStore();
    store.setFromConfig('4:3');

    let callCount = 0;
    const unsub = store.subscribe(() => { callCount++; });
    callCount = 0;

    store.setFromConfig(undefined);
    expect(callCount).toBe(0);
    expect(get(store).mode).toBe('4:3');
    unsub();
  });

  // --- reset ---

  it('reset should restore default 16:9', async () => {
    const store = await importStore();
    store.setMode('fill');
    store.reset();
    expect(get(store).mode).toBe('16:9');
  });
});
