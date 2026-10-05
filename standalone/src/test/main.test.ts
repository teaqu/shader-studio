import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ mount: vi.fn(), configureHost: vi.fn(), createViewerTransport: vi.fn(), start: vi.fn(), metadata: vi.fn() }));
vi.mock('svelte', async importOriginal => ({ ...await importOriginal<typeof import('svelte')>(), mount: mocks.mount }));
vi.mock('@shader-studio/ui', () => ({ configureHost: mocks.configureHost }));
vi.mock('../App.svelte', () => ({ default: 'App' }));
vi.mock('../WebTransport', () => ({ WebTransport: class {
  createViewerTransport = mocks.createViewerTransport;
} }));
vi.mock('../pwa', () => ({ createPwaController: () => ({ start: mocks.start }) }));
vi.mock('../slangAssets', () => ({ installSlangAssetMetadata: mocks.metadata }));

describe('standalone host bootstrap', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); document.body.innerHTML = '<div id="app"></div>';
  });
  it('gives each mounted viewer a transport and configures web capabilities and default assets', async () => {
    const first = { id: 'first' }, second = { id: 'second' };
    mocks.createViewerTransport.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const app = { mounted: true };
    mocks.mount.mockReturnValue(app);
    const result = await import('../main');
    expect(result.default).toBe(app);
    const config = mocks.configureHost.mock.calls[0][0];
    expect(config.createTransport()).toBe(first);
    expect(config.createTransport()).toBe(second);
    expect(config.capabilities).toEqual({ compileOnSave: false });
    expect(config.defaultAssets).toHaveLength(2);
    expect(config.defaultAssets).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Nebula Texture.png', isSameDirectory: false, thumbnailUri: expect.stringMatching(/^http/) })]));
    expect(mocks.mount).toHaveBeenCalledWith('App', { target: document.getElementById('app'), props: { transport: expect.any(Object), pwa: { start: mocks.start } } });
    expect(mocks.metadata).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledOnce();
  });
});
