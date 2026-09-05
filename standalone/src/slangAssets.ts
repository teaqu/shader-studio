import { getSlangAssetUrls } from '@shader-studio/ui';

/** Give the embedded explorer the viewer's resolved compiler assets. */
export function installSlangAssetMetadata(): void {
  const { scriptUrl, wasmUrl, workerUrl } = getSlangAssetUrls();
  const metadata = {
    'shader-studio-slang-script-url': scriptUrl,
    'shader-studio-slang-wasm-url': wasmUrl,
    'shader-studio-slang-worker-url': workerUrl,
  };
  for (const [name, content] of Object.entries(metadata)) {
    if (!content) {
      continue;
    }
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = name;
      document.head.append(meta);
    }
    meta.content = content;
  }
}
