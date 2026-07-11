import slangScriptUrl from "../slang/slang-wasm.js?url";
import slangWasmUrl from "../slang/slang-wasm.wasm?url";
import slangWorkerUrl from "../../../rendering/src/webgpu/slangCompileWorker.ts?worker&url";
import type { SlangAssetUrls } from "../../../rendering/src/webgpu/WebGPURenderingEngine";

/**
 * Resolve the slang-wasm asset URLs. Vite rewrites these `?url` imports to the
 * emitted asset paths (webview URIs at runtime). `?worker&url` emits the
 * compile worker as its own chunk and returns its URL; the engine falls back
 * to main-thread compilation if constructing the worker fails (e.g. CSP).
 */
export function getSlangAssetUrls(): SlangAssetUrls {
  return {
    scriptUrl: slangScriptUrl,
    wasmUrl: slangWasmUrl,
    workerUrl: slangWorkerUrl,
    debugTimings: true,
  };
}
