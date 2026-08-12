import slangScriptUrl from "../../slang/slang-wasm.js?url";
import slangWasmUrl from "../../slang/slang-wasm.wasm?url";
import { startSlangLanguageServiceWorker } from "@shader-studio/slang-language-server";
import type { WorkerPort } from "@shader-studio/language-server-core";
import type { SlangLanguageServerModule } from "@shader-studio/slang-language-server";

const queuedMessages: unknown[] = [];
const queueMessage = (event: MessageEvent<unknown>) => queuedMessages.push(event.data);
self.addEventListener("message", queueMessage);

void initialize();

async function initialize(): Promise<void> {
  const runtime = await import(/* @vite-ignore */ slangScriptUrl) as {
    default(options: { locateFile(path: string): string }): Promise<SlangLanguageServerModule>;
  };
  const module = await runtime.default({ locateFile: () => slangWasmUrl });
  self.removeEventListener("message", queueMessage);
  startSlangLanguageServiceWorker(self as unknown as WorkerPort, module);
  for (const data of queuedMessages) self.dispatchEvent(new MessageEvent("message", { data }));
}
