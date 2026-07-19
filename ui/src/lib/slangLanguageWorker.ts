import slangScriptUrl from '../slang/slang-wasm.js?url';
import slangWasmUrl from '../slang/slang-wasm.wasm?url';
import {
  createSlangApi,
  SlangWorkspace,
  type SlangWorkerRequest,
  type SlangWorkerResponse,
} from '@shader-studio/slang-language-service';
import { createRetryableLoader } from './retryableLoader';

interface SlangWorkerScope {
  onmessage: ((event: MessageEvent<SlangWorkerRequest>) => void) | null;
  postMessage(message: SlangWorkerResponse): void;
}

const scope = self as unknown as SlangWorkerScope;
let workspace: SlangWorkspace | undefined;
type SlangModule = Parameters<typeof createSlangApi>[0];
type SlangModuleFactory = (options: { locateFile(file: string): string }) => Promise<SlangModule>;
const loadSlangModule = createRetryableLoader(async (): Promise<SlangModule> => {
  // Native dynamic import works in a module worker and does not require CSP
  // unsafe-eval. Vite emits slangScriptUrl as a deterministic asset URL.
  const imported = await import(/* @vite-ignore */ slangScriptUrl) as { default: SlangModuleFactory };
  return imported.default({ locateFile: () => slangWasmUrl });
});

async function dispatch(request: SlangWorkerRequest): Promise<unknown> {
  if (request.method === 'init') {
    workspace?.dispose();
    workspace = new SlangWorkspace(createSlangApi(await loadSlangModule()), request.snapshot);
    return true;
  }
  if (!workspace) {
    throw new Error('Slang language worker is not initialized');
  }
  switch (request.method) {
    case 'replaceFiles': return workspace.replaceFiles(request.snapshot) ?? true;
    case 'openDocument': return workspace.openDocument(request.document.uri, request.document.source, request.document.version);
    case 'changeDocument': return workspace.changeDocument(request.document.uri, request.document.source, request.document.version);
    case 'closeDocument': return workspace.closeDocument(request.uri, request.documentVersion);
    case 'hover': return workspace.hover(request.uri, request.position);
    case 'definition': return workspace.definition(request.uri, request.position);
    case 'completion': return workspace.completion(request.uri, request.position, request.context);
    case 'completionResolve': return workspace.completionResolve(request.item);
    case 'signatureHelp': return workspace.signatureHelp(request.uri, request.position);
    case 'documentSymbols': return workspace.documentSymbols(request.uri);
    case 'diagnostics': return workspace.diagnostics(request.uri);
  }
}

function responseVersion(request: SlangWorkerRequest): { documentVersion?: number } {
  return 'documentVersion' in request ? { documentVersion: request.documentVersion } : {};
}

scope.onmessage = async (event: MessageEvent<SlangWorkerRequest>) => {
  const request = event.data;
  let response: SlangWorkerResponse;
  try {
    response = { id: request.id, ok: true, result: await dispatch(request), ...responseVersion(request) };
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...responseVersion(request),
    };
  }
  scope.postMessage(response);
};
