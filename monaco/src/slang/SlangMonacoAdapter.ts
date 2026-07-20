import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type {
  CompletionItemDto,
  DiagnosticDto,
  DocumentSymbolDto,
  HoverDto,
  LocationDto,
  SignatureHelpDto,
  SlangDocumentSnapshot,
  SlangPosition,
  SlangRange,
  SlangWorkspaceSnapshot,
} from '@shader-studio/slang-language-service';
import {
  StaleSlangResultError,
  SupersededSlangMutationError,
} from '@shader-studio/slang-language-service';
import {
  acquireEditorModelReference,
  createEditorModelOwner,
  getEditorModelOwnerReferenceCount,
  releaseEditorModel,
  subscribeEditorModelOwnershipChanges,
  type EditorModelOwnershipChange,
} from '../modelRegistry';

export const SLANG_LANGUAGE_MARKER_OWNER = 'slang-language';
export const SLANG_COMPILE_MARKER_OWNER = 'slang-compile';

export interface SlangMonacoClient {
  init(snapshot: SlangWorkspaceSnapshot): Promise<void>;
  replaceFiles(snapshot: SlangWorkspaceSnapshot): Promise<void>;
  openDocument(document: SlangDocumentSnapshot): Promise<void>;
  changeDocument(document: SlangDocumentSnapshot): Promise<void>;
  closeDocument(uri: string, documentVersion: number): Promise<void>;
  completion(uri: string, position: SlangPosition, documentVersion: number, context?: { triggerKind: number; triggerCharacter: string }): Promise<CompletionItemDto[] | undefined>;
  completionResolve(uri: string, item: CompletionItemDto, documentVersion: number): Promise<CompletionItemDto | undefined>;
  hover(uri: string, position: SlangPosition, documentVersion: number): Promise<HoverDto | undefined>;
  definition(uri: string, position: SlangPosition, documentVersion: number): Promise<LocationDto[] | undefined>;
  signatureHelp(uri: string, position: SlangPosition, documentVersion: number): Promise<SignatureHelpDto | undefined>;
  documentSymbols(uri: string, documentVersion: number): Promise<DocumentSymbolDto[] | undefined>;
  diagnostics(uri: string, documentVersion: number): Promise<DiagnosticDto[] | undefined>;
  dispose(): void;
}

interface ModelState {
  model: Monaco.editor.ITextModel;
  uri: string;
  path: string;
  version: number;
  changeDisposable: Monaco.IDisposable;
  applyingSnapshot: boolean;
  dirty: boolean;
  baselineSource: string;
  open: boolean;
  opening?: Promise<void>;
  syncing?: Promise<void>;
  syncedVersion?: number;
}

function relativeLanguageServicePath(path: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`Slang workspace path "${path}" contains invalid percent encoding`);
  }
  const normalized = decoded.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.includes('..')) {
    throw new Error(`Slang workspace path "${path}" contains traversal`);
  }
  if (!normalized || normalized === '/workspace') {
    throw new Error(`Slang workspace path "${path}" does not name a file`);
  }
  if (normalized.startsWith('/workspace/')) {
    return normalized.slice('/workspace/'.length);
  }
  if (normalized.startsWith('/')) {
    throw new Error(`Slang workspace path "${path}" is outside /workspace`);
  }
  return normalized;
}

interface CompletionMetadata {
  dto: CompletionItemDto;
  uri: string;
  version: number;
}

export interface SetWorkspaceOptions {
  createDependencyModels?: boolean;
}

function normalizedPath(pathname: string): string {
  const parts: string[] = [];
  for (const part of decodeURIComponent(pathname).replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join('/')}`;
}

export function canonicalModelUri(input: string): string {
  const uri = new URL(input);
  if (uri.protocol !== 'file:') {
    return uri.href;
  }
  const host = uri.hostname.toLowerCase() === 'localhost' ? '' : uri.hostname.toLowerCase();
  const path = normalizedPath(uri.pathname)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `file://${host}${path}`;
}

