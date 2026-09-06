import { afterEach, describe, expect, it } from 'vitest';
import { configureHost, getHostCapabilities, getHostDefaultAssets, getHostTransportFactory, resetHost } from '../lib/state/hostState.svelte';

afterEach(resetHost);

describe('viewer host contract', () => {
  it('defaults to no host services and to full extension capabilities', () => {
    expect(getHostDefaultAssets()).toEqual([]);
    expect(getHostTransportFactory()).toBeUndefined();
    expect(getHostCapabilities()).toEqual({ compileOnSave: true });
  });

  it('lets a shell that saves every edit drop compile-on-save', () => {
    configureHost({ capabilities: { compileOnSave: false } });
    expect(getHostCapabilities().compileOnSave).toBe(false);
    resetHost();
    expect(getHostCapabilities().compileOnSave).toBe(true);
  });

  it('exposes shell-provided services and resets to defaults', () => {
    const createTransport = () => ({}) as never;
    const assets = [{
      name: 'nebula.png', workspacePath: '/nebula.png', thumbnailUri: 'blob:nebula', isSameDirectory: false,
    }];
    configureHost({ createTransport, defaultAssets: assets });
    expect(getHostTransportFactory()).toBe(createTransport);
    expect(getHostDefaultAssets()).toEqual(assets);
    resetHost();
    expect(getHostTransportFactory()).toBeUndefined();
    expect(getHostDefaultAssets()).toEqual([]);
  });
});
