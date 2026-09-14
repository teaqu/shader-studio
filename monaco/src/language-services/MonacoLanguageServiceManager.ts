import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type {
  DocumentRevision,
  LanguageService,
  ShaderLanguage,
} from "@shader-studio/language-server-core";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { applyTextEdits, type WorkspaceTextChange } from "./workspaceEdits";
import { setLanguageServiceMarkers } from "./markerArbitration";

export type LanguageServiceFactory = () => Promise<LanguageService>;
export type MonacoLanguageServiceFactories = Record<ShaderLanguage, LanguageServiceFactory>;
export interface MonacoLanguageServiceManagerOptions {
  onRenameFeedback?: (uri: string, message: string | undefined) => void;
  getWorkspaceDocuments?: (language: ShaderLanguage) => Promise<NonNullable<ShaderAuthoringEnvironment['workspaceDocuments']>>;
  applyWorkspaceEdit?: (
    changes: readonly WorkspaceTextChange[],
    isCurrent: () => boolean,
    commit: () => void,
    /** Live open-buffer texts by document URI at apply time. Hosts compare
     * staleness against these before falling back to stored copies. */
    openTexts?: ReadonlyMap<string, string>,
  ) => Promise<void>;
}

interface ServiceState {
  service?: Promise<LanguageService>;
  readonly opened: Set<string>;
}

