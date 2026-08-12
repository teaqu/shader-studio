import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { setupMonacoLanguageServices } from "@shader-studio/monaco";
import { WorkerLanguageServiceProxy, type WorkerPort } from "@shader-studio/language-server-core";
import GlslLanguageServiceWorker from "./glslLanguageService.worker?worker";
import SlangLanguageServiceWorker from "./slangLanguageService.worker?worker";
import { LanguageServiceController } from "./LanguageServiceController.svelte";

export function createLanguageServiceController(monaco: typeof Monaco): LanguageServiceController {
  const manager = setupMonacoLanguageServices(monaco, {
    glsl: async () => new WorkerLanguageServiceProxy(new GlslLanguageServiceWorker() as unknown as WorkerPort),
    slang: async () => new WorkerLanguageServiceProxy(new SlangLanguageServiceWorker() as unknown as WorkerPort),
  });
  return new LanguageServiceController(manager);
}
