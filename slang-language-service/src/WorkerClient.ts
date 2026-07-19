import type {
  CompletionItemDto,
  DiagnosticDto,
  DocumentSymbolDto,
  HoverDto,
  LocationDto,
  SignatureHelpDto,
} from "./SlangWorkspace";
import type { SlangCompletionContext } from "./slangApi";
import type { SlangDocumentSnapshot, SlangPosition, SlangWorkspaceSnapshot } from "./types";
import type { SlangWorkerRequest, SlangWorkerRequestPayload, SlangWorkerResponse } from "./workerProtocol";

export interface SlangWorker {
  onmessage: ((event: { data: SlangWorkerResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  postMessage(message: SlangWorkerRequest): void;
  terminate(): void;
}

type WorkerFactory = () => SlangWorker;

interface PendingRequest {
  resolve(value: { result: unknown; documentVersion?: number }): void;
  reject(error: Error): void;
}

export class StaleSlangResultError extends Error {
  constructor(uri: string, expected: number, actual: number | undefined) {
    super(`Dropped stale Slang result for "${uri}": expected version ${expected}, received ${actual ?? "unknown"}`);
    this.name = "StaleSlangResultError";
  }
}

export class WorkerClient {
  private worker: SlangWorker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private mutationTail: Promise<void> = Promise.resolve();
  private recovery: Promise<void> = Promise.resolve();
  private latestSnapshot: SlangWorkspaceSnapshot | undefined;
  private readonly openDocuments = new Map<string, SlangDocumentSnapshot>();
  private readonly documentVersions = new Map<string, number>();
  private readonly documentMutationGenerations = new Map<string, number>();
  private nextDocumentMutationGeneration = 1;
  private disposed = false;

  constructor(private readonly createWorker: WorkerFactory) {
    this.worker = this.startWorker();
  }

  init(snapshot: SlangWorkspaceSnapshot): Promise<void> {
    if (this.disposed) {
      return this.disposedPromise();
    }
    this.latestSnapshot = snapshot;
    this.rememberSnapshotVersions(snapshot);
    return this.mutate({ method: "init", snapshot });
  }

  replaceFiles(snapshot: SlangWorkspaceSnapshot): Promise<void> {
    if (this.disposed) {
      return this.disposedPromise();
    }
    this.latestSnapshot = snapshot;
    this.rememberSnapshotVersions(snapshot);
    return this.mutate({ method: "replaceFiles", snapshot });
  }

  openDocument(document: SlangDocumentSnapshot): Promise<void> {
    if (this.disposed) {
      return this.disposedPromise();
    }
    const current = this.openDocuments.get(document.uri);
    if (current && document.version <= current.version) {
      return Promise.reject(new Error(`Document version ${document.version} is not newer than ${current.version}`));
    }
    const previousVersion = this.documentVersions.get(document.uri);
    const generation = this.advanceDocumentMutation(document.uri);
    this.openDocuments.set(document.uri, document);
    this.documentVersions.set(document.uri, document.version);
    return this.mutate({ method: "openDocument", document }).catch((error: unknown) => {
      this.rollbackDocumentMutation(document.uri, generation, current, previousVersion);
      throw error;
    });
  }

  changeDocument(document: SlangDocumentSnapshot): Promise<void> {
    if (this.disposed) {
      return this.disposedPromise();
    }
    const current = this.openDocuments.get(document.uri);
    if (!current || document.version <= current.version) {
      return Promise.reject(
        new Error(
          current
            ? `Document version ${document.version} is not newer than ${current.version}`
            : `Document "${document.uri}" is not open`,
        ),
      );
    }
    const previousVersion = this.documentVersions.get(document.uri);
    const generation = this.advanceDocumentMutation(document.uri);
    this.openDocuments.set(document.uri, document);
    this.documentVersions.set(document.uri, document.version);
    return this.mutate({ method: "changeDocument", document }).catch((error: unknown) => {
      this.rollbackDocumentMutation(document.uri, generation, current, previousVersion);
      throw error;
    });
  }

  closeDocument(uri: string, documentVersion: number): Promise<void> {
    if (this.disposed) {
      return this.disposedPromise();
    }
    const current = this.openDocuments.get(uri);
    if (!current || current.version !== documentVersion) {
      return Promise.reject(new Error(`Cannot close "${uri}" at stale version ${documentVersion}`));
    }
    const previousVersion = this.documentVersions.get(uri);
    const generation = this.advanceDocumentMutation(uri);
    this.openDocuments.delete(uri);
    return this.mutate({ method: "closeDocument", uri, documentVersion }).catch((error: unknown) => {
      this.rollbackDocumentMutation(uri, generation, current, previousVersion);
      throw error;
    });
  }

  hover(uri: string, position: SlangPosition, documentVersion: number): Promise<HoverDto | undefined> {
    return this.query({ method: "hover", uri, position, documentVersion }, uri, documentVersion);
  }

  definition(uri: string, position: SlangPosition, documentVersion: number): Promise<LocationDto[] | undefined> {
    return this.query({ method: "definition", uri, position, documentVersion }, uri, documentVersion);
  }

  completion(
    uri: string,
    position: SlangPosition,
    documentVersion: number,
    context: SlangCompletionContext = { triggerKind: 1, triggerCharacter: "" },
  ): Promise<CompletionItemDto[] | undefined> {
    return this.query({ method: "completion", uri, position, context, documentVersion }, uri, documentVersion);
  }

  completionResolve(
    uri: string,
    item: CompletionItemDto,
    documentVersion: number,
  ): Promise<CompletionItemDto | undefined> {
    return this.query({ method: "completionResolve", uri, item, documentVersion }, uri, documentVersion);
  }

  signatureHelp(uri: string, position: SlangPosition, documentVersion: number): Promise<SignatureHelpDto | undefined> {
    return this.query({ method: "signatureHelp", uri, position, documentVersion }, uri, documentVersion);
  }

  documentSymbols(uri: string, documentVersion: number): Promise<DocumentSymbolDto[] | undefined> {
    return this.query({ method: "documentSymbols", uri, documentVersion }, uri, documentVersion);
  }

  diagnostics(uri: string, documentVersion: number): Promise<DiagnosticDto[] | undefined> {
    return this.query({ method: "diagnostics", uri, documentVersion }, uri, documentVersion);
  }

  async ready(): Promise<void> {
    this.ensureActive();
    while (true) {
      const recovery = this.recovery;
      const mutationTail = this.mutationTail;
      try {
        await recovery;
      } catch (error) {
        this.ensureActive();
        if (recovery !== this.recovery) {
          continue;
        }
        throw error;
      }
      await mutationTail;
      this.ensureActive();
      if (recovery === this.recovery && mutationTail === this.mutationTail) {
        return;
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.rejectPending(new Error("Slang worker client disposed"));
  }

  private mutate(request: SlangWorkerRequestPayload): Promise<void> {
    const operation = this.mutationTail.then(async () => {
      await this.recovery;
      this.ensureActive();
      await this.send(request);
    });
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async query<T>(
    request: SlangWorkerRequestPayload,
    uri?: string,
    expectedVersion?: number,
  ): Promise<T> {
    this.ensureActive();
    if (uri !== undefined && expectedVersion !== undefined) {
      const currentVersion = this.documentVersions.get(uri);
      if (currentVersion === undefined || expectedVersion > currentVersion) {
        this.documentVersions.set(uri, expectedVersion);
      }
    }
    await this.mutationTail;
    await this.recovery;
    this.ensureActive();
    const response = await this.send(request);
    if (uri !== undefined && expectedVersion !== undefined) {
      const currentVersion = this.documentVersions.get(uri);
      if (response.documentVersion !== expectedVersion || currentVersion !== expectedVersion) {
        throw new StaleSlangResultError(uri, expectedVersion, response.documentVersion);
      }
    }
    return response.result as T;
  }

  private send(request: SlangWorkerRequestPayload): Promise<{ result: unknown; documentVersion?: number }> {
    this.ensureActive();
    const message = { ...request, id: this.nextId } as SlangWorkerRequest;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.pending.delete(message.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private startWorker(): SlangWorker {
    const worker = this.createWorker();
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = (event) => {
      if (worker === this.worker) {
        this.handleCrash(new Error(event.message || "Slang worker crashed"));
      }
    };
    return worker;
  }

  private handleMessage(response: SlangWorkerResponse): void {
    if (this.disposed) {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve({ result: response.result, documentVersion: response.documentVersion });
    } else {
      pending.reject(new Error(response.error));
    }
  }

  private handleCrash(error: Error): void {
    if (this.disposed) {
      return;
    }
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.rejectPending(error);
    this.worker = this.startWorker();
    this.recovery = this.replayState();
    void this.recovery.catch(() => undefined);
  }

  private async replayState(): Promise<void> {
    if (this.latestSnapshot) {
      await this.send({ method: "init", snapshot: this.latestSnapshot });
    }
    for (const document of this.openDocuments.values()) {
      await this.send({ method: "openDocument", document });
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }

  private rememberSnapshotVersions(snapshot: SlangWorkspaceSnapshot): void {
    for (const file of snapshot.files) {
      if (file.version !== undefined && !this.openDocuments.has(file.uri)) {
        this.documentVersions.set(file.uri, file.version);
      }
    }
  }

  private advanceDocumentMutation(uri: string): number {
    const generation = this.nextDocumentMutationGeneration;
    this.nextDocumentMutationGeneration += 1;
    this.documentMutationGenerations.set(uri, generation);
    return generation;
  }

  private rollbackDocumentMutation(
    uri: string,
    generation: number,
    previousDocument: SlangDocumentSnapshot | undefined,
    previousVersion: number | undefined,
  ): void {
    if (this.documentMutationGenerations.get(uri) !== generation) {
      return;
    }
    if (previousDocument) {
      this.openDocuments.set(uri, previousDocument);
    } else {
      this.openDocuments.delete(uri);
    }
    if (previousVersion !== undefined) {
      this.documentVersions.set(uri, previousVersion);
    } else {
      this.documentVersions.delete(uri);
    }
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error("Slang worker client is disposed");
    }
  }

  private disposedPromise(): Promise<never> {
    return Promise.reject(new Error("Slang worker client is disposed"));
  }
}
