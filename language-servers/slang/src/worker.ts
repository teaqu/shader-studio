import { runLanguageServiceWorker, type WorkerPort } from "@shader-studio/language-server-core";
import { SlangLanguageService } from "./SlangLanguageService.js";
import type { SlangLanguageServerModule } from "./slangLanguageServerTypes.js";

export function startSlangLanguageServiceWorker(port: WorkerPort, module: SlangLanguageServerModule): () => void {
  return runLanguageServiceWorker(port, new SlangLanguageService(module));
}
