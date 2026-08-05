import type { SlangModuleApi } from "./slangTypes";

type SlangModuleFactory = {
  default: (opts?: unknown) => Promise<SlangModuleApi>;
};

const isBrowserRuntime = (): boolean =>
  typeof window !== "undefined" || "WorkerGlobalScope" in globalThis;

const dynamicImport = (url: string): Promise<SlangModuleFactory> => {
  if (isBrowserRuntime()) {
    // Keep this as a native import in browser and worker bundles. VS Code's
    // webview CSP blocks constructing an import with `new Function`.
    return import(/* @vite-ignore */ url) as Promise<SlangModuleFactory>;
  }

  // TypeScript rewrites import(url) to require(url) in this package's
  // CommonJS build. Node permits dynamic import here and has no webview CSP.
  const importFromNode = new Function("url", "return import(url);") as (
    moduleUrl: string,
  ) => Promise<SlangModuleFactory>;
  return importFromNode(url);
};

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
