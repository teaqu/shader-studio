import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import * as path from "node:path";

import {
  createSlangApi,
  SlangWorkspace,
  type SlangWorkerRequest,
  type SlangWorkerResponse,
} from "@shader-studio/slang-language-service";

interface SlangModuleFactory {
  (options: { locateFile(file: string): string }): Promise<Parameters<typeof createSlangApi>[0]>;
}

const port = parentPort;
if (!port) {
  throw new Error("Slang language worker requires a worker_threads parent port");
}

let workspace: SlangWorkspace | undefined;
let modulePromise: Promise<Parameters<typeof createSlangApi>[0]> | undefined;

async function loadModule(): Promise<Parameters<typeof createSlangApi>[0]> {
  modulePromise ??= (async () => {
    const scriptPath = path.join(__dirname, "slang-wasm.mjs");
    const wasmPath = path.join(__dirname, "slang-wasm.wasm");
    const imported = await import(pathToFileURL(scriptPath).href) as { default: SlangModuleFactory };
    return imported.default({ locateFile: () => wasmPath });
  })();
  return modulePromise;
}

async function dispatch(request: SlangWorkerRequest): Promise<unknown> {
  if (request.method === "init") {
    workspace?.dispose();
    workspace = new SlangWorkspace(createSlangApi(await loadModule()), request.snapshot);
    return true;
  }
  if (!workspace) {
    throw new Error("Slang language worker is not initialized");
  }
  switch (request.method) {
    case "replaceFiles": return workspace.replaceFiles(request.snapshot) ?? true;
    case "openDocument": return workspace.openDocument(request.document.uri, request.document.source, request.document.version);
    case "changeDocument": return workspace.changeDocument(request.document.uri, request.document.source, request.document.version);
    case "closeDocument": return workspace.closeDocument(request.uri, request.documentVersion);
    case "hover": return workspace.hover(request.uri, request.position);
    case "definition": return workspace.definition(request.uri, request.position);
    case "completion": return workspace.completion(request.uri, request.position, request.context);
    case "completionResolve": return workspace.completionResolve(request.item);
    case "signatureHelp": return workspace.signatureHelp(request.uri, request.position);
    case "documentSymbols": return workspace.documentSymbols(request.uri);
    case "diagnostics": return workspace.diagnostics(request.uri);
  }
}

port.on("message", async (request: SlangWorkerRequest) => {
  try {
    const result = await dispatch(request);
    const response: SlangWorkerResponse = {
      id: request.id,
      ok: true,
      result,
      ...(request.method === "hover" || request.method === "definition" || request.method === "completion" ||
      request.method === "completionResolve" || request.method === "signatureHelp" ||
      request.method === "documentSymbols" || request.method === "diagnostics"
        ? { documentVersion: request.documentVersion }
        : {}),
    };
    port.postMessage(response);
  } catch (error) {
    const response: SlangWorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(request.method === "hover" || request.method === "definition" || request.method === "completion" ||
      request.method === "completionResolve" || request.method === "signatureHelp" ||
      request.method === "documentSymbols" || request.method === "diagnostics"
        ? { documentVersion: request.documentVersion }
        : {}),
    };
    port.postMessage(response);
  }
});