export class MonacoLanguageServiceManager {
  private disposed = false;
  private readonly environmentWaiters = new Map<string, Set<() => void>>();
  private readonly environments = new Map<string, ShaderAuthoringEnvironment>();
  private readonly enabled: Record<ShaderLanguage, boolean> = { glsl: true, slang: true, wgsl: true };
  private colorDecoratorsEnabled = true;
  private readonly states: Record<ShaderLanguage, ServiceState> = {
    glsl: { opened: new Set() },
    slang: { opened: new Set() },
    wgsl: { opened: new Set() },
  };
  private readonly disposables: Monaco.IDisposable[] = [];
  private readonly colorProviderRegistrations = new Map<ShaderLanguage, Monaco.IDisposable>();
  private readonly modelDisposables = new Map<string, Monaco.IDisposable>();
  private readonly virtualUrisByDocument = new Map<string, Set<string>>();
  private readonly virtualOwners = new Map<string, Set<string>>();
  private readonly managedVirtualModels = new Map<string, Monaco.editor.ITextModel>();

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly factories: MonacoLanguageServiceFactories,
    private readonly options: MonacoLanguageServiceManagerOptions = {},
  ) {
    for (const language of ["glsl", "slang", "wgsl"] as const) {
      this.registerProviders(language);
    }
    for (const model of monaco.editor.getModels()) {
      this.attachModel(model);
    }
    this.disposables.push(monaco.editor.onDidCreateModel((model) => this.attachModel(model)));
    this.disposables.push(monaco.editor.onWillDisposeModel((model) => {
      void this.closeModel(model);
    }));
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    if (this.disposed) {
      return;
    }
    const previous = this.environments.get(environment.documentUri);
    if (previous) {
      // Workspace inventory is owned by the provider, not individual editor
      // environment messages. Do not remove and re-add it on every save.
      if (this.options.getWorkspaceDocuments) {
        environment = withWorkspaceContext(environment, previous.workspaceDocuments);
      }
      // Several editors can share one file. Their local counters cannot replace
      // the service's monotonically increasing revision for that file.
      const changed = JSON.stringify({ ...environment, generation: 0 }) !== JSON.stringify({ ...previous, generation: 0 });
      environment = { ...environment, generation: !this.options.getWorkspaceDocuments || changed
        ? Math.max(environment.generation, previous.generation + Number(changed)) : previous.generation };
    }
    const colorsChanged = previous?.generation !== environment.generation;
    this.syncVirtualModels(environment);
    this.environments.set(environment.documentUri, environment);
    this.finishEnvironmentWaiters(environment.documentUri);
    if (!this.enabled[environment.languageId]) {
      return;
    }
    const model = this.monaco.editor.getModels().find((candidate) => candidate.uri.toString() === environment.documentUri);
    if (model) {
      await this.ensureModel(model);
      if (colorsChanged && !this.disposed) {
        this.registerColorProvider(environment.languageId);
      }
    }
  }

  async setEnabled(language: ShaderLanguage, enabled: boolean): Promise<void> {
    if (this.enabled[language] === enabled) {
      return;
    }
    this.enabled[language] = enabled;
    if (!enabled) {
      for (const model of this.modelsFor(language)) {
        this.finishEnvironmentWaiters(model.uri.toString());
      }
      const state = this.states[language];
      const service = await state.service;
      await service?.dispose();
      state.service = undefined;
      state.opened.clear();
      for (const model of this.modelsFor(language)) {
        setLanguageServiceMarkers(this.monaco, model, []);
      }
      return;
    }
    for (const model of this.modelsFor(language)) {
      await this.ensureModel(model);
    }
  }

  setColorDecoratorsEnabled(enabled: boolean): void {
    this.colorDecoratorsEnabled = enabled;
  }

  dispose(): void {
    this.disposed = true;
    for (const uri of [...this.environmentWaiters.keys()]) {
      this.finishEnvironmentWaiters(uri);
    }
    for (const uri of this.environments.keys()) {
      this.options.onRenameFeedback?.(uri, undefined);
    }
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    for (const disposable of this.colorProviderRegistrations.values()) {
      disposable.dispose();
    }
    this.colorProviderRegistrations.clear();
    for (const disposable of this.modelDisposables.values()) {
      disposable.dispose();
    }
    this.modelDisposables.clear();
    for (const model of this.managedVirtualModels.values()) {
      model.dispose();
    }
    this.managedVirtualModels.clear();
    this.virtualOwners.clear();
    this.virtualUrisByDocument.clear();
    for (const language of ["glsl", "slang", "wgsl"] as const) {
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
        const result = await this.request(model, (service, revision) => service.signatureHelp({ document: revision, position: toLspPosition(position) }), null, { waitForEnvironment: true });
        if (!result) {
          return null;
        }
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
      ), [], { waitForEnvironment: true }),
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
      provideRenameEdits: async (model, position, newName, token) => {
        const uri = model.uri.toString();
        const reject = (rejectReason: string) => {
          this.options.onRenameFeedback?.(uri, rejectReason);
          return { edits: [], rejectReason };
        };
        this.options.onRenameFeedback?.(uri, undefined);
        if (!this.options.applyWorkspaceEdit && this.environments.get(uri)?.passName.toLowerCase() === "common") {
          return reject("Renaming across files is supported in VS Code. No files were changed.");
        }
        if (this.options.applyWorkspaceEdit) {
          let snapshots = new Map<string, { model: Monaco.editor.ITextModel; version: number; text: string }>();
          let generation: number | undefined;
          const current = () => !token?.isCancellationRequested
            && this.enabled[language] && this.environments.get(uri)?.generation === generation
            && [...snapshots.values()].every(snapshot => !snapshot.model.isDisposed?.()
              && snapshot.model.getVersionId() === snapshot.version);
          try {
            const result = await this.request(model, (service, revision) => {
              snapshots = new Map(this.monaco.editor.getModels().map(target => [target.uri.toString(), {
                model: target, version: target.getVersionId(), text: target.getValue(),
              }]));
              generation = revision.environmentGeneration;
              return service.rename({ document: revision, position: toLspPosition(position), newName });
            }, null, { waitForEnvironment: true });
            if (!result || !current()) {
              return reject(RENAME_REJECTED);
            }
            if (result.documentChanges?.length) {
              return reject("Unsupported rename edit format. No files were changed.");
            }
            const changes: WorkspaceTextChange[] = [];
            for (const [targetUri, edits] of Object.entries(result.changes ?? {})) {
              if (!edits.length) {
                continue;
              }
              const snapshot = snapshots.get(targetUri);
              if (!snapshot) {
                return reject("A rename target is unavailable. No files were changed.");
              }
              changes.push({ uri: targetUri, before: snapshot.text, after: applyTextEdits(snapshot.text, edits) });
            }
            if (!changes.length) {
              return reject(RENAME_REJECTED);
            }
            // Live buffer texts at apply time, so the host compares staleness
            // against open editors rather than lagging stored copies.
            const openTexts = new Map(this.monaco.editor.getModels()
              .filter((target) => !target.isDisposed?.())
              .map((target) => [target.uri.toString(), target.getValue()]));
            await this.options.applyWorkspaceEdit(changes, current, () => {
              for (const change of changes) {
snapshots.get(change.uri)!.model.setValue(change.after);
              }
            }, openTexts);
            this.options.onRenameFeedback?.(uri, undefined);
            // The host committed both persisted files and models atomically; Monaco
            // must not replay the edits through its single-file bulk edit service.
            return { edits: [] };
          } catch (error) {
            return reject(error instanceof Error ? error.message : "Rename failed. No files were changed.");
          }
        }
        const response = await this.request(model, async (service, revision) => {
          const result = await service.rename({ document: revision, position: toLspPosition(position), newName });
          if (Object.entries(result?.changes ?? {}).some(([uri, edits]) => uri !== model.uri.toString() && edits.length > 0)) {
            return { edits: [], rejectReason: "Renaming across files is supported in VS Code. No files were changed." };
          }
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
        }, { edits: [], rejectReason: RENAME_REJECTED }, { waitForEnvironment: true });
        this.options.onRenameFeedback?.(uri, response.rejectReason);
        return response;
      },
    }));
    this.registerColorProvider(language);
  }

  private registerColorProvider(language: ShaderLanguage): void {
    // Monaco has no document-colour invalidation event. Refresh the registry
    // when host context changes so a stale initial query is recomputed without
    // requiring a text edit or accepting results from an obsolete environment.
    this.colorProviderRegistrations.get(language)?.dispose();
    this.colorProviderRegistrations.set(language, this.monaco.languages.registerColorProvider(language, {
      provideDocumentColors: async (model) => {
        if (!this.colorDecoratorsEnabled) {
          return [];
        }
        // Monaco asks for colours when a model opens and again only after an
        // edit, so answering before the first environment would hide swatches.
        return this.request(model, async (service, revision) => (
          (await service.documentColors({ document: revision })).map((color) => ({ color: color.color, range: toMonacoRange(this.monaco, color.range) }))
        ), [], { waitForEnvironment: true });
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
    if (!language) {
      return;
    }
    const uri = model.uri.toString();
    this.modelDisposables.get(uri)?.dispose();
    this.modelDisposables.set(uri, model.onDidChangeContent(() => {
      this.options.onRenameFeedback?.(uri, undefined);
      void this.ensureModel(model);
    }));
    if (this.environments.has(uri) && this.enabled[language]) {
      this.options.onRenameFeedback?.(uri, undefined);
      void this.ensureModel(model);
    }
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
  private async ensureModel(model: Monaco.editor.ITextModel): Promise<{ service: LanguageService; version: number; environmentGeneration: number } | undefined> {
    if (model.isDisposed()) {
      return undefined;
    }
    const language = shaderLanguage(model.getLanguageId());
    const environment = this.environments.get(model.uri.toString());
    if (!language || !environment || !this.enabled[language]) {
      return undefined;
    }
    const service = await this.service(language);
    if (this.disposed || model.isDisposed()) {
      return undefined;
    }
    if (this.options.getWorkspaceDocuments) {
      const workspaceDocuments = await this.options.getWorkspaceDocuments(language);
      if (this.disposed || model.isDisposed()) {
        return undefined;
      }
      const latest = this.environments.get(model.uri.toString());
      const refreshedContext = latest && withWorkspaceContext(latest, workspaceDocuments);
      if (latest && refreshedContext && JSON.stringify(latest) !== JSON.stringify(refreshedContext)) {
        // The owner's source has its own document revision. Persisting that
        // buffer changes its stored timestamp, not its analysis environment.
        const dependencies = (files: ShaderAuthoringEnvironment['workspaceDocuments']) => files?.map(file =>
          file.uri === latest.documentUri ? { ...file, text: '', version: 0 } : file);
        const changed = JSON.stringify({ ...latest, workspaceDocuments: dependencies(latest.workspaceDocuments) })
          !== JSON.stringify({ ...refreshedContext, workspaceDocuments: dependencies(workspaceDocuments) });
        const refreshed = { ...refreshedContext, generation: latest.generation + Number(changed) };
        this.environments.set(model.uri.toString(), refreshed);
        this.syncVirtualModels(refreshed);
      }
    }
    // Worker startup can overlap host environment updates. Use the current
    // environment after startup and keep its generation with the synced version.
    const syncedEnvironment = this.environments.get(model.uri.toString());
    if (model.isDisposed() || !syncedEnvironment || syncedEnvironment.languageId !== language || model.getLanguageId() !== language || !this.enabled[language]) {
      return undefined;
    }
    // The host snapshot carries stored text, but an open editor may hold newer
    // unsaved text for the same file. Send the live buffers so analysis never
    // resolves against stale copies. The merged copy is send-only: storing it
    // back would churn environment generations on every keystroke.
    await service.syncEnvironment(this.withLiveBuffers(syncedEnvironment));
    if (this.disposed || model.isDisposed()) {
      return undefined;
    }
    const uri = model.uri.toString();
    const version = model.getVersionId();
    const document = { uri, languageId: language, version, text: model.getValue() };
    if (!this.states[language].opened.has(uri)) {
      await service.openDocument(document);
      this.states[language].opened.add(uri);
    } else {
      await service.changeDocument(document);
    }
    if (this.disposed || model.isDisposed()) {
      return undefined;
    }
    await this.publishDiagnostics(model, service, syncedEnvironment);
    return { service, version, environmentGeneration: syncedEnvironment.generation };
  }

  private async closeModel(model: Monaco.editor.ITextModel): Promise<void> {
    const uri = model.uri.toString();
    this.finishEnvironmentWaiters(uri);
    this.options.onRenameFeedback?.(uri, undefined);
    this.modelDisposables.get(uri)?.dispose();
    this.modelDisposables.delete(uri);
    const language = shaderLanguage(model.getLanguageId());
    if (!language || !this.states[language].opened.delete(uri)) {
      return;
    }
    await (await this.states[language].service)?.closeDocument(uri);
  }

  private async service(language: ShaderLanguage): Promise<LanguageService> {
    const state = this.states[language];
    state.service ??= this.factories[language]().then(async (service) => {
      await service.initialize(); return service;
    });
    return state.service;
  }

  private async request<T>(model: Monaco.editor.ITextModel, run: (service: LanguageService, revision: DocumentRevision) => Promise<T>, fallback: T, options?: { waitForEnvironment?: boolean }): Promise<T> {
    const { value, stale } = await this.requestAllowingStale(model, run, fallback, options);
    return stale ? fallback : value;
  }

  /** Runs a request and reports whether the document moved on while it ran. */
  private async requestAllowingStale<T>(model: Monaco.editor.ITextModel, run: (service: LanguageService, revision: DocumentRevision) => Promise<T>, fallback: T, options?: { waitForEnvironment?: boolean }): Promise<{ value: T; stale: boolean }> {
    const language = shaderLanguage(model.getLanguageId());
    let environment = this.environments.get(model.uri.toString());
    if (language && this.enabled[language] && !this.disposed && !environment && options?.waitForEnvironment) {
      // Explicit commands may arrive before the host's first environment.
      // Resume on delivery; never turn that startup race into "no references".
      const version = model.getVersionId();
      await this.waitForEnvironment(model.uri.toString());
      if (model.getVersionId() !== version) {
        return { value: fallback, stale: true };
      }
      environment = this.environments.get(model.uri.toString());
    }
    if (!language || !environment || !this.enabled[language] || this.disposed) {
      return { value: fallback, stale: false };
    }
    const ensured = await this.ensureModel(model);
    if (!ensured || this.disposed || !this.enabled[language]) {
      return { value: fallback, stale: false };
    }
    const revision: DocumentRevision = { uri: model.uri.toString(), languageId: language, version: ensured.version, environmentGeneration: ensured.environmentGeneration };
    const result = await run(ensured.service, revision);
    const current = this.environments.get(model.uri.toString());
    const stale = model.getVersionId() !== revision.version || current?.generation !== revision.environmentGeneration;
    return { value: result, stale };
  }

  private waitForEnvironment(uri: string): Promise<void> {
    return new Promise(resolve => {
      const waiters = this.environmentWaiters.get(uri) ?? new Set<() => void>();
      const finish = () => {
        clearTimeout(deadline);
        waiters.delete(finish);
        if (waiters.size === 0) {
          this.environmentWaiters.delete(uri);
        }
        resolve();
      };
      // Preserve the existing explicit-command deadline for a host that never
      // supplies an environment. Normal completion is driven by syncEnvironment.
      const deadline = setTimeout(finish, 5000);
      waiters.add(finish);
      this.environmentWaiters.set(uri, waiters);
    });
  }

  private finishEnvironmentWaiters(uri: string): void {
    for (const finish of [...(this.environmentWaiters.get(uri) ?? [])]) {
      finish();
    }
  }

  private async publishDiagnostics(model: Monaco.editor.ITextModel, service: LanguageService, environment: ShaderAuthoringEnvironment): Promise<void> {
    const language = shaderLanguage(model.getLanguageId());
    if (!language) {
      return;
    }
    const revision = revisionFor(model, language, environment);
    const diagnostics = await service.diagnostics({ document: revision });
    if (model.getVersionId() !== revision.version || this.environments.get(revision.uri)?.generation !== revision.environmentGeneration) {
      return;
    }
    setLanguageServiceMarkers(this.monaco, model, diagnostics.map((item) => ({
      ...toMonacoRange(this.monaco, item.range),
      message: typeof item.message === "string" ? item.message : item.message.value,
      severity: markerSeverity(item.severity),
      source: item.source,
      code: item.code === undefined ? undefined : String(item.code),
      tags: item.tags?.map((tag) => tag as unknown as Monaco.MarkerTag),
    })));

  }

  private modelsFor(language: ShaderLanguage): Monaco.editor.ITextModel[] {
    return this.monaco.editor.getModels().filter((model) => model.getLanguageId() === language);
  }

  /** Prefer open editor buffers over stored snapshot text, per file. An open
   * model always carries that file's current text under its URI, so a lookup
   * by URI is exact; files with no open model keep the host entry untouched.
   * The model's version becomes the entry version: one version source per
   * file, never a mix of editor versions and stored timestamps. */
  private withLiveBuffers(environment: ShaderAuthoringEnvironment): ShaderAuthoringEnvironment {
    const live = new Map(this.monaco.editor.getModels().map((model) => [model.uri.toString(), model]));
    if (![...live.keys()].some((uri) =>
      environment.workspaceDocuments?.some((file) => file.uri === uri)
      || environment.commonFile?.uri === uri
      || environment.virtualFiles.some((file) => file.uri === uri))) {
      return environment;
    }
    const overlay = <T extends { uri: string; text: string; version: number }>(file: T): T => {
      const model = live.get(file.uri);
      return model ? { ...file, text: model.getValue(), version: model.getVersionId() } : file;
    };
    return {
      ...environment,
      commonFile: environment.commonFile ? overlay(environment.commonFile) : undefined,
      virtualFiles: environment.virtualFiles.map(overlay),
      workspaceDocuments: environment.workspaceDocuments?.map(overlay),
    };
  }

  private syncVirtualModels(environment: ShaderAuthoringEnvironment): void {
    const owner = environment.documentUri;
    const files = [...environment.virtualFiles, ...(environment.commonFile ? [environment.commonFile] : []),
      ...(environment.workspaceDocuments ?? [])].filter(file => file.uri !== owner);
    const nextUris = new Set(files.map((file) => file.uri));
    for (const uri of this.virtualUrisByDocument.get(owner) ?? []) {
      if (nextUris.has(uri)) {
        continue;
      }
      const owners = this.virtualOwners.get(uri);
      owners?.delete(owner);
      if (owners?.size) {
        continue;
      }
      if (this.managedVirtualModels.get(uri)?.isAttachedToEditor()) {
        nextUris.add(uri);
        continue;
      }
      this.virtualOwners.delete(uri);
      this.managedVirtualModels.get(uri)?.dispose();
      this.managedVirtualModels.delete(uri);
    }
    for (const file of files) {
      const owners = this.virtualOwners.get(file.uri) ?? new Set<string>();
      owners.add(owner);
      this.virtualOwners.set(file.uri, owners);
      const uri = this.monaco.Uri.parse(file.uri);
      const existing = this.monaco.editor.getModel(uri);
      if (!existing) {
        this.managedVirtualModels.set(file.uri, this.monaco.editor.createModel(file.text, environment.languageId, uri));
      } else if (this.managedVirtualModels.get(file.uri) === existing
        && !existing.isAttachedToEditor() && existing.getValue() !== file.text) {
        // Once opened in an editor, the live buffer owns its contents. Host
        // environment snapshots may predate unsaved typing in that buffer.
        existing.setValue(file.text);
      }
    }
    this.virtualUrisByDocument.set(owner, nextUris);
  }
}

export function setupMonacoLanguageServices(monaco: typeof Monaco, factories: MonacoLanguageServiceFactories, options?: MonacoLanguageServiceManagerOptions): MonacoLanguageServiceManager {
  return new MonacoLanguageServiceManager(monaco, factories, options);
}

function revisionFor(model: Monaco.editor.ITextModel, languageId: ShaderLanguage, environment: ShaderAuthoringEnvironment): DocumentRevision {
  return { uri: model.uri.toString(), languageId, version: model.getVersionId(), environmentGeneration: environment.generation };
}
function shaderLanguage(language: string): ShaderLanguage | undefined {
  return language === "glsl" || language === "slang" || language === "wgsl" ? language : undefined;
}
const RENAME_REJECTED = "This symbol cannot be renamed here.";
function toLspPosition(position: Monaco.Position) {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}
function toLspRange(range: Monaco.IRange) {
  return { start: { line: range.startLineNumber - 1, character: range.startColumn - 1 }, end: { line: range.endLineNumber - 1, character: range.endColumn - 1 } };
}
function toMonacoRange(monaco: typeof Monaco, range: { start: { line: number; character: number }; end: { line: number; character: number } }) {
  return new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}
function markdownValue(value: unknown): string | Monaco.IMarkdownString | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "value" in value) {
    return { value: String((value as { value: unknown }).value) };
  }
  return undefined;
}
function hoverValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(hoverValue).join("\n\n");
  }
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value);
  }
  if (value && typeof value === "object" && "language" in value && "value" in value) {
    return `\`\`\`${String((value as { language: unknown }).language)}\n${String((value as { value: unknown }).value)}\n\`\`\``;
  }
  return "";
}
/** LSP numbers highlight kinds from 1; Monaco numbers the same order from 0. */
function highlightKind(kind: number | undefined): Monaco.languages.DocumentHighlightKind {
  return (kind === undefined ? 0 : kind - 1) as Monaco.languages.DocumentHighlightKind;
}
function markerSeverity(severity: number | undefined): Monaco.MarkerSeverity {
  return severity === 2 ? 4 : severity === 3 ? 2 : severity === 4 ? 1 : 8;
}

/** A detached editor's Common belongs to its configured owner, not the preview. */
function withWorkspaceContext(
  environment: ShaderAuthoringEnvironment,
  workspaceDocuments: ShaderAuthoringEnvironment['workspaceDocuments'],
): ShaderAuthoringEnvironment {
  const owner = workspaceDocuments?.find(file => file.uri === environment.documentUri);
  const common = owner?.commonUri ? workspaceDocuments?.find(file => file.uri === owner.commonUri) : undefined;
  return {
    ...environment,
    workspaceDocuments,
    ...(owner && environment.languageId !== 'slang' ? {
      commonFile: common ? { uri: common.uri, text: common.text, version: common.version } : undefined,
    } : {}),
  };
}
