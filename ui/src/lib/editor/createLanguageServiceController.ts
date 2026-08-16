import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { setupMonacoLanguageServices } from "@shader-studio/monaco";
import { WorkerLanguageServiceProxy } from "@shader-studio/language-server-core";
import glslLanguageServiceWorkerUrl from "./glslLanguageService.worker?worker&url";
import slangLanguageServiceWorkerUrl from "./slangLanguageService.worker?worker&url";
import { LanguageServiceController } from "./LanguageServiceController.svelte";
import { getSlangAssetUrls } from "../slangAssets";
import { createWebviewWorker } from "./webviewWorker";

export function createLanguageServiceController(monaco: typeof Monaco): LanguageServiceController {
  const manager = setupMonacoLanguageServices(monaco, {
    glsl: async () => {
      const bundle = await createWebviewWorker({
        url: glslLanguageServiceWorkerUrl,
        mimeType: "text/javascript",
        mode: "text",
      });
      return new WorkerLanguageServiceProxy(bundle.port);
    },
    slang: async () => {
      const assets = getSlangAssetUrls();
      const bundle = await createWebviewWorker({
        url: slangLanguageServiceWorkerUrl,
        mimeType: "text/javascript",
        mode: "text",
      }, [
        { url: assets.scriptUrl, mimeType: "text/javascript", mode: "text" },
        { url: assets.wasmUrl, mimeType: "application/wasm", mode: "binary" },
      ]);
      const [scriptUrl, wasmUrl] = bundle.assetUrls;
      if (!scriptUrl || !wasmUrl) {
        bundle.port.terminate?.();
        throw new Error("Slang language-service worker assets were not created");
      }
      bundle.port.postMessage({
        kind: "shader-studio-slang-worker-init",
        scriptUrl,
        wasmUrl,
      });
      return new WorkerLanguageServiceProxy(bundle.port);
    },
  });
  return new LanguageServiceController(manager);
}
