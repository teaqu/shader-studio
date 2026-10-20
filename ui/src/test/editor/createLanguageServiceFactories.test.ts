import { beforeEach, expect, it, vi } from 'vitest';
import { createLanguageServiceFactories } from '../../lib/editor/createLanguageServiceFactories';
import { createWebviewWorker } from '../../lib/editor/webviewWorker';
import { WorkerLanguageServiceProxy } from '@shader-studio/language-server-core';

vi.mock('../../lib/editor/webviewWorker', () => ({ createWebviewWorker: vi.fn() }));
vi.mock('../../lib/slangAssets', () => ({ getSlangAssetUrls: () => ({ scriptUrl: '/slang.js', wasmUrl: '/slang.wasm' }) }));
vi.mock('@shader-studio/language-server-core', () => ({ WorkerLanguageServiceProxy: vi.fn(class {
  constructor(readonly port: unknown) {}
}) }));
const port = { postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), terminate: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(createWebviewWorker).mockResolvedValue({ port, assetUrls: ['blob:script', 'blob:wasm'] });
});
it.each(['glsl', 'wgsl'] as const)('creates a %s worker with a typed proxy', async language => {
  const proxy = await createLanguageServiceFactories()[language]();
  expect(proxy).toBeInstanceOf(WorkerLanguageServiceProxy);
  expect(WorkerLanguageServiceProxy).toHaveBeenCalledWith(port);
  expect(createWebviewWorker).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'text/javascript', mode: 'text' }));
});
it('initializes Slang with same-origin compiler asset URLs', async () => {
  await createLanguageServiceFactories().slang();
  expect(createWebviewWorker).toHaveBeenCalledWith(expect.any(Object), [{ url: '/slang.js', mimeType: 'text/javascript', mode: 'text' }, { url: '/slang.wasm', mimeType: 'application/wasm', mode: 'binary' }]);
  expect(port.postMessage).toHaveBeenCalledWith({ kind: 'shader-studio-slang-worker-init', scriptUrl: 'blob:script', wasmUrl: 'blob:wasm' });
});
it.each([{ assetUrls: [] }, { assetUrls: ['script'] }])('cleans up a worker if the compiler bundle has missing assets: $assetUrls', async ({ assetUrls }) => {
  vi.mocked(createWebviewWorker).mockResolvedValue({ port, assetUrls });
  await expect(createLanguageServiceFactories().slang()).rejects.toThrow('assets were not created');
  expect(port.terminate).toHaveBeenCalledOnce();
});
it('preserves worker initialization failures', async () => {
  vi.mocked(createWebviewWorker).mockRejectedValue(new Error('offline'));
  await expect(createLanguageServiceFactories().glsl()).rejects.toThrow('offline');
});
