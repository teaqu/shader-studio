import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type {
  DocumentRevision,
  LanguageService,
  ShaderLanguage,
} from "@shader-studio/language-server-core";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";

export type LanguageServiceFactory = () => Promise<LanguageService>;
export type MonacoLanguageServiceFactories = Record<ShaderLanguage, LanguageServiceFactory>;

interface ServiceState {
  service?: Promise<LanguageService>;
  readonly opened: Set<string>;
}

export class MonacoLanguageServiceManager {
  private readonly environments = new Map<string, ShaderAuthoringEnvironment>();
  private readonly enabled: Record<ShaderLanguage, boolean> = { glsl: true, slang: true };
  private colorDecoratorsEnabled = true;
  private readonly states: Record<ShaderLanguage, ServiceState> = {
    glsl: { opened: new Set() },
    slang: { opened: new Set() },
  };
  private readonly disposables: Monaco.IDisposable[] = [];
  private readonly modelDisposables = new Map<string, Monaco.IDisposable>();
  private readonly virtualUrisByDocument = new Map<string, Set<string>>();
  private readonly virtualOwners = new Map<string, Set<string>>();
  private readonly managedVirtualModels = new Map<string, Monaco.editor.ITextModel>();

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly factories: MonacoLanguageServiceFactories,
  ) {
    for (const language of ["glsl", "slang"] as const) this.registerProviders(language);
    for (const model of monaco.editor.getModels()) this.attachModel(model);
    this.disposables.push(monaco.editor.onDidCreateModel((model) => this.attachModel(model)));
    this.disposables.push(monaco.editor.onWillDisposeModel((model) => { void this.closeModel(model); }));
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    this.syncVirtualModels(environment);
    this.environments.set(environment.documentUri, environment);
    if (!this.enabled[environment.languageId]) return;
    const model = this.monaco.editor.getModels().find((candidate) => candidate.uri.toString() === environment.documentUri);
    if (model) await this.ensureModel(model);
  }

  async setEnabled(language: ShaderLanguage, enabled: boolean): Promise<void> {
    if (this.enabled[language] === enabled) return;
    this.enabled[language] = enabled;
    if (!enabled) {
      const state = this.states[language];
      const service = await state.service;
      await service?.dispose();
      state.service = undefined;
      state.opened.clear();
      for (const model of this.modelsFor(language)) this.monaco.editor.setModelMarkers(model, markerOwner(language), []);
      return;
    }
    for (const model of this.modelsFor(language)) await this.ensureModel(model);
  }

  setColorDecoratorsEnabled(enabled: boolean): void {
    this.colorDecoratorsEnabled = enabled;
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    for (const disposable of this.modelDisposables.values()) disposable.dispose();
    this.modelDisposables.clear();
    for (const model of this.managedVirtualModels.values()) model.dispose();
    this.managedVirtualModels.clear();
    this.virtualOwners.clear();
    this.virtualUrisByDocument.clear();
    for (const language of ["glsl", "slang"] as const) {
      void this.states[language].service?.then((service) => service.dispose());
      this.states[language].service = undefined;
      this.states[language].opened.clear();
    }
  }

  private registerProviders(language: ShaderLanguage): void {
    const languages = this.monaco.languages;
    this.disposables.push(languages.registerCompletionItemProvider(language, {
      triggerCharacters: ["."],
      provideCompletionItems: async (model, position) => {
        // Completion is the one request the model is expected to outrun: quick
        // suggestions fire on the first keystroke and the user keeps typing
        // while the request is in flight. Preserve useful stale results and
        // catch up below when the stale response is empty.
        let response: { value: Awaited<ReturnType<LanguageService["completion"]>>; stale: boolean };
        do {
          response = await this.requestAllowingStale(model, (service, revision) => service.completion({ document: revision, position: toLspPosition(position) }), []);
          // Monaco closes an initial suggestion session when its provider returns
          // no items. An empty stale response therefore cannot rely on
          // `incomplete` to trigger another query; catch up here before the
          // provider returns. A non-empty stale list is still useful immediately
          // and remains marked incomplete so Monaco refines it while typing.
        } while (response.stale && response.value.length === 0);
        const { value: result, stale } = response;
        const word = model.getWordUntilPosition(position);
        return { incomplete: stale, suggestions: result.map((item) => ({
          label: item.label,
          kind: (item.kind ?? this.monaco.languages.CompletionItemKind.Variable) as Monaco.languages.CompletionItemKind,
          detail: item.detail,
          documentation: markdownValue(item.documentation),
          insertText: item.textEdit?.newText ?? (typeof item.insertText === "string" ? item.insertText : item.label),
          range: item.textEdit && "range" in item.textEdit
            ? toMonacoRange(this.monaco, item.textEdit.range)
            : new this.monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        })) };
      },
    }));
    this.disposables.push(languages.registerHoverProvider(language, {
      provideHover: async (model, position) => {
        const result = await this.request(model, (service, revision) => service.hover({ document: revision, position: toLspPosition(position) }), null);
        return result ? { contents: [{ value: hoverValue(result.contents) }], range: result.range ? toMonacoRange(this.monaco, result.range) : undefined } : null;
      },
    }));
    this.disposables.push(languages.registerDefinitionProvider(language, {
      provideDefinition: async (model, position) => this.request(model, async (service, revision) => (
        (await service.definition({ document: revision, position: toLspPosition(position) })).map((location) => ({
          uri: this.monaco.Uri.parse(location.uri),
          range: toMonacoRange(this.monaco, location.range),
        }))
      ), []),
    }));
    this.disposables.push(languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ["(", ","],
      provideSignatureHelp: async (model, position) => {
        const result = await this.request(model, (service, revision) => service.signatureHelp({ document: revision, position: toLspPosition(position) }), null);
        if (!result) return null;
        return {
          value: {
            signatures: result.signatures.map((signature) => ({
              label: signature.label,
              documentation: markdownValue(signature.documentation),
              parameters: signature.parameters?.map((parameter) => ({ label: parameter.label, documentation: markdownValue(parameter.documentation) })) ?? [],
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
          },
          dispose() {},
        };
      },
    }));
    this.disposables.push(languages.registerDocumentSymbolProvider(language, {
      provideDocumentSymbols: async (model) => this.request(model, async (service, revision) => (
        (await service.documentSymbols({ document: revision })).map((symbol) => ({
          name: symbol.name,
          detail: symbol.detail ?? "",
          kind: symbol.kind as Monaco.languages.SymbolKind,
          range: toMonacoRange(this.monaco, symbol.range),
          selectionRange: toMonacoRange(this.monaco, symbol.selectionRange),
          tags: [],
          children: symbol.children?.map((child) => ({
            name: child.name,
            detail: child.detail ?? "",
            kind: child.kind as Monaco.languages.SymbolKind,
            range: toMonacoRange(this.monaco, child.range),
            selectionRange: toMonacoRange(this.monaco, child.selectionRange),
            tags: [],
          })),
        }))
      ), []),
    }));
    this.disposables.push(languages.registerReferenceProvider(language, {
      provideReferences: async (model, position, context) => this.request(model, async (service, revision) => (
        (await service.references({
          document: revision,
          position: toLspPosition(position),
          includeDeclaration: context.includeDeclaration,
        })).map((location) => ({
          uri: this.monaco.Uri.parse(location.uri),
          range: toMonacoRange(this.monaco, location.range),
        }))
      ), []),
    }));
    this.disposables.push(languages.registerDocumentHighlightProvider(language, {
      provideDocumentHighlights: async (model, position) => this.request(model, async (service, revision) => (
        (await service.documentHighlights({ document: revision, position: toLspPosition(position) })).map((highlight) => ({
          range: toMonacoRange(this.monaco, highlight.range),
          kind: highlightKind(highlight.kind),
        }))
      ), []),
    }));
    this.disposables.push(languages.registerRenameProvider(language, {
      provideRenameEdits: async (model, position, newName) => this.request(model, async (service, revision) => {
        const result = await service.rename({ document: revision, position: toLspPosition(position), newName });
        const edits = result?.changes?.[model.uri.toString()] ?? [];
        if (edits.length === 0) {
          return { edits: [], rejectReason: RENAME_REJECTED };
        }
        return {
          edits: edits.map((edit) => ({
            resource: model.uri,
            versionId: model.getVersionId(),
            textEdit: { range: toMonacoRange(this.monaco, edit.range), text: edit.newText },
          })),
        };
      }, { edits: [], rejectReason: RENAME_REJECTED }),
    }));
    this.disposables.push(languages.registerColorProvider(language, {
      provideDocumentColors: async (model) => {
        if (!this.colorDecoratorsEnabled) return [];
        return this.request(model, async (service, revision) => (
          (await service.documentColors({ document: revision })).map((color) => ({ color: color.color, range: toMonacoRange(this.monaco, color.range) }))
        ), []);
      },
      provideColorPresentations: async (model, colorInfo) => this.request(model, async (service, revision) => (
        (await service.colorPresentations({ document: revision, color: colorInfo.color, range: toLspRange(colorInfo.range) })).map((item) => ({
          label: item.label,
          textEdit: item.textEdit ? { range: toMonacoRange(this.monaco, item.textEdit.range), text: item.textEdit.newText } : undefined,
        }))
      ), []),
    }));
  }

  private attachModel(model: Monaco.editor.ITextModel): void {
    const language = shaderLanguage(model.getLanguageId());
    if (!language) return;
    const uri = model.uri.toString();
    this.modelDisposables.get(uri)?.dispose();
    this.modelDisposables.set(uri, model.onDidChangeContent(() => { void this.ensureModel(model); }));
    if (this.environments.has(uri) && this.enabled[language]) void this.ensureModel(model);
  }

  /**
   * Opens or re-syncs `model` with its language service and republishes
   * diagnostics, returning the exact version that was synced. Every request
   * (completion, hover, ...) calls this first and must build its document
   * revision from the returned version - not by re-reading the model - or
   * the fix below does not hold.
   *
   * Content used to sync only from the onDidChangeContent listener below,
   * firing a separate unawaited task per keystroke. A request built its
   * document revision from the model's version immediately, so it could
   * reach the language service before that task's changeDocument landed -
   * the service would look up a version it had not seen yet, find nothing,
   * and return empty. Quick suggestions felt broken because that race loses
   * more often for completion, which fires right on the keystroke, than for
   * hover, which fires well after typing stops.
   *
   * Routing every request through this same sync call removes that race, but
   * ensureModel's own sync is itself async: more keystrokes can land while
   * *this* call is in flight. Re-reading the model afterward to build the
   * revision (the first fix here did exactly that) picks up a version the
   * service was still never told about - and because that read matches the
   * *live* model, the staleness check below sees no mismatch and reports the
   * empty result as final, which is worse than stale: it stops Monaco from
   * ever retrying. Returning the version this call actually synced, for the
   * caller to build the revision from directly, closes that gap.
   */
  private async ensureModel(model: Monaco.editor.ITextModel): Promise<{ service: LanguageService; version: number } | undefined> {
    const language = shaderLanguage(model.getLanguageId());
    const environment = this.environments.get(model.uri.toString());
    if (!language || !environment || !this.enabled[language]) return undefined;
    const service = await this.service(language);
    await service.syncEnvironment(environment);
    const uri = model.uri.toString();
    const version = model.getVersionId();
    const document = { uri, languageId: language, version, text: model.getValue() };
    if (!this.states[language].opened.has(uri)) {
      await service.openDocument(document);
      this.states[language].opened.add(uri);
    } else {
      await service.changeDocument(document);
    }
    await this.publishDiagnostics(model, service, environment);
    return { service, version };
  }

  private async closeModel(model: Monaco.editor.ITextModel): Promise<void> {
    const uri = model.uri.toString();
    this.modelDisposables.get(uri)?.dispose();
    this.modelDisposables.delete(uri);
    const language = shaderLanguage(model.getLanguageId());
    if (!language || !this.states[language].opened.delete(uri)) return;
    await (await this.states[language].service)?.closeDocument(uri);
  }

  private async service(language: ShaderLanguage): Promise<LanguageService> {
    const state = this.states[language];
    state.service ??= this.factories[language]().then(async (service) => { await service.initialize(); return service; });
    return state.service;
  }

  private async request<T>(model: Monaco.editor.ITextModel, run: (service: LanguageService, revision: DocumentRevision) => Promise<T>, fallback: T): Promise<T> {
    const { value, stale } = await this.requestAllowingStale(model, run, fallback);
    return stale ? fallback : value;
  }

  /** Runs a request and reports whether the document moved on while it ran. */
  private async requestAllowingStale<T>(model: Monaco.editor.ITextModel, run: (service: LanguageService, revision: DocumentRevision) => Promise<T>, fallback: T): Promise<{ value: T; stale: boolean }> {
    const language = shaderLanguage(model.getLanguageId());
    const environment = this.environments.get(model.uri.toString());
    if (!language || !environment || !this.enabled[language]) return { value: fallback, stale: false };
    const ensured = await this.ensureModel(model);
    if (!ensured) return { value: fallback, stale: false };
    const revision: DocumentRevision = { uri: model.uri.toString(), languageId: language, version: ensured.version, environmentGeneration: environment.generation };
    const result = await run(ensured.service, revision);
    const current = this.environments.get(model.uri.toString());
    const stale = model.getVersionId() !== revision.version || current?.generation !== revision.environmentGeneration;
    return { value: result, stale };
  }

  private async publishDiagnostics(model: Monaco.editor.ITextModel, service: LanguageService, environment: ShaderAuthoringEnvironment): Promise<void> {
    const language = shaderLanguage(model.getLanguageId());
    if (!language) return;
    const revision = revisionFor(model, language, environment);
    const diagnostics = await service.diagnostics({ document: revision });
    if (model.getVersionId() !== revision.version || this.environments.get(revision.uri)?.generation !== revision.environmentGeneration) return;
    this.monaco.editor.setModelMarkers(model, markerOwner(language), diagnostics.map((item) => ({
      ...toMonacoRange(this.monaco, item.range),
      message: typeof item.message === "string" ? item.message : item.message.value,
      severity: markerSeverity(item.severity),
      source: item.source,
      code: item.code === undefined ? undefined : String(item.code),
    })));
  }

  private modelsFor(language: ShaderLanguage): Monaco.editor.ITextModel[] {
    return this.monaco.editor.getModels().filter((model) => model.getLanguageId() === language);
  }

  private syncVirtualModels(environment: ShaderAuthoringEnvironment): void {
    const owner = environment.documentUri;
    const nextUris = new Set(environment.virtualFiles.map((file) => file.uri));
    for (const uri of this.virtualUrisByDocument.get(owner) ?? []) {
      if (nextUris.has(uri)) continue;
      const owners = this.virtualOwners.get(uri);
      owners?.delete(owner);
      if (owners?.size) continue;
      this.virtualOwners.delete(uri);
      this.managedVirtualModels.get(uri)?.dispose();
      this.managedVirtualModels.delete(uri);
    }
    for (const file of environment.virtualFiles) {
      const owners = this.virtualOwners.get(file.uri) ?? new Set<string>();
      owners.add(owner);
      this.virtualOwners.set(file.uri, owners);
      const uri = this.monaco.Uri.parse(file.uri);
      const existing = this.monaco.editor.getModel(uri);
      if (!existing) {
        this.managedVirtualModels.set(file.uri, this.monaco.editor.createModel(file.text, environment.languageId, uri));
      } else if (this.managedVirtualModels.get(file.uri) === existing && existing.getValue() !== file.text) {
        existing.setValue(file.text);
      }
    }
    this.virtualUrisByDocument.set(owner, nextUris);
  }
}

