/// <reference lib="webworker" />
// Dedicated worker: owns its own slang-wasm instance and answers
// init/compile messages from WorkerSlangCompiler. Never imports WebGPU.
import { SlangCompiler, type SlangCompileRequest } from "./SlangCompiler";
import { loadSlangModule } from "./SlangModuleLoader";

type InitMessage = { id: number; type: "init"; scriptUrl: string; wasmUrl: string };
type CompileMessage = { id: number; type: "compile"; request: SlangCompileRequest };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let compiler: SlangCompiler | null = null;

function postStatus(label: string, id?: number, detail?: string): void {
  scope.postMessage({ type: "status", label, id, detail });
}

postStatus("boot");

scope.onmessage = async (event: MessageEvent<InitMessage | CompileMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      postStatus("init-received", message.id);
      postStatus("load-slang-start", message.id);
      const slang = await loadSlangModule(message.scriptUrl, message.wasmUrl);
      postStatus("load-slang-complete", message.id);
      compiler = new SlangCompiler(slang);
      postStatus("compiler-created", message.id);
      scope.postMessage({ id: message.id, ok: true });
      return;
    }
    if (!compiler) {
      throw new Error("compile requested before worker init");
    }
    const result = compiler.compile(message.request);
    scope.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    scope.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    postStatus("error", message.id, error instanceof Error ? error.message : String(error));
  }
};

scope.addEventListener("close", () => compiler?.dispose());
