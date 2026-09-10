import { runLanguageServiceWorker, type WorkerPort } from "@shader-studio/language-server-core";
import { WgslLanguageService } from "./WgslLanguageService.js";

runLanguageServiceWorker(self as unknown as WorkerPort, new WgslLanguageService());
