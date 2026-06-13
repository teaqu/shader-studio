import type { SlangModuleApi } from "./slangTypes";

// Hide the dynamic import from TypeScript's CommonJS downleveling — the slang
// module is an ES module loaded at runtime from a webview URI, never bundled.
const dynamicImport = new Function("u", "return import(u);") as (
  url: string,
) => Promise<{ default: (opts?: unknown) => Promise<SlangModuleApi> }>;

let cached: Promise<SlangModuleApi> | null = null;

/**
 * Load and initialize slang-wasm once. `scriptUrl` / `wasmUrl` are resolved by
 * the host (the UI passes webview URIs). `locateFile` points the emscripten
 * runtime at the explicit wasm URL rather than relying on relative resolution,
 * which survives asset hashing.
 */
export function loadSlangModule(scriptUrl: string, wasmUrl: string): Promise<SlangModuleApi> {
  if (!cached) {
    cached = dynamicImport(scriptUrl).then((mod) =>
      mod.default({ locateFile: () => wasmUrl }),
    );
  }
  return cached;
}

/** Reset the cached module (tests / teardown). */
export function resetSlangModuleCache(): void {
  cached = null;
}
