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
  private readonly disposables: Monaco.IDisposable[];
  private disposed = false;

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly client: SlangMonacoClient,
    providerDisposables: Monaco.IDisposable[] = [],
  ) {
    this.disposables = [...providerDisposables];
  }

  addProviderDisposables(disposables: Monaco.IDisposable[]): void {
    if (this.disposed) {
      disposables.forEach((item) => item.dispose());
      return;
    }
    this.disposables.push(...disposables);
  }

  async setWorkspace(snapshot: SlangWorkspaceSnapshot, options: SetWorkspaceOptions = {}): Promise<void> {
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
        if (!nextUris.has(uri)) {
          if (state.dirty || this.hasNonAdapterOwners(state)) {
            continue;
          }
          if (state.open) {
            await this.client.closeDocument(state.uri, state.model.getVersionId());
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
        if (nextFile && (state.dirty || this.hasNonAdapterOwners(state))) {
          state.baselineSource = nextFile.source;
          state.dirty = true;
          continue;
        }
        if (nextFile && state.model.getValue() !== nextFile.source) {
          if (state.open) {
            await this.client.closeDocument(state.uri, state.model.getVersionId());
            state.open = false;
          }
          state.applyingSnapshot = true;
          state.model.setValue(nextFile.source);
          state.applyingSnapshot = false;
          state.baselineSource = nextFile.source;
          state.dirty = false;
        }
      }
      await this.client.replaceFiles(canonicalSnapshot);
    }
    this.snapshot = canonicalSnapshot;
    this.files.clear();
    for (const file of this.snapshot.files) {
      this.files.set(file.uri, file);
    }
    if (options.createDependencyModels !== false) {
      for (const file of this.snapshot.files) {
        this.getOrCreateModel(file.uri);
      }
    }
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
      open: getEditorModelOwnerReferenceCount(this.monaco, model, { excludingKind: 'adapter' }) > 0,
    };
    state.changeDisposable = model.onDidChangeContent(() => {
      if (state.applyingSnapshot) {
        return;
      }
      state.version = model.getVersionId();
      state.dirty = model.getValue() !== state.baselineSource;
      const update = state.open
        ? this.client.changeDocument(this.documentSnapshot(state))
        : this.client.openDocument(this.documentSnapshot(state));
      state.open = true;
      void update.then(
        () => this.refreshDiagnostics(model),
        () => undefined,
      );
    });
    this.models.set(uri, state);
    if (state.open) {
      void this.client.openDocument(this.documentSnapshot(state)).then(
        () => this.refreshDiagnostics(model),
        () => undefined,
      );
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

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
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
