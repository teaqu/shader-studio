import { runLanguageServiceWorker, type WorkerPort } from "@shader-studio/language-server-core";
import { GlslLanguageService } from "./GlslLanguageService.js";

runLanguageServiceWorker(self as unknown as WorkerPort, new GlslLanguageService());
