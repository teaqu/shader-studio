import type { SlangAssetUrls } from '../../../rendering/src/webgpu/WebGPURenderingEngine';

function getMetaContent(name: string, label: string): string {
  const content = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content.trim();
  if (!content) {
    throw new Error(`Missing Slang asset metadata for ${label}`);
  }

  return content;
}

export function getSlangAssetUrls(): SlangAssetUrls {
  const diagnosticsGlobal = globalThis as typeof globalThis & { __slangPerf?: boolean };

  return {
    scriptUrl: getMetaContent('shader-studio-slang-script-url', 'script'),
    wasmUrl: getMetaContent('shader-studio-slang-wasm-url', 'wasm'),
    workerUrl: getMetaContent('shader-studio-slang-worker-url', 'worker'),
    // Set `window.__slangPerf = true` before creating the renderer to trace compilation.
    debugTimings: diagnosticsGlobal.__slangPerf === true,
  };
}
