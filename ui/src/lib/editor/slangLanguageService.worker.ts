import { startSlangLanguageServiceWorker } from "@shader-studio/slang-language-server";
import type { WorkerPort } from "@shader-studio/language-server-core";
import type { SlangLanguageServerModule } from "@shader-studio/slang-language-server";

interface SlangWorkerInit {
  kind: "shader-studio-slang-worker-init";
  scriptUrl: string;
  wasmUrl: string;
}

const queuedMessages: unknown[] = [];
let initializing = false;
const queueMessage = (event: MessageEvent<unknown>) => {
  if (!initializing && isInitMessage(event.data)) {
    initializing = true;
    void initialize(event.data);
    return;
  }
  queuedMessages.push(event.data);
};
self.addEventListener("message", queueMessage);

async function initialize(assets: SlangWorkerInit): Promise<void> {
  const runtime = await import(/* @vite-ignore */ assets.scriptUrl) as {
    default(options: { locateFile(path: string): string }): Promise<SlangLanguageServerModule>;
  };
  const module = await runtime.default({ locateFile: () => assets.wasmUrl });
  self.removeEventListener("message", queueMessage);
  startSlangLanguageServiceWorker(self as unknown as WorkerPort, module);
  for (const data of queuedMessages) {
    self.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function isInitMessage(value: unknown): value is SlangWorkerInit {
  return typeof value === "object"
    && value !== null
    && (value as { kind?: unknown }).kind === "shader-studio-slang-worker-init"
    && typeof (value as { scriptUrl?: unknown }).scriptUrl === "string"
    && typeof (value as { wasmUrl?: unknown }).wasmUrl === "string";
}
