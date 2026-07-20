import * as path from "node:path";
import * as vscode from "vscode";
import {
  StaleSlangResultError,
  SupersededSlangMutationError,
  type CompletionItemDto,
  type DiagnosticDto,
  type DocumentSymbolDto,
  type HoverDto,
  type LocationDto,
  type SignatureHelpDto,
  type SlangDocumentSnapshot,
  type SlangMarkupContent,
  type SlangRange,
  type SlangWorkspaceSnapshot,
} from "@shader-studio/slang-language-service";

import { SlangWorkspaceSnapshotBuilder } from "../app/SlangWorkspaceSnapshotBuilder";
import { SlangLanguageClient } from "./SlangLanguageClient";

export const SLANG_DOCUMENT_SELECTOR: vscode.DocumentSelector = [{ language: "slang", scheme: "file" }];
const activeRegistrations = new WeakMap<vscode.ExtensionContext, vscode.Disposable>();

export type SlangLanguageClientContract = Pick<SlangLanguageClient,
  "init" | "replaceFiles" | "openDocument" | "changeDocument" | "closeDocument" |
  "hover" | "definition" | "completion" | "completionResolve" | "signatureHelp" |
  "documentSymbols" | "diagnostics" | "ready" | "dispose">;

export interface RegisterSlangLanguageFeatureOptions {
  createClient(workerScriptPath: string): SlangLanguageClientContract;
}

function toRange(range: SlangRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

function toMarkdown(content: SlangMarkupContent): vscode.MarkdownString {
  const value = new vscode.MarkdownString();
  if (content.kind === "markdown") {
    value.appendMarkdown(content.value);
  } else {
    value.appendText(content.value);
  }
  value.isTrusted = false;
  return value;
}

export function toHover(value: HoverDto | undefined): vscode.Hover | undefined {
  return value ? new vscode.Hover(toMarkdown(value.contents), toRange(value.range)) : undefined;
}

export function toLocation(value: LocationDto): vscode.Location {
  return new vscode.Location(vscode.Uri.parse(value.uri), toRange(value.range));
}

function completionKind(kind: number): vscode.CompletionItemKind {
  return Math.max(0, kind - 1) as vscode.CompletionItemKind;
}

export function toCompletionItem(value: CompletionItemDto): vscode.CompletionItem {
  const item = new vscode.CompletionItem(value.label, completionKind(value.kind));
  item.detail = value.detail;
  item.documentation = value.documentation ? toMarkdown(value.documentation) : undefined;
  item.commitCharacters = value.commitCharacters;
  if (value.textEdit) {
    item.range = toRange(value.textEdit.range);
    item.insertText = value.textEdit.text;
  }
  return item;
}

export function toSignatureHelp(value: SignatureHelpDto): vscode.SignatureHelp {
  const result = new vscode.SignatureHelp();
  result.activeSignature = value.activeSignature;
  result.activeParameter = value.activeParameter;
  result.signatures = value.signatures.map((signature) => {
    const converted = new vscode.SignatureInformation(signature.label, toMarkdown(signature.documentation));
    converted.parameters = signature.parameters.map((parameter) => new vscode.ParameterInformation(
      signature.label.slice(parameter.label[0], parameter.label[1]),
      toMarkdown(parameter.documentation),
    ));
    return converted;
  });
  return result;
}

export function toDocumentSymbol(value: DocumentSymbolDto): vscode.DocumentSymbol {
  const symbol = new vscode.DocumentSymbol(
    value.name,
    value.detail,
    Math.max(0, value.kind - 1) as vscode.SymbolKind,
    toRange(value.range),
    toRange(value.selectionRange),
  );
  symbol.children = value.children.map(toDocumentSymbol);
  return symbol;
}

export function toDiagnostic(value: DiagnosticDto): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    toRange(value.range),
    value.message,
    Math.max(0, value.severity - 1) as vscode.DiagnosticSeverity,
  );
  diagnostic.code = value.code;
  diagnostic.source = "Slang";
  return diagnostic;
}

function documentSnapshot(document: vscode.TextDocument): SlangDocumentSnapshot {
  return {
    uri: document.uri.toString(),
    path: path.basename(document.uri.fsPath),
    source: document.getText(),
    version: document.version,
  };
}

function languageServiceSnapshot(snapshot: SlangWorkspaceSnapshot): SlangWorkspaceSnapshot {
  return {
    ...snapshot,
    files: snapshot.files.map((file) => ({
      ...file,
      path: file.path.replace(/^\/workspace\/?/, ""),
    })),
  };
}

function ignoredStale(error: unknown): void {
  if (!(error instanceof StaleSlangResultError) && !(error instanceof SupersededSlangMutationError)) {
    console.error(`Slang language feature error: ${error}`);
  }
}

class SlangFeatureSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("shader-studio-slang");
  private readonly completionDtos = new WeakMap<vscode.CompletionItem, {
    dto: CompletionItemDto;
    uri: string;
    version: number;
  }>();
  private readonly openedVersions = new Map<string, number>();
  private snapshot: SlangWorkspaceSnapshot | undefined;
  private readonly initialized: Promise<void>;
  private disposed = false;
  private initializationError: Error | undefined;
  private snapshotRevision = 0;
  private rebuildPending = false;
  private rebuildRunning = false;
  private readonly transientRegistrations = new Set<string>();

  constructor(
    private readonly client: SlangLanguageClientContract,
    context: vscode.ExtensionContext,
    private readonly workspaceFolder: vscode.WorkspaceFolder,
  ) {
    this.disposables.push(this.diagnostics);
    const registrations = this.registerProviders();
    this.disposables.push(...registrations);
    context.subscriptions.push(...registrations, this.diagnostics);
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => void this.open(document)),
      vscode.workspace.onDidChangeTextDocument((event) => void this.change(event.document)),
      vscode.workspace.onDidCloseTextDocument((document) => void this.close(document)),
    );
    context.subscriptions.push(...this.disposables.slice(-3));
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, "**/*.slang"),
    );
    const watcherRegistrations = [
      watcher.onDidCreate((uri) => this.scheduleSnapshotRebuild(uri)),
      watcher.onDidChange((uri) => this.scheduleSnapshotRebuild(uri)),
      watcher.onDidDelete((uri) => this.scheduleSnapshotRebuild(uri)),
      watcher,
    ];
    this.disposables.push(...watcherRegistrations);
    context.subscriptions.push(...watcherRegistrations);
    this.initialized = this.initializeSafely();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.snapshotRevision += 1;
    this.rebuildPending = false;
    this.diagnostics.clear();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.client.dispose();
  }

  private async initializeSafely(): Promise<void> {
    try {
      this.snapshot = await this.buildSnapshot();
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.initializationError = error instanceof Error ? error : new Error(String(error));
      return;
    }
    if (this.disposed) {
      return;
    }
    try {
      await this.client.init(languageServiceSnapshot(this.snapshot));
    } catch (_initializationError) {
      try {
        await this.client.ready();
        if (this.disposed) {
          return;
        }
        await this.client.init(languageServiceSnapshot(this.snapshot));
        if (this.disposed) {
          return;
        }
        await this.openInitialDocuments();
      } catch (recoveryError) {
        if (!this.disposed) {
          this.initializationError = recoveryError instanceof Error
            ? recoveryError
            : new Error(String(recoveryError));
        }
        return;
      }
    }
    if (!this.disposed) {
      await this.openInitialDocuments();
    }
  }

  private async buildSnapshot(): Promise<SlangWorkspaceSnapshot> {
    const rootUri = this.workspaceFolder.uri.toString();
    const builder = new SlangWorkspaceSnapshotBuilder({
      findSlangFiles: async () => (await vscode.workspace.findFiles(
        new vscode.RelativePattern(this.workspaceFolder, "**/*.slang"),
      )).map((uri) => uri.toString()),
      readFile: async (uri) => {
        try {
          return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(uri)));
        } catch {
          return undefined;
        }
      },
      // The workspace snapshot is the saved disk baseline. Unsaved editor
      // contents live only in WorkerClient's open/change document overlay.
      openDocuments: [],
    });
    return builder.build({ rootUri });
  }

  private async openInitialDocuments(): Promise<void> {
    if (!this.snapshot) {
      return;
    }
    for (const document of vscode.workspace.textDocuments) {
      if (
        document.languageId === "slang" &&
        this.isDocumentManaged(document) &&
        this.snapshot.files.some((file) => file.uri === document.uri.toString())
      ) {
        if (this.openedVersions.get(document.uri.toString()) !== document.version) {
          try {
            await this.client.openDocument(this.snapshotDocument(document));
            if (this.disposed) {
              return;
            }
            this.openedVersions.set(document.uri.toString(), document.version);
          } catch (error) {
            ignoredStale(error);
            continue;
          }
        }
        try {
          await this.publishDiagnostics(document);
        } catch (error) {
          ignoredStale(error);
        }
      }
    }
  }

  private relativeDocumentPath(document: vscode.TextDocument): string | undefined {
    if (document.uri.scheme !== "file") {
      return undefined;
    }
    const relativePath = path.relative(this.workspaceFolder.uri.fsPath, document.uri.fsPath).replaceAll(path.sep, "/");
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
      return undefined;
    }
    return relativePath;
  }

  private isDocumentManaged(document: vscode.TextDocument): boolean {
    return this.relativeDocumentPath(document) !== undefined;
  }

  private isUriManaged(uri: vscode.Uri): boolean {
    if (uri.scheme !== "file") {
      return false;
    }
    const relativePath = path.relative(this.workspaceFolder.uri.fsPath, uri.fsPath);
    return relativePath !== "" && relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
  }

  private scheduleSnapshotRebuild(uri: vscode.Uri): void {
    if (this.disposed || !this.isUriManaged(uri)) {
      return;
    }
    this.snapshotRevision += 1;
    this.rebuildPending = true;
    if (this.rebuildRunning) {
      return;
    }
    this.rebuildRunning = true;
    void this.drainSnapshotRebuilds().catch(ignoredStale).finally(() => {
      this.rebuildRunning = false;
      if (this.rebuildPending && !this.disposed) {
        this.scheduleSnapshotRebuild(uri);
      }
    });
  }

  private async drainSnapshotRebuilds(): Promise<void> {
    await this.initialized;
    while (this.rebuildPending && !this.disposed && !this.initializationError) {
      this.rebuildPending = false;
      const revision = this.snapshotRevision;
      const snapshot = await this.buildSnapshot();
      if (this.disposed) {
        return;
      }
      if (revision !== this.snapshotRevision) {
        continue;
      }
      await this.client.replaceFiles(languageServiceSnapshot(snapshot));
      if (this.disposed || revision !== this.snapshotRevision) {
        continue;
      }
      this.snapshot = snapshot;
      await this.refreshOpenDocumentDiagnostics();
    }
  }

  private async refreshOpenDocumentDiagnostics(): Promise<void> {
    for (const document of vscode.workspace.textDocuments) {
      if (this.disposed) {
        return;
      }
      if (document.languageId === "slang" && this.isDocumentManaged(document)) {
        try {
          await this.publishDiagnostics(document);
        } catch (error) {
          ignoredStale(error);
        }
      }
    }
  }

  private snapshotDocument(document: vscode.TextDocument): SlangDocumentSnapshot {
    const fromSnapshot = this.snapshot?.files.find((file) => file.uri === document.uri.toString());
    return {
      ...documentSnapshot(document),
      path: fromSnapshot?.path.replace(/^\/workspace\/?/, "") ??
        this.relativeDocumentPath(document) ?? documentSnapshot(document).path,
    };
  }

  private async includeDocument(document: vscode.TextDocument): Promise<boolean> {
    if (!this.snapshot || this.snapshot.files.some((file) => file.uri === document.uri.toString())) {
      return this.snapshot !== undefined;
    }
    const relativePath = this.relativeDocumentPath(document);
    if (!relativePath) {
      return false;
    }
    let diskSource: string | undefined;
    try {
      diskSource = new TextDecoder().decode(await vscode.workspace.fs.readFile(document.uri));
    } catch {
      // A newly created, unsaved file still needs a path registration before
      // openDocument can establish its overlay. It is removed on close.
      this.transientRegistrations.add(document.uri.toString());
    }
    this.snapshot = {
      ...this.snapshot,
      files: [...this.snapshot.files, {
        uri: document.uri.toString(),
        path: `/workspace/${relativePath}`,
        source: diskSource ?? "",
      }].sort((left, right) => left.path.localeCompare(right.path)),
    };
    await this.client.replaceFiles(languageServiceSnapshot(this.snapshot));
    return true;
  }

  private async open(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== "slang" || !this.isDocumentManaged(document)) {
      return;
    }
    try {
      await this.initialized;
      if (!await this.includeDocument(document)) {
        return;
      }
      if (this.openedVersions.get(document.uri.toString()) !== document.version) {
        await this.client.openDocument(this.snapshotDocument(document));
        this.openedVersions.set(document.uri.toString(), document.version);
      }
      await this.publishDiagnostics(document);
    } catch (error) {
      ignoredStale(error);
    }
  }

  private async change(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== "slang" || !this.isDocumentManaged(document)) {
      return;
    }
    try {
      await this.initialized;
      if (!this.snapshot) {
        return;
      }
      await this.client.changeDocument(this.snapshotDocument(document));
      this.openedVersions.set(document.uri.toString(), document.version);
      await this.publishDiagnostics(document);
    } catch (error) {
      ignoredStale(error);
    }
  }

  private async close(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== "slang" || !this.isDocumentManaged(document)) {
      return;
    }
    try {
      await this.initialized;
      if (!this.snapshot) {
        return;
      }
      await this.client.closeDocument(document.uri.toString(), document.version);
      this.openedVersions.delete(document.uri.toString());
      this.diagnostics.delete(document.uri);
      if (this.transientRegistrations.delete(document.uri.toString())) {
        this.scheduleSnapshotRebuild(document.uri);
      }
    } catch (error) {
      ignoredStale(error);
    }
  }

  private async publishDiagnostics(document: vscode.TextDocument): Promise<void> {
    const values = await this.client.diagnostics(document.uri.toString(), document.version);
    if (document.version === vscode.workspace.textDocuments.find((item) => item.uri.toString() === document.uri.toString())?.version) {
      this.diagnostics.set(document.uri, values?.map(toDiagnostic) ?? []);
    }
  }

  private registerProviders(): vscode.Disposable[] {
    const ready = async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
      try {
        await this.initialized;
        if (this.disposed || this.initializationError) {
          return undefined;
        }
        return await operation();
      } catch (error) {
        ignoredStale(error);
        return undefined;
      }
    };
    const completions = vscode.languages.registerCompletionItemProvider(SLANG_DOCUMENT_SELECTOR, {
      provideCompletionItems: async (document, position, _token, context) => {
        if (!this.isDocumentManaged(document)) {
          return undefined;
        }
        const values = await ready(() => this.client.completion(
          document.uri.toString(), position, document.version,
          { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter ?? "" },
        ));
        return values?.map((dto) => {
          const item = toCompletionItem(dto);
          this.completionDtos.set(item, { dto, uri: document.uri.toString(), version: document.version });
          return item;
        });
      },
      resolveCompletionItem: async (item) => {
        const original = this.completionDtos.get(item);
        if (!original) {
          return item;
        }
        const resolved = await ready(() => this.client.completionResolve(original.uri, original.dto, original.version));
        return resolved ? toCompletionItem(resolved) : item;
      },
    }, ".", "(");
    return [
      completions,
      vscode.languages.registerHoverProvider(SLANG_DOCUMENT_SELECTOR, {
        provideHover: async (document, position) => this.isDocumentManaged(document)
          ? toHover(await ready(() => this.client.hover(document.uri.toString(), position, document.version)))
          : undefined,
      }),
      vscode.languages.registerDefinitionProvider(SLANG_DOCUMENT_SELECTOR, {
        provideDefinition: async (document, position) => this.isDocumentManaged(document)
          ? (await ready(() => this.client.definition(document.uri.toString(), position, document.version)))?.map(toLocation)
          : undefined,
      }),
      vscode.languages.registerSignatureHelpProvider(SLANG_DOCUMENT_SELECTOR, {
        provideSignatureHelp: async (document, position) => {
          if (!this.isDocumentManaged(document)) {
            return undefined;
          }
          const value = await ready(() => this.client.signatureHelp(document.uri.toString(), position, document.version));
          return value ? toSignatureHelp(value) : undefined;
        },
      }, "(", ","),
      vscode.languages.registerDocumentSymbolProvider(SLANG_DOCUMENT_SELECTOR, {
        provideDocumentSymbols: async (document) => this.isDocumentManaged(document)
          ? (await ready(() => this.client.documentSymbols(document.uri.toString(), document.version)))?.map(toDocumentSymbol)
          : undefined,
      }),
    ];
  }
}

