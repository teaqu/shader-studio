import * as vscode from "vscode";
import type {
  DocumentRevision,
  LanguageService,
  ShaderLanguage,
} from "@shader-studio/language-server-core";
import {
  ShaderAuthoringEnvironmentProvider,
  onDidChangeCustomUniformSnapshot,
} from "./ShaderAuthoringEnvironmentProvider";

export class VscodeLanguageServiceController implements vscode.Disposable {
  private readonly services: Partial<Record<ShaderLanguage, Promise<LanguageService>>> = {};
  private readonly opened: Record<ShaderLanguage, Set<string>> = { glsl: new Set(), slang: new Set() };
  private readonly diagnostics: Record<ShaderLanguage, vscode.DiagnosticCollection>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly factories: Record<ShaderLanguage, () => Promise<LanguageService>>,
    private readonly environments = new ShaderAuthoringEnvironmentProvider(),
  ) {
    this.diagnostics = {
      glsl: vscode.languages.createDiagnosticCollection("shader-studio-glsl-ls"),
      slang: vscode.languages.createDiagnosticCollection("shader-studio-slang-ls"),
    };
  }

  start(context: vscode.ExtensionContext): void {
    this.disposables.push(this.diagnostics.glsl, this.diagnostics.slang);
    for (const language of ["glsl", "slang"] as const) {
      this.registerProviders(language);
    }
    this.disposables.push(vscode.workspace.onDidOpenTextDocument((document) => {
      void this.open(document);
    }));
    this.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      void this.change(event.document);
    }));
    this.disposables.push(vscode.workspace.onDidCloseTextDocument((document) => {
      void this.close(document);
    }));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
      void this.configurationChanged(event);
    }));
    this.disposables.push(onDidChangeCustomUniformSnapshot(() => {
      for (const document of vscode.workspace.textDocuments) {
        if (shaderLanguage(document)) {
          void this.change(document);
        }
      }
    }));
    context.subscriptions.push(this);
    for (const document of vscode.workspace.textDocuments) {
      void this.open(document);
    }
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    for (const language of ["glsl", "slang"] as const) {
      void this.services[language]?.then((service) => service.dispose());
      delete this.services[language];
      this.opened[language].clear();
    }
  }

  private registerProviders(language: ShaderLanguage): void {
    const selector: vscode.DocumentSelector = [{ language, scheme: "file" }, { language, scheme: "untitled" }];
    this.disposables.push(vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems: async (document, position) => (
        (await this.request(document, (service, revision) => service.completion({ document: revision, position }), [])).map(toCompletionItem)
      ),
    }, "."));
    this.disposables.push(vscode.languages.registerHoverProvider(selector, {
      provideHover: async (document, position) => {
        const hover = await this.request(document, (service, revision) => service.hover({ document: revision, position }), null);
        return hover ? new vscode.Hover(toMarkdown(hover.contents) ?? new vscode.MarkdownString(), hover.range ? toVsRange(hover.range) : undefined) : null;
      },
    }));
    this.disposables.push(vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition: async (document, position) => (
        (await this.request(document, (service, revision) => service.definition({ document: revision, position }), []))
          .map((location) => new vscode.Location(vscode.Uri.parse(location.uri), toVsRange(location.range)))
      ),
    }));
    this.disposables.push(vscode.languages.registerSignatureHelpProvider(selector, {
      provideSignatureHelp: async (document, position) => {
        const result = await this.request(document, (service, revision) => service.signatureHelp({ document: revision, position }), null);
        if (!result) {
          return null;
        }
        const help = new vscode.SignatureHelp();
        help.activeSignature = result.activeSignature ?? 0;
        help.activeParameter = result.activeParameter ?? 0;
        help.signatures = result.signatures.map((signature) => {
          const item = new vscode.SignatureInformation(signature.label, toMarkdown(signature.documentation));
          item.parameters = signature.parameters?.map((parameter) => new vscode.ParameterInformation(parameter.label, toMarkdown(parameter.documentation))) ?? [];
          return item;
        });
        return help;
      },
    }, "(", ","));
    this.disposables.push(vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: async (document) => (
        (await this.request(document, (service, revision) => service.documentSymbols({ document: revision }), [])).map(toDocumentSymbol)
      ),
    }));
    this.disposables.push(vscode.languages.registerReferenceProvider(selector, {
      provideReferences: async (document, position, context) => (
        (await this.request(document, (service, revision) => service.references({
          document: revision,
          position,
          includeDeclaration: context.includeDeclaration,
        }), [])).map((location) => new vscode.Location(vscode.Uri.parse(location.uri), toVsRange(location.range)))
      ),
    }));
    this.disposables.push(vscode.languages.registerDocumentHighlightProvider(selector, {
      provideDocumentHighlights: async (document, position) => (
        (await this.request(document, (service, revision) => service.documentHighlights({ document: revision, position }), []))
          .map((highlight) => new vscode.DocumentHighlight(toVsRange(highlight.range), toHighlightKind(highlight.kind)))
      ),
    }));
    this.disposables.push(vscode.languages.registerRenameProvider(selector, {
      provideRenameEdits: async (document, position, newName) => {
        const result = await this.request(
          document,
          (service, revision) => service.rename({ document: revision, position, newName }),
          null,
        );
        const edits = result?.changes?.[document.uri.toString()] ?? [];
        if (edits.length === 0) {
          return null;
        }
        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const edit of edits) {
          workspaceEdit.replace(document.uri, toVsRange(edit.range), edit.newText);
        }
        return workspaceEdit;
      },
    }));
    this.disposables.push(vscode.languages.registerColorProvider(selector, {
      provideDocumentColors: async (document) => {
        if (!colorDecoratorsEnabled()) {
          return [];
        }
        return (await this.request(document, (service, revision) => service.documentColors({ document: revision }), []))
          .map((item) => new vscode.ColorInformation(toVsRange(item.range), new vscode.Color(item.color.red, item.color.green, item.color.blue, item.color.alpha)));
      },
      provideColorPresentations: async (color, context) => (
        (await this.request(context.document, (service, revision) => service.colorPresentations({
          document: revision,
          color: { red: color.red, green: color.green, blue: color.blue, alpha: color.alpha },
          range: toLspRange(context.range),
        }), [])).map((item) => {
          const presentation = new vscode.ColorPresentation(item.label);
          if (item.textEdit) {
            presentation.textEdit = vscode.TextEdit.replace(toVsRange(item.textEdit.range), item.textEdit.newText);
          }
          return presentation;
        })
      ),
    }));
  }

  private async open(document: vscode.TextDocument): Promise<void> {
    const language = shaderLanguage(document);
    if (!language || !enabled(language)) {
      return;
    }
    const environment = this.environments.environmentFor(document);
    if (!environment) {
      return;
    }
    const service = await this.service(language);
    await service.syncEnvironment(environment);
    if (!this.opened[language].has(document.uri.toString())) {
      await service.openDocument(snapshot(document, language));
      this.opened[language].add(document.uri.toString());
    }
    await this.publishDiagnostics(document, service, environment.generation);
  }

  private async change(document: vscode.TextDocument): Promise<void> {
    const language = shaderLanguage(document);
    if (!language || !enabled(language)) {
      return;
    }
    const environment = this.environments.environmentFor(document);
    if (!environment) {
      return;
    }
    const service = await this.service(language);
    await service.syncEnvironment(environment);
    if (this.opened[language].has(document.uri.toString())) {
      await service.changeDocument(snapshot(document, language));
    } else {
      await service.openDocument(snapshot(document, language));
      this.opened[language].add(document.uri.toString());
    }
    await this.publishDiagnostics(document, service, environment.generation);
    if (environment.passName.toLowerCase() === "common") {
      await this.refreshCommonDependents(document, language);
    }
  }

  private async refreshCommonDependents(
    commonDocument: vscode.TextDocument,
    language: ShaderLanguage,
  ): Promise<void> {
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.toString() === commonDocument.uri.toString() || shaderLanguage(document) !== language) {
        continue;
      }
      const environment = this.environments.environmentFor(document);
      if (environment?.commonFile?.uri !== commonDocument.uri.toString()) {
        continue;
      }
      const service = await this.service(language);
      await service.syncEnvironment(environment);
      await this.publishDiagnostics(document, service, environment.generation);
    }
  }

  private async close(document: vscode.TextDocument): Promise<void> {
    const language = shaderLanguage(document);
    if (!language || !this.opened[language].delete(document.uri.toString())) {
      return;
    }
    await (await this.services[language])?.closeDocument(document.uri.toString());
    this.diagnostics[language].delete(document.uri);
  }

  private async request<T>(document: vscode.TextDocument, run: (service: LanguageService, revision: DocumentRevision) => Promise<T>, fallback: T): Promise<T> {
    const language = shaderLanguage(document);
    if (!language || !enabled(language)) {
      return fallback;
    }
    await this.open(document);
    const environment = this.environments.environmentFor(document);
    if (!environment) {
      return fallback;
    }
    const revision = { uri: document.uri.toString(), languageId: language, version: document.version, environmentGeneration: environment.generation };
    const result = await run(await this.service(language), revision);
    const currentGeneration = this.environments.environmentFor(document)?.generation;
    return isCurrentRevision(document, currentGeneration, revision) ? result : fallback;
  }

  private async publishDiagnostics(document: vscode.TextDocument, service: LanguageService, generation: number): Promise<void> {
    const language = shaderLanguage(document);
    if (!language) {
      return;
    }
    const revision = { uri: document.uri.toString(), languageId: language, version: document.version, environmentGeneration: generation };
    const diagnostics = await service.diagnostics({ document: revision });
    const currentGeneration = this.environments.environmentFor(document)?.generation;
    if (!isCurrentRevision(document, currentGeneration, revision)) {
      return;
    }
    this.diagnostics[language].set(document.uri, diagnostics.map((item) => {
      const diagnostic = new vscode.Diagnostic(
        toVsRange(item.range),
        typeof item.message === "string" ? item.message : item.message.value,
        toSeverity(item.severity),
      );
      diagnostic.source = item.source;
      diagnostic.code = item.code;
      return diagnostic;
    }));
  }

  private async service(language: ShaderLanguage): Promise<LanguageService> {
    this.services[language] ??= this.factories[language]().then(async (service) => {
      await service.initialize(); return service;
    });
    return this.services[language]!;
  }

  private async configurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    for (const language of ["glsl", "slang"] as const) {
      if (!event.affectsConfiguration(`shader-studio.languageServers.${language}.enabled`)) {
        continue;
      }
      if (!enabled(language)) {
        this.diagnostics[language].clear();
      } else {
        for (const document of vscode.workspace.textDocuments) {
          if (shaderLanguage(document) === language) {
            await this.change(document);
          }
        }
      }
    }
  }
}