function toSlangPosition(position: Monaco.Position): SlangPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function toRange(monaco: typeof Monaco, range: SlangRange): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function markdown(value: { value: string }): Monaco.IMarkdownString {
  return { value: value.value };
}

function diagnosticSeverity(monaco: typeof Monaco, severity: number): Monaco.MarkerSeverity {
  return [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint][severity - 1]
    ?? monaco.MarkerSeverity.Error;
}

export class SlangMonacoAdapter implements Monaco.languages.CompletionItemProvider,
  Monaco.languages.HoverProvider, Monaco.languages.DefinitionProvider,
  Monaco.languages.SignatureHelpProvider, Monaco.languages.DocumentSymbolProvider {
  readonly signatureHelpTriggerCharacters = ['(', ','];
  private snapshot: SlangWorkspaceSnapshot | undefined;
  private readonly files = new Map<string, SlangWorkspaceSnapshot['files'][number]>();
  private readonly models = new Map<string, ModelState>();
  private readonly completionMetadata = new WeakMap<object, CompletionMetadata>();
  private readonly modelOwner = createEditorModelOwner('adapter');
  private readonly ownershipSubscription: Monaco.IDisposable;
  private readonly disposables: Monaco.IDisposable[];
  private ownershipReconciliation: Promise<void> = Promise.resolve();
  private creatingSnapshotModels = false;
  private disposed = false;

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly client: SlangMonacoClient,
    providerDisposables: Monaco.IDisposable[] = [],
  ) {
    this.disposables = [...providerDisposables];
    this.ownershipSubscription = subscribeEditorModelOwnershipChanges(monaco, (change) => {
      this.handleOwnershipChange(change);
    });
  }

  addProviderDisposables(disposables: Monaco.IDisposable[]): void {
    if (this.disposed) {
      disposables.forEach((item) => item.dispose());
      return;
    }
    this.disposables.push(...disposables);
  }

  setWorkspace(snapshot: SlangWorkspaceSnapshot, options: SetWorkspaceOptions = {}): Promise<void> {
    const operation = this.ownershipReconciliation.then(() => this.applyWorkspace(snapshot, options));
    this.ownershipReconciliation = operation.catch(() => undefined);
    return operation;
  }

  private async applyWorkspace(snapshot: SlangWorkspaceSnapshot, options: SetWorkspaceOptions): Promise<void> {
    const canonicalSnapshot = {
      ...snapshot,
      files: snapshot.files.map((file) => ({
        ...file,
        uri: canonicalModelUri(file.uri),
        path: relativeLanguageServicePath(file.path),
      })),
    };
    const changingRoot = this.snapshot !== undefined && this.snapshot.rootUri !== canonicalSnapshot.rootUri;
    if (changingRoot) {
      const previousStates = [...this.models.values()];
      await Promise.allSettled(previousStates.map((state) => this.client.closeDocument(state.uri, state.model.getVersionId())));
      for (const state of previousStates) {
        this.releaseModelState(state);
      }
      this.models.clear();
    }
    if (this.snapshot === undefined || changingRoot) {
      await this.client.init(canonicalSnapshot);
    } else {
      const nextUris = new Set(canonicalSnapshot.files.map((file) => file.uri));
      for (const [uri, state] of [...this.models]) {
        const nextFile = canonicalSnapshot.files.find((file) => file.uri === uri);
        let hasNonAdapterOwners = this.hasNonAdapterOwners(state);
        if (hasNonAdapterOwners) {
          await this.ensureDocumentReady(state);
          hasNonAdapterOwners = this.hasNonAdapterOwners(state);
        }
        if (!nextUris.has(uri)) {
          if (state.dirty || hasNonAdapterOwners) {
            continue;
          }
          if (state.open) {
            await state.syncing;
            if (this.hasNonAdapterOwners(state)) {
              continue;
            }
            await this.client.closeDocument(state.uri, state.model.getVersionId());
            state.open = false;
            state.syncedVersion = undefined;
            if (this.hasNonAdapterOwners(state)) {
              await this.ensureDocumentReady(state);
              continue;
            }
          }
          if (this.hasNonAdapterOwners(state)) {
            continue;
          }
          this.releaseModelState(state);
          this.models.delete(uri);
          continue;
        }
        if (nextFile && state.model.getValue() === nextFile.source) {
          state.baselineSource = nextFile.source;
          state.dirty = false;
          continue;
        }
        if (nextFile && (state.dirty || hasNonAdapterOwners)) {
          state.baselineSource = nextFile.source;
          state.dirty = true;
          continue;
        }
        if (nextFile && state.model.getValue() !== nextFile.source) {
          if (state.open) {
            await state.syncing;
            if (this.hasNonAdapterOwners(state)) {
              state.baselineSource = nextFile.source;
              state.dirty = true;
              continue;
            }
            await this.client.closeDocument(state.uri, state.model.getVersionId());
            state.open = false;
            state.syncedVersion = undefined;
            if (this.hasNonAdapterOwners(state)) {
              state.baselineSource = nextFile.source;
              state.dirty = true;
              await this.ensureDocumentReady(state);
              continue;
            }
          }
          if (this.hasNonAdapterOwners(state)) {
            state.baselineSource = nextFile.source;
            state.dirty = true;
            continue;
          }
          state.applyingSnapshot = true;
          state.model.setValue(nextFile.source);
          state.applyingSnapshot = false;
          state.baselineSource = nextFile.source;
          state.dirty = false;
          this.clearLanguageMarkers(state.model);
        }
      }
      await this.client.replaceFiles(canonicalSnapshot);
    }
    this.snapshot = canonicalSnapshot;
    this.files.clear();
    for (const file of this.snapshot.files) {
      this.files.set(file.uri, file);
    }
    await this.sweepAbsentStates();
    if (options.createDependencyModels !== false) {
      this.creatingSnapshotModels = true;
      try {
        for (const file of this.snapshot.files) {
          this.getOrCreateModel(file.uri);
        }
      } finally {
        this.creatingSnapshotModels = false;
      }
    }
    await this.refreshOwnedModelDiagnostics();
  }

  async replaceWorkspace(snapshot: SlangWorkspaceSnapshot): Promise<void> {
    this.snapshot = {
      ...snapshot,
      files: snapshot.files.map((file) => ({
        ...file,
        uri: canonicalModelUri(file.uri),
        path: relativeLanguageServicePath(file.path),
      })),
    };
    this.files.clear();
    for (const file of this.snapshot.files) {
      this.files.set(file.uri, file);
    }
    await this.client.replaceFiles(this.snapshot);
    await this.refreshOwnedModelDiagnostics();
  }

  getOrCreateModel(inputUri: string, source?: string): Monaco.editor.ITextModel | undefined {
    const uri = canonicalModelUri(inputUri);
    const tracked = this.models.get(uri);
    if (tracked && !tracked.model.isDisposed()) {
      return tracked.model;
    }
    const file = this.files.get(uri);
    if (!file && source === undefined) {
      return undefined;
    }
    const baselineSource = source ?? file!.source;
    const acquired = acquireEditorModelReference(this.monaco, uri, baselineSource, 'slang', this.modelOwner);
    const model = acquired.model;
    const state: ModelState = {
      model,
      uri,
      path: file?.path ?? new URL(uri).pathname.split('/').at(-1) ?? 'shader.slang',
      version: model.getVersionId(),
      changeDisposable: { dispose() {} },
      applyingSnapshot: false,
      dirty: model.getValue() !== baselineSource,
      baselineSource,
      open: false,
    };
    state.changeDisposable = model.onDidChangeContent(() => {
      if (state.applyingSnapshot) {
        return;
      }
      state.version = model.getVersionId();
      state.dirty = model.getValue() !== state.baselineSource;
      void this.ensureDocumentReady(state).then(
        () => this.refreshDiagnostics(model),
        () => undefined,
      );
    });
    this.models.set(uri, state);
    if (!this.creatingSnapshotModels && this.hasNonAdapterOwners(state)) {
      this.enqueueOwnedModelDiagnostics(state);
    }
    return model;
  }

  async provideCompletionItems(
    model: Monaco.editor.ITextModel,
    position: Monaco.Position,
    context: Monaco.languages.CompletionContext,
    token: Monaco.CancellationToken,
  ): Promise<Monaco.languages.CompletionList | undefined> {
    if (token.isCancellationRequested) {
      return undefined;
    }
    const state = this.stateFor(model);
    if (!state) {
      return undefined;
    }
    const version = model.getVersionId();
    await this.ensureDocumentReady(state);
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    const values = await this.dropStale(this.client.completion(state.uri, toSlangPosition(position), version, {
      triggerKind: context.triggerKind ?? 1,
      triggerCharacter: context.triggerCharacter ?? '',
    }));
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    const suggestions = (values ?? []).map((value) => {
      const item = this.toCompletion(value);
      this.completionMetadata.set(item, { dto: value, uri: state.uri, version });
      return item;
    });
    return { suggestions };
  }

  async resolveCompletionItem(item: Monaco.languages.CompletionItem, token: Monaco.CancellationToken): Promise<Monaco.languages.CompletionItem> {
    const metadata = this.completionMetadata.get(item);
    if (!metadata || token.isCancellationRequested) {
      return item;
    }
    const model = this.models.get(metadata.uri)?.model;
    if (!model || model.getVersionId() !== metadata.version) {
      return item;
    }
    const state = this.models.get(metadata.uri);
    if (!state) {
      return item;
    }
    await this.ensureDocumentReady(state);
    if (this.isDropped(model, metadata.version, token)) {
      return item;
    }
    const value = await this.dropStale(this.client.completionResolve(metadata.uri, metadata.dto, metadata.version));
    if (!value || this.isDropped(model, metadata.version, token)) {
      return item;
    }
    const resolved = this.toCompletion(value);
    this.completionMetadata.set(resolved, { ...metadata, dto: value });
    return resolved;
  }

  async provideHover(model: Monaco.editor.ITextModel, position: Monaco.Position, token: Monaco.CancellationToken): Promise<Monaco.languages.Hover | undefined> {
    const state = this.stateFor(model);
    if (!state) {
      return undefined;
    }
    const version = model.getVersionId();
    await this.ensureDocumentReady(state);
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    const value = await this.dropStale(this.client.hover(state.uri, toSlangPosition(position), version));
    if (!value || this.isDropped(model, version, token)) {
      return undefined;
    }
    return { contents: [markdown(value.contents)], range: toRange(this.monaco, value.range) };
  }

  async provideDefinition(model: Monaco.editor.ITextModel, position: Monaco.Position, token: Monaco.CancellationToken): Promise<Monaco.languages.Definition | undefined> {
    const state = this.stateFor(model);
    if (!state) {
      return undefined;
    }
    const version = model.getVersionId();
    await this.ensureDocumentReady(state);
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    const values = await this.dropStale(this.client.definition(state.uri, toSlangPosition(position), version));
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    return (values ?? []).map((value) => {
      const uri = canonicalModelUri(value.uri);
      this.getOrCreateModel(uri);
      return { uri: this.monaco.Uri.parse(uri), range: toRange(this.monaco, value.range) };
    });
  }

  async provideSignatureHelp(model: Monaco.editor.ITextModel, position: Monaco.Position, token: Monaco.CancellationToken): Promise<Monaco.languages.SignatureHelpResult | undefined> {
    const state = this.stateFor(model);
    if (!state) {
      return undefined;
    }
    const version = model.getVersionId();
    await this.ensureDocumentReady(state);
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    const value = await this.dropStale(this.client.signatureHelp(state.uri, toSlangPosition(position), version));
    if (!value || this.isDropped(model, version, token)) {
      return undefined;
    }
    return {
      value: {
        activeSignature: value.activeSignature,
        activeParameter: value.activeParameter,
        signatures: value.signatures.map((signature) => ({
          label: signature.label,
          documentation: markdown(signature.documentation),
          parameters: signature.parameters.map((parameter) => ({
            label: signature.label.slice(parameter.label[0], parameter.label[1]),
            documentation: markdown(parameter.documentation),
          })),
        })),
      },
      dispose() {},
    };
  }

  async provideDocumentSymbols(model: Monaco.editor.ITextModel, token: Monaco.CancellationToken): Promise<Monaco.languages.DocumentSymbol[] | undefined> {
    const state = this.stateFor(model);
    if (!state) {
      return undefined;
    }
    const version = model.getVersionId();
    await this.ensureDocumentReady(state);
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    const values = await this.dropStale(this.client.documentSymbols(state.uri, version));
    if (this.isDropped(model, version, token)) {
      return undefined;
    }
    return (values ?? []).map((value) => this.toSymbol(value));
  }

  async refreshDiagnostics(model: Monaco.editor.ITextModel): Promise<void> {
    const state = this.stateFor(model);
    if (!state) {
      return;
    }
    const version = model.getVersionId();
    await this.ensureDocumentReady(state);
    if (model.getVersionId() !== version || this.disposed) {
      return;
    }
    const values = await this.dropStale(this.client.diagnostics(state.uri, version));
    if (model.getVersionId() !== version || this.disposed) {
      return;
    }
    this.monaco.editor.setModelMarkers(model, SLANG_LANGUAGE_MARKER_OWNER, (values ?? []).map((value) => ({
      severity: diagnosticSeverity(this.monaco, value.severity),
      message: value.message,
      code: value.code,
      ...this.markerRange(value.range),
    })));
  }

  clearLanguageMarkers(model: Monaco.editor.ITextModel): void {
    this.monaco.editor.setModelMarkers(model, SLANG_LANGUAGE_MARKER_OWNER, []);
  }

  setCompileMarkers(model: Monaco.editor.ITextModel, markers: Monaco.editor.IMarkerData[]): void {
    this.monaco.editor.setModelMarkers(model, SLANG_COMPILE_MARKER_OWNER, markers);
  }

  async waitForOwnershipReconciliation(): Promise<void> {
    while (true) {
      const pending = this.ownershipReconciliation;
      await pending;
      if (pending === this.ownershipReconciliation) {
        return;
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.ownershipSubscription.dispose();
    for (const state of this.models.values()) {
      this.releaseModelState(state);
    }
    this.models.clear();
    this.disposables.splice(0).forEach((item) => item.dispose());
    this.client.dispose();
  }

  private documentSnapshot(state: ModelState): SlangDocumentSnapshot {
    return { uri: state.uri, path: state.path, source: state.model.getValue(), version: state.model.getVersionId() };
  }

  private stateFor(model: Monaco.editor.ITextModel): ModelState | undefined {
    const uri = canonicalModelUri(model.uri.toString());
    return this.models.get(uri);
  }

  private releaseModelState(state: ModelState): void {
    state.changeDisposable.dispose();
    this.clearLanguageMarkers(state.model);
    this.monaco.editor.setModelMarkers(state.model, SLANG_COMPILE_MARKER_OWNER, []);
    releaseEditorModel(this.monaco, state.model, this.modelOwner);
  }

  private hasNonAdapterOwners(state: ModelState): boolean {
    return getEditorModelOwnerReferenceCount(this.monaco, state.model, { excludingKind: 'adapter' }) > 0;
  }

  private handleOwnershipChange(change: EditorModelOwnershipChange): void {
    if (this.disposed || change.kind === 'adapter') {
      return;
    }
    const uri = canonicalModelUri(change.uri);
    const state = this.models.get(uri);
    if (!state || state.model !== change.model) {
      return;
    }
    if (this.hasNonAdapterOwners(state)) {
      this.enqueueOwnedModelDiagnostics(state);
      return;
    }
    if (this.files.has(uri)) {
      return;
    }
    const cleanup = this.ownershipReconciliation.then(() => this.cleanupAbsentState(uri));
    this.ownershipReconciliation = cleanup.catch(() => undefined);
  }

  private enqueueOwnedModelDiagnostics(state: ModelState): void {
    const refresh = this.ownershipReconciliation.then(async () => {
      if (
        this.disposed || this.models.get(state.uri) !== state ||
        state.model.isDisposed() || !this.hasNonAdapterOwners(state)
      ) {
        return;
      }
      await this.refreshDiagnostics(state.model);
    });
    this.ownershipReconciliation = refresh.catch(() => undefined);
  }

  private async refreshOwnedModelDiagnostics(): Promise<void> {
    const refreshes = [...this.models.values()]
      .filter((state) => this.hasNonAdapterOwners(state))
      .map((state) => this.refreshDiagnostics(state.model));
    await Promise.allSettled(refreshes);
  }

  private async cleanupAbsentState(uri: string): Promise<void> {
    let state = this.models.get(uri);
    if (this.disposed || !state || this.files.has(uri) || this.hasNonAdapterOwners(state)) {
      return;
    }
    await state.syncing;
    state = this.models.get(uri);
    if (this.disposed || !state || this.files.has(uri) || this.hasNonAdapterOwners(state)) {
      return;
    }
    if (state.open) {
      await this.client.closeDocument(state.uri, state.model.getVersionId());
      state.open = false;
      state.syncedVersion = undefined;
    }
    if (this.disposed || this.files.has(uri)) {
      return;
    }
    if (this.hasNonAdapterOwners(state)) {
      await this.ensureDocumentReady(state);
      return;
    }
    if (this.models.get(uri) !== state) {
      return;
    }
    this.models.delete(uri);
    this.releaseModelState(state);
  }

  private async sweepAbsentStates(): Promise<void> {
    for (const [uri, state] of [...this.models]) {
      if (!this.files.has(uri) && !this.hasNonAdapterOwners(state)) {
        await this.cleanupAbsentState(uri);
      }
    }
  }

  private ensureDocumentReady(state: ModelState): Promise<void> {
    const previous = state.syncing ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      if (!state.open) {
        if (!state.opening) {
          const document = this.documentSnapshot(state);
          state.opening = this.client.openDocument(document).then(() => {
            state.open = true;
            state.syncedVersion = document.version;
          }).finally(() => {
            state.opening = undefined;
          });
        }
        await state.opening;
      }
      const document = this.documentSnapshot(state);
      if (state.syncedVersion !== document.version) {
        await this.client.changeDocument(document);
        state.syncedVersion = document.version;
      }
    });
    const syncing = operation.finally(() => {
      if (state.syncing === syncing) {
        state.syncing = undefined;
      }
    });
    state.syncing = syncing;
    return syncing;
  }

  private isDropped(model: Monaco.editor.ITextModel, version: number, token: Monaco.CancellationToken): boolean {
    return this.disposed || token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version;
  }

  private toCompletion(value: CompletionItemDto): Monaco.languages.CompletionItem {
    return {
      label: value.label,
      kind: Math.max(0, value.kind - 1),
      detail: value.detail,
      documentation: value.documentation ? markdown(value.documentation) : undefined,
      commitCharacters: value.commitCharacters,
      insertText: value.textEdit?.text ?? value.label,
      range: value.textEdit ? toRange(this.monaco, value.textEdit.range) : undefined,
    } as Monaco.languages.CompletionItem;
  }

  private toSymbol(value: DocumentSymbolDto): Monaco.languages.DocumentSymbol {
    return {
      name: value.name,
      detail: value.detail,
      kind: Math.max(0, value.kind - 1),
      range: toRange(this.monaco, value.range),
      selectionRange: toRange(this.monaco, value.selectionRange),
      children: value.children.map((child) => this.toSymbol(child)),
      tags: [],
    };
  }

  private markerRange(range: SlangRange): Pick<Monaco.editor.IMarkerData, 'startLineNumber' | 'startColumn' | 'endLineNumber' | 'endColumn'> {
    return {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    };
  }

  private async dropStale<T>(operation: Promise<T>): Promise<T | undefined> {
    try {
      return await operation;
    } catch (error) {
      if (error instanceof StaleSlangResultError || error instanceof SupersededSlangMutationError) {
        return undefined;
      }
      throw error;
    }
  }
}