export function registerSlangLanguageFeatures(
  context: vscode.ExtensionContext,
  options: RegisterSlangLanguageFeatureOptions = {
    createClient: SlangLanguageClient.forWorkerScript,
  },
): vscode.Disposable {
  const existing = activeRegistrations.get(context);
  if (existing) {
    return existing;
  }
  let session: SlangFeatureSession | undefined;
  let sessionRootUri: string | undefined;
  const update = (): void => {
    const enabled = vscode.workspace.getConfiguration("shader-studio").get("slangLanguageFeatures", true);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const nextRootUri = enabled ? workspaceFolder?.uri.toString() : undefined;
    if (session && sessionRootUri !== nextRootUri) {
      session.dispose();
      session = undefined;
      sessionRootUri = undefined;
    }
    if (enabled && workspaceFolder && !session) {
      session = new SlangFeatureSession(
        options.createClient(path.join(context.extensionPath, "dist", "slang", "slangLanguageWorker.js")),
        context,
        workspaceFolder,
      );
      sessionRootUri = nextRootUri;
    }
  };
  update();
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("shader-studio.slangLanguageFeatures")) {
      update();
    }
  });
  const workspaceFolders = vscode.workspace.onDidChangeWorkspaceFolders(() => update());
  const registration = new vscode.Disposable(() => {
    configuration.dispose();
    workspaceFolders.dispose();
    session?.dispose();
    session = undefined;
    activeRegistrations.delete(context);
  });
  activeRegistrations.set(context, registration);
  context.subscriptions.push(configuration, workspaceFolders, registration);
  return registration;
}
