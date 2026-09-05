import { afterEach, expect, it, vi } from 'vitest';
import { installSlangAssetMetadata } from '../slangAssets';

const urls = vi.hoisted(() => ({ scriptUrl: '/slang.js', wasmUrl: '/slang.wasm', workerUrl: '/worker.js' as string | undefined }));
vi.mock('@shader-studio/ui', () => ({ getSlangAssetUrls: () => urls }));
afterEach(() => {
  document.head.replaceChildren(); urls.workerUrl = '/worker.js';
});

it('installs and refreshes compiler metadata without duplicating tags', () => {
  installSlangAssetMetadata();
  document.querySelector<HTMLMetaElement>('meta[name="shader-studio-slang-script-url"]')!.content = 'stale';
  installSlangAssetMetadata();
  expect(document.head.querySelectorAll('meta')).toHaveLength(3);
  expect(document.querySelector<HTMLMetaElement>('meta[name="shader-studio-slang-script-url"]')?.content).toBe('/slang.js');
  expect(document.querySelector<HTMLMetaElement>('meta[name="shader-studio-slang-wasm-url"]')?.content).toBe('/slang.wasm');
  expect(document.querySelector<HTMLMetaElement>('meta[name="shader-studio-slang-worker-url"]')?.content).toBe('/worker.js');
});

it('supports compilers without a separate worker asset', () => {
  urls.workerUrl = undefined;
  installSlangAssetMetadata();
  expect(document.head.querySelectorAll('meta')).toHaveLength(2);
});