export function isCurrentRevision(
  document: Pick<vscode.TextDocument, "uri" | "version">,
  environmentGeneration: number | undefined,
  revision: DocumentRevision,
): boolean {
  return document.uri.toString() === revision.uri
    && document.version === revision.version
    && environmentGeneration === revision.environmentGeneration;
}

function enabled(language: ShaderLanguage): boolean {
  return vscode.workspace.getConfiguration("shader-studio").get(`languageServers.${language}.enabled`, true);
}
function colorDecoratorsEnabled(): boolean {
  return vscode.workspace.getConfiguration("shader-studio").get("editor.colorDecorators", true);
}
function shaderLanguage(document: vscode.TextDocument): ShaderLanguage | undefined {
  return document.languageId === "glsl" || document.languageId === "slang" ? document.languageId : undefined;
}
function snapshot(document: vscode.TextDocument, languageId: ShaderLanguage) {
  return { uri: document.uri.toString(), languageId, version: document.version, text: document.getText() };
}
function toVsPosition(position: { line: number; character: number }) {
  return new vscode.Position(position.line, position.character);
}
function toVsRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }) {
  return new vscode.Range(toVsPosition(range.start), toVsPosition(range.end));
}
function toLspRange(range: vscode.Range) {
  return { start: { line: range.start.line, character: range.start.character }, end: { line: range.end.line, character: range.end.character } };
}
function toCompletionItem(item: import("vscode-languageserver-protocol").CompletionItem): vscode.CompletionItem {
  const result = new vscode.CompletionItem(item.label, (item.kind ?? 6) as vscode.CompletionItemKind);
  result.detail = item.detail;
  result.documentation = toMarkdown(item.documentation);
  if (item.textEdit && "range" in item.textEdit) {
    result.range = toVsRange(item.textEdit.range);
  }
  result.insertText = item.textEdit?.newText ?? (typeof item.insertText === "string" ? item.insertText : item.label);
  return result;
}
function toDocumentSymbol(item: import("vscode-languageserver-protocol").DocumentSymbol): vscode.DocumentSymbol {
  const result = new vscode.DocumentSymbol(item.name, item.detail ?? "", item.kind as vscode.SymbolKind, toVsRange(item.range), toVsRange(item.selectionRange));
  result.children = item.children?.map(toDocumentSymbol) ?? [];
  return result;
}
function toMarkdown(value: unknown): vscode.MarkdownString | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return new vscode.MarkdownString(value);
  }
  if (Array.isArray(value)) {
    return new vscode.MarkdownString(value.map((item) => String(item)).join("\n\n"));
  }
  if (value && typeof value === "object" && "value" in value) {
    return new vscode.MarkdownString(String((value as { value: unknown }).value));
  }
  return new vscode.MarkdownString(String(value));
}
/** LSP highlight kinds are Text=1, Read=2, Write=3. */
function toHighlightKind(kind: number | undefined): vscode.DocumentHighlightKind {
  return kind === 3 ? vscode.DocumentHighlightKind.Write
    : kind === 2 ? vscode.DocumentHighlightKind.Read
      : vscode.DocumentHighlightKind.Text;
}

function toSeverity(value: number | undefined): vscode.DiagnosticSeverity {
  return value === 2 ? vscode.DiagnosticSeverity.Warning : value === 3 ? vscode.DiagnosticSeverity.Information : value === 4 ? vscode.DiagnosticSeverity.Hint : vscode.DiagnosticSeverity.Error;
}
