import slangScriptUrl from "../slang/slang-wasm.js?url";
import slangWasmUrl from "../slang/slang-wasm.wasm?url";
import type { SlangAssetUrls } from "../../../rendering/src/webgpu/WebGPURenderingEngine";

/**
 * Resolve the slang-wasm asset URLs. Vite rewrites these `?url` imports to the
 * emitted asset paths (webview URIs at runtime), so the WebGPU engine can load
 * the compiler without a webview `fetch` (which fails for unknown extensions).
 */
export function getSlangAssetUrls(): SlangAssetUrls {
  return { scriptUrl: slangScriptUrl, wasmUrl: slangWasmUrl };
}