export function setupMonacoLanguageServices(monaco: typeof Monaco, factories: MonacoLanguageServiceFactories): MonacoLanguageServiceManager {
  return new MonacoLanguageServiceManager(monaco, factories);
}

function revisionFor(model: Monaco.editor.ITextModel, languageId: ShaderLanguage, environment: ShaderAuthoringEnvironment): DocumentRevision {
  return { uri: model.uri.toString(), languageId, version: model.getVersionId(), environmentGeneration: environment.generation };
}
function shaderLanguage(language: string): ShaderLanguage | undefined { return language === "glsl" || language === "slang" ? language : undefined; }
function markerOwner(language: ShaderLanguage): string { return `shader-studio-${language}-ls`; }
const RENAME_REJECTED = "This symbol cannot be renamed here.";
function toLspPosition(position: Monaco.Position) { return { line: position.lineNumber - 1, character: position.column - 1 }; }
function toLspRange(range: Monaco.IRange) { return { start: { line: range.startLineNumber - 1, character: range.startColumn - 1 }, end: { line: range.endLineNumber - 1, character: range.endColumn - 1 } }; }
function toMonacoRange(monaco: typeof Monaco, range: { start: { line: number; character: number }; end: { line: number; character: number } }) {
  return new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}
function markdownValue(value: unknown): string | Monaco.IMarkdownString | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) return { value: String((value as { value: unknown }).value) };
  return undefined;
}
function hoverValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(hoverValue).join("\n\n");
  if (value && typeof value === "object" && "value" in value) return String((value as { value: unknown }).value);
  if (value && typeof value === "object" && "language" in value && "value" in value) return `\`\`\`${String((value as { language: unknown }).language)}\n${String((value as { value: unknown }).value)}\n\`\`\``;
  return "";
}
/** LSP numbers highlight kinds from 1; Monaco numbers the same order from 0. */
function highlightKind(kind: number | undefined): Monaco.languages.DocumentHighlightKind {
  return (kind === undefined ? 0 : kind - 1) as Monaco.languages.DocumentHighlightKind;
}
function markerSeverity(severity: number | undefined): Monaco.MarkerSeverity {
  return severity === 2 ? 4 : severity === 3 ? 2 : severity === 4 ? 1 : 8;
}
