/// <reference lib="webworker" />
// Dedicated worker: owns its own slang-wasm instance and answers
// init/compile messages from WorkerSlangCompiler. Never imports WebGPU.
import { SlangCompiler, type SlangCompileOptions } from "./SlangCompiler";
import { loadSlangModule } from "./SlangModuleLoader";

type InitMessage = { id: number; type: "init"; scriptUrl: string; wasmUrl: string };
type CompileMessage = { id: number; type: "compile"; source: string; options: SlangCompileOptions };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let compiler: SlangCompiler | null = null;

scope.onmessage = async (event: MessageEvent<InitMessage | CompileMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      const slang = await loadSlangModule(message.scriptUrl, message.wasmUrl);
      compiler = new SlangCompiler(slang);
      scope.postMessage({ id: message.id, ok: true });
      return;
    }
    if (!compiler) {
      throw new Error("compile requested before worker init");
    }
    const result = compiler.compileImagePass(message.source, message.options);
    scope.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    scope.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
