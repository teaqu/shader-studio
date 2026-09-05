import slangScriptUrl from "../slang/slang-wasm.js?url";
import slangWasmUrl from "../slang/slang-wasm.wasm?url";
import slangWorkerUrl from "../../../rendering/src/webgpu/slangCompileWorker.ts?worker&url";
import type { SlangAssetUrls } from "../../../rendering/src/webgpu/WebGPURenderingEngine";

const SLANG_ASSET_METADATA = {
  'shader-studio-slang-script-url': slangScriptUrl,
  'shader-studio-slang-wasm-url': slangWasmUrl,
  'shader-studio-slang-worker-url': slangWorkerUrl,
} as const;

/**
 * The Shader Explorer is embedded into the UI in web mode. It uses the same
 * metadata contract as its standalone VS Code webview, so give it Vite's
 * resolved asset URLs before it creates a Slang thumbnail renderer.
 */
export function installSlangAssetMetadata(): void {
  if (typeof document === 'undefined') {
    return;
  }

  for (const [name, content] of Object.entries(SLANG_ASSET_METADATA)) {
    let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = name;
      document.head.append(meta);
    }
    meta.content = content;
  }
}

/**
 * Resolve the slang-wasm asset URLs. Vite rewrites these `?url` imports to the
 * emitted asset paths (webview URIs at runtime). `?worker&url` emits the
 * compile worker as its own chunk and returns its URL; the engine falls back
 * to main-thread compilation if constructing the worker fails (e.g. CSP).
 */
export function getSlangAssetUrls(): SlangAssetUrls {
  const diagnosticsGlobal = globalThis as typeof globalThis & { __slangPerf?: boolean };

  return {
    scriptUrl: slangScriptUrl,
    wasmUrl: slangWasmUrl,
    workerUrl: slangWorkerUrl,
    // Set `window.__slangPerf = true` before creating the renderer to trace compilation.
    debugTimings: diagnosticsGlobal.__slangPerf === true,
  };
}
