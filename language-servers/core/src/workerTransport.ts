import type {
  DocumentAnalysisMethod,
  DocumentRevision,
  LanguageService,
  WorkerMethod,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";
import { isWorkerMessage } from "./protocol";

export interface WorkerPort {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
}

export class WorkerLanguageServiceClient {
  private nextId = 1;
  private disposed = false;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly onMessage = ({ data }: { data: unknown }) => {
    if (!isWorkerMessage(data) || data.kind !== "response") {
      return;
    }
    const pending = this.pending.get(data.id);
    if (!pending) {
      return;
    }
    this.pending.delete(data.id);
    if (data.error) {
      pending.reject(new Error(data.error.message));
    } else {
      pending.resolve(data.result);
    }
  };

  constructor(private readonly port: WorkerPort) {
    port.addEventListener("message", this.onMessage);
  }

  request<T>(method: WorkerMethod, params: unknown): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("Language service worker is disposed"));
    }
    const id = this.nextId++;
    const request: WorkerRequest = { kind: "request", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.port.postMessage(request);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.port.removeEventListener("message", this.onMessage);
    this.port.terminate?.();
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Language service worker is disposed"));
    }
    this.pending.clear();
  }
}

/** Typed LanguageService facade over the serializable worker protocol. */
export class WorkerLanguageServiceProxy implements LanguageService {
  private readonly client: WorkerLanguageServiceClient;

  constructor(port: WorkerPort) {
    this.client = new WorkerLanguageServiceClient(port);
  }
  initialize() {
    return this.client.request<Awaited<ReturnType<LanguageService["initialize"]>>>("initialize", undefined);
  }
  syncEnvironment(environment: Parameters<LanguageService["syncEnvironment"]>[0]) {
    return this.client.request<void>("syncEnvironment", environment);
  }
  openDocument(document: Parameters<LanguageService["openDocument"]>[0]) {
    return this.client.request<void>("openDocument", document);
  }
  changeDocument(document: Parameters<LanguageService["changeDocument"]>[0]) {
    return this.client.request<void>("changeDocument", document);
  }
  closeDocument(uri: string) {
    return this.client.request<void>("closeDocument", uri);
  }
  completion(params: Parameters<LanguageService["completion"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["completion"]>>>("completion", params);
  }
  hover(params: Parameters<LanguageService["hover"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["hover"]>>>("hover", params);
  }
  definition(params: Parameters<LanguageService["definition"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["definition"]>>>("definition", params);
  }
  signatureHelp(params: Parameters<LanguageService["signatureHelp"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["signatureHelp"]>>>("signatureHelp", params);
  }
  documentSymbols(params: Parameters<LanguageService["documentSymbols"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["documentSymbols"]>>>("documentSymbols", params);
  }
  references(params: Parameters<LanguageService["references"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["references"]>>>("references", params);
  }
  documentHighlights(params: Parameters<LanguageService["documentHighlights"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["documentHighlights"]>>>("documentHighlights", params);
  }
  rename(params: Parameters<LanguageService["rename"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["rename"]>>>("rename", params);
  }
  diagnostics(params: Parameters<LanguageService["diagnostics"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["diagnostics"]>>>("diagnostics", params);
  }
  documentColors(params: Parameters<LanguageService["documentColors"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["documentColors"]>>>("documentColors", params);
  }
  colorPresentations(params: Parameters<LanguageService["colorPresentations"]>[0]) {
    return this.client.request<Awaited<ReturnType<LanguageService["colorPresentations"]>>>("colorPresentations", params);
  }
  async dispose(): Promise<void> {
    try {
      await this.client.request<void>("dispose", undefined);
    } finally {
      this.client.dispose();
    }
  }
}

export function runLanguageServiceWorker(port: WorkerPort, service: LanguageService): () => void {
  const onMessage = async ({ data }: { data: unknown }) => {
    if (!isWorkerMessage(data) || data.kind !== "request") {
      return;
    }
    const request = data;
    try {
      const result = await invoke(service, request.method, request.params);
      port.postMessage(responseFor(request, { result }));
    } catch (error) {
      port.postMessage(responseFor(request, {
        error: { code: "language-service-error", message: error instanceof Error ? error.message : String(error) },
      }));
    }
  };
  port.addEventListener("message", onMessage);
  return () => port.removeEventListener("message", onMessage);
}

async function invoke(service: LanguageService, method: WorkerMethod, params: unknown): Promise<unknown> {
  switch (method) {
    case "initialize": return service.initialize();
    case "syncEnvironment": return service.syncEnvironment(params as Parameters<LanguageService["syncEnvironment"]>[0]);
    case "openDocument": return service.openDocument(params as Parameters<LanguageService["openDocument"]>[0]);
    case "changeDocument": return service.changeDocument(params as Parameters<LanguageService["changeDocument"]>[0]);
    case "closeDocument": return service.closeDocument(params as string);
    case "completion": return service.completion(params as Parameters<LanguageService["completion"]>[0]);
    case "hover": return service.hover(params as Parameters<LanguageService["hover"]>[0]);
    case "definition": return service.definition(params as Parameters<LanguageService["definition"]>[0]);
    case "signatureHelp": return service.signatureHelp(params as Parameters<LanguageService["signatureHelp"]>[0]);
    case "documentSymbols": return service.documentSymbols(params as Parameters<LanguageService["documentSymbols"]>[0]);
    case "references": return service.references(params as Parameters<LanguageService["references"]>[0]);
    case "documentHighlights": return service.documentHighlights(params as Parameters<LanguageService["documentHighlights"]>[0]);
    case "rename": return service.rename(params as Parameters<LanguageService["rename"]>[0]);
    case "diagnostics": return service.diagnostics(params as Parameters<LanguageService["diagnostics"]>[0]);
    case "documentColors": return service.documentColors(params as Parameters<LanguageService["documentColors"]>[0]);
    case "colorPresentations": return service.colorPresentations(params as Parameters<LanguageService["colorPresentations"]>[0]);
    case "dispose": return service.dispose();
  }
}

function responseFor(
  request: WorkerRequest,
  outcome: { result: unknown } | { error: { code: string; message: string } },
): WorkerResponse {
  if (isAnalysisMethod(request.method)) {
    const revision = (request.params as { document: DocumentRevision }).document;
    return { kind: "response", id: request.id, method: request.method, revision, ...outcome } as WorkerResponse;
  }
  return { kind: "response", id: request.id, method: request.method, ...outcome } as WorkerResponse;
}

function isAnalysisMethod(method: WorkerMethod): method is DocumentAnalysisMethod {
  return new Set<WorkerMethod>([
    "completion", "hover", "definition", "signatureHelp", "documentSymbols", "references",
    "documentHighlights", "rename", "diagnostics", "documentColors", "colorPresentations",
  ]).has(method);
}
