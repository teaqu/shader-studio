import { normalizeInternalPath, SlangPathMap } from "./canonicalPaths";
import { copyList, copyOptionalList } from "./embind";
import { createShaderStudioAnalysisSource } from "./shaderStudioContext";
import type {
  SlangApi,
  SlangCompletionContext,
  SlangCompletionItem,
  SlangDiagnosticResult,
  SlangDocumentSymbol,
  SlangMarkupContent,
  SlangParameterInformation,
  SlangSignatureInformation,
} from "./slangApi";
import type { SlangPosition, SlangRange, SlangWorkspaceSnapshot } from "./types";
import { releaseWorkspaceFileSystem, syncWorkspaceToFileSystem } from "./virtualFileSystem";

export interface HoverDto {
  contents: SlangMarkupContent;
  range: SlangRange;
}

export interface LocationDto {
  uri: string;
  range: SlangRange;
}

export interface CompletionItemDto {
  label: string;
  kind: number;
  detail: string;
  documentation?: SlangMarkupContent;
  textEdit?: { range: SlangRange; text: string };
  data: string;
  commitCharacters?: string[];
}

export interface ParameterInformationDto {
  label: [number, number];
  documentation: SlangMarkupContent;
}

export interface SignatureInformationDto {
  label: string;
  documentation: SlangMarkupContent;
  parameters: ParameterInformationDto[];
}

export interface SignatureHelpDto {
  signatures: SignatureInformationDto[];
  activeSignature: number;
  activeParameter: number;
}

export interface DocumentSymbolDto {
  name: string;
  detail: string;
  kind: number;
  range: SlangRange;
  selectionRange: SlangRange;
  children: DocumentSymbolDto[];
}

export interface DiagnosticDto {
  code: string;
  range: SlangRange;
  severity: number;
  message: string;
}

function endPosition(source: string): SlangPosition {
  const lines = source.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}

function positionAtOrAfter(position: SlangPosition, boundary: SlangPosition): boolean {
  return position.line > boundary.line
    || (position.line === boundary.line && position.character >= boundary.character);
}

function copyMarkup(markup: SlangMarkupContent): SlangMarkupContent {
  return { kind: String(markup.kind), value: String(markup.value) };
}

function copyRange(range: SlangRange): SlangRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function toLanguageServerUri(path: string): string {
  return new URL(`file://${normalizeInternalPath(path)}`).href;
}

function fromLanguageServerUri(uri: string): string {
  if (!uri.startsWith("file:")) {
    return normalizeInternalPath(uri);
  }
  const parsed = new URL(uri);
  if (parsed.protocol !== "file:" || (parsed.hostname && parsed.hostname !== "localhost")) {
    throw new Error(`Slang language server returned unsupported URI "${uri}"`);
  }
  return normalizeInternalPath(decodeURIComponent(parsed.pathname));
}

function copyCompletionItem(item: SlangCompletionItem): CompletionItemDto {
  return {
    label: String(item.label),
    kind: item.kind,
    detail: String(item.detail),
    ...(item.documentation ? { documentation: copyMarkup(item.documentation) } : {}),
    ...(item.textEdit ? { textEdit: { range: copyRange(item.textEdit.range), text: String(item.textEdit.text) } } : {}),
    data: String(item.data),
    ...(item.commitCharacters
      ? { commitCharacters: copyList(item.commitCharacters, (character) => String(character)) }
      : {}),
  };
}

function copyParameter(parameter: SlangParameterInformation): ParameterInformationDto {
  return {
    label: [parameter.label[0], parameter.label[1]],
    documentation: copyMarkup(parameter.documentation),
  };
}

function copySignature(signature: SlangSignatureInformation): SignatureInformationDto {
  return {
    label: String(signature.label),
    documentation: copyMarkup(signature.documentation),
    parameters: copyList(signature.parameters, copyParameter),
  };
}

function copySymbol(symbol: SlangDocumentSymbol): DocumentSymbolDto {
  return {
    name: String(symbol.name),
    detail: String(symbol.detail),
    kind: symbol.kind,
    range: copyRange(symbol.range),
    selectionRange: copyRange(symbol.selectionRange),
    children: copyList(symbol.children, copySymbol),
  };
}

function filterSymbols(symbols: DocumentSymbolDto[], boundary: SlangPosition): DocumentSymbolDto[] {
  return symbols
    .filter((symbol) => !positionAtOrAfter(symbol.range.start, boundary))
    .map((symbol) => ({ ...symbol, children: filterSymbols(symbol.children, boundary) }));
}

function copyDiagnostic(diagnostic: SlangDiagnosticResult): DiagnosticDto {
  return {
    code: String(diagnostic.code),
    range: copyRange(diagnostic.range),
    severity: diagnostic.severity,
    message: String(diagnostic.message),
  };
}

export class SlangWorkspace {
  private pathMap: SlangPathMap;
  private readonly server;
  private readonly openDocuments = new Map<
    string,
    { source: string; analysisSource: string; version: number }
  >();
  private readonly ownedPaths = new Set<string>();
  private currentSnapshot: SlangWorkspaceSnapshot;
  private disposed = false;

  constructor(private readonly api: SlangApi, snapshot: SlangWorkspaceSnapshot) {
    this.pathMap = new SlangPathMap(snapshot.rootUri);
    this.registerSnapshot(snapshot);
    this.currentSnapshot = snapshot;
    syncWorkspaceToFileSystem(api.FS, snapshot, this.openDocuments, this.ownedPaths);
    const server = api.createLanguageServer();
    if (server === null) {
      throw new Error("Slang failed to create a language server");
    }
    this.server = server;
  }

  replaceFiles(snapshot: SlangWorkspaceSnapshot): void {
    this.ensureActive();
    if (snapshot.rootUri !== this.pathMap.rootUri) {
      throw new Error("Cannot replace a Slang workspace with a different root URI");
    }
    const nextPathMap = this.createPathMap(snapshot);
    const snapshotUris = new Set(snapshot.files.map((file) => file.uri));
    const effectiveFiles = [...snapshot.files];
    const movedDocuments: Array<{
      uri: string;
      oldPath: string;
      newPath: string;
      analysisSource: string;
    }> = [];
    for (const [uri, document] of this.openDocuments) {
      const oldPath = this.pathMap.toInternalPath(uri);
      if (!snapshotUris.has(uri)) {
        nextPathMap.register(uri, oldPath.slice("/workspace/".length));
        effectiveFiles.push({ uri, path: oldPath, source: document.source, version: document.version });
      }
      const newPath = nextPathMap.toInternalPath(uri);
      if (oldPath !== newPath) {
        movedDocuments.push({ uri, oldPath, newPath, analysisSource: document.analysisSource });
      }
    }
    syncWorkspaceToFileSystem(
      this.api.FS,
      { rootUri: snapshot.rootUri, files: effectiveFiles },
      this.openDocuments,
      this.ownedPaths,
    );
    this.pathMap = nextPathMap;
    this.currentSnapshot = snapshot;
    for (const document of movedDocuments) {
      this.server.didCloseTextDocument(toLanguageServerUri(document.oldPath));
      this.server.didOpenTextDocument(toLanguageServerUri(document.newPath), document.analysisSource);
    }
  }

  openDocument(uri: string, source: string, version: number): boolean {
    this.ensureActive();
    this.ensureMounted();
    const current = this.openDocuments.get(uri);
    if (current && version <= current.version) {
      return false;
    }
    const path = this.pathMap.toInternalPath(uri);
    if (current) {
      return this.changeDocument(uri, source, version);
    }
    const analysisSource = createShaderStudioAnalysisSource(source);
    this.server.didOpenTextDocument(toLanguageServerUri(path), analysisSource);
    this.api.FS.writeFile(path, source);
    this.openDocuments.set(uri, { source, analysisSource, version });
    return true;
  }

  changeDocument(uri: string, source: string, version: number): boolean {
    this.ensureActive();
    this.ensureMounted();
    const current = this.openDocuments.get(uri);
    if (!current || version <= current.version) {
      return false;
    }
    const path = this.pathMap.toInternalPath(uri);
    const analysisSource = createShaderStudioAnalysisSource(source);
    const edits = this.api.TextEditList();
    try {
      edits.push_back({
        range: { start: { line: 0, character: 0 }, end: endPosition(current.analysisSource) },
        text: analysisSource,
      });
      this.server.didChangeTextDocument(toLanguageServerUri(path), edits);
    } finally {
      edits.delete();
    }
    this.api.FS.writeFile(path, source);
    this.openDocuments.set(uri, { source, analysisSource, version });
    return true;
  }

  closeDocument(uri: string, version: number): boolean {
    this.ensureActive();
    this.ensureMounted();
    const current = this.openDocuments.get(uri);
    if (!current || version !== current.version) {
      return false;
    }
    const path = this.pathMap.toInternalPath(uri);
    this.server.didCloseTextDocument(toLanguageServerUri(path));
    this.openDocuments.delete(uri);
    syncWorkspaceToFileSystem(this.api.FS, this.currentSnapshot, this.openDocuments, this.ownedPaths);
    this.pathMap = this.createPathMap(this.currentSnapshot);
    return true;
  }

  hover(uri: string, position: SlangPosition): HoverDto | undefined {
    this.ensureActive();
    this.ensureMounted();
    const result = this.server.hover(toLanguageServerUri(this.pathMap.toInternalPath(uri)), position);
    if (!result) {
      return undefined;
    }
    return { contents: copyMarkup(result.contents), range: copyRange(result.range) };
  }

  definition(uri: string, position: SlangPosition): LocationDto[] | undefined {
    this.ensureActive();
    this.ensureMounted();
    const locations = copyOptionalList(
      this.server.gotoDefinition(toLanguageServerUri(this.pathMap.toInternalPath(uri)), position),
      (location) => ({
        uri: this.pathMap.toUri(fromLanguageServerUri(String(location.uri))),
        range: copyRange(location.range),
      }),
    );
    const document = this.openDocuments.get(uri);
    if (!locations || !document) {
      return locations;
    }
    const boundary = endPosition(document.source);
    return locations.filter(
      (location) => location.uri !== uri || !positionAtOrAfter(location.range.start, boundary),
    );
  }

  completion(
    uri: string,
    position: SlangPosition,
    context: SlangCompletionContext = { triggerKind: 1, triggerCharacter: "" },
  ): CompletionItemDto[] | undefined {
    this.ensureActive();
    this.ensureMounted();
    return copyOptionalList(
      this.server.completion(toLanguageServerUri(this.pathMap.toInternalPath(uri)), position, context),
      copyCompletionItem,
    );
  }

  completionResolve(item: CompletionItemDto): CompletionItemDto | undefined {
    this.ensureActive();
    this.ensureMounted();
    const commitCharacters = item.commitCharacters ? this.api.StringList() : undefined;
    try {
      for (const character of item.commitCharacters ?? []) {
        commitCharacters?.push_back(character);
      }
      const nativeItem: SlangCompletionItem = {
        label: item.label,
        kind: item.kind,
        detail: item.detail,
        data: item.data,
        ...(item.documentation ? { documentation: item.documentation } : {}),
        ...(item.textEdit ? { textEdit: item.textEdit } : {}),
        ...(commitCharacters ? { commitCharacters } : {}),
      };
      const result = this.server.completionResolve(nativeItem);
      return result ? copyCompletionItem(result) : undefined;
    } finally {
      commitCharacters?.delete();
    }
  }

  signatureHelp(uri: string, position: SlangPosition): SignatureHelpDto | undefined {
    this.ensureActive();
    this.ensureMounted();
    const result = this.server.signatureHelp(toLanguageServerUri(this.pathMap.toInternalPath(uri)), position);
    if (!result) {
      return undefined;
    }
    return {
      signatures: copyList(result.signatures, copySignature),
      activeSignature: result.activeSignature,
      activeParameter: result.activeParameter,
    };
  }

  documentSymbols(uri: string): DocumentSymbolDto[] | undefined {
    this.ensureActive();
    this.ensureMounted();
    const symbols = copyOptionalList(
      this.server.documentSymbol(toLanguageServerUri(this.pathMap.toInternalPath(uri))),
      copySymbol,
    );
    const document = this.openDocuments.get(uri);
    if (!symbols || !document) {
      return symbols;
    }
    return filterSymbols(symbols, endPosition(document.source));
  }

  diagnostics(uri: string): DiagnosticDto[] | undefined {
    this.ensureActive();
    this.ensureMounted();
    const diagnostics = copyOptionalList(
      this.server.getDiagnostics(toLanguageServerUri(this.pathMap.toInternalPath(uri))),
      copyDiagnostic,
    );
    const document = this.openDocuments.get(uri);
    if (!diagnostics || !document) {
      return diagnostics;
    }
    const boundary = endPosition(document.source);
    return diagnostics.filter((diagnostic) => !positionAtOrAfter(diagnostic.range.start, boundary));
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      this.server.delete();
    } finally {
      releaseWorkspaceFileSystem(this.api.FS, this.ownedPaths);
    }
  }

  private registerSnapshot(snapshot: SlangWorkspaceSnapshot): void {
    for (const file of snapshot.files) {
      this.pathMap.register(file.uri, file.path);
    }
  }

  private createPathMap(snapshot: SlangWorkspaceSnapshot): SlangPathMap {
    const pathMap = new SlangPathMap(snapshot.rootUri);
    for (const file of snapshot.files) {
      pathMap.register(file.uri, file.path);
    }
    for (const uri of this.openDocuments.keys()) {
      if (snapshot.files.some((file) => file.uri === uri)) {
        continue;
      }
      const path = this.pathMap.toInternalPath(uri);
      pathMap.register(uri, path.slice("/workspace/".length));
    }
    return pathMap;
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error("Slang workspace is disposed");
    }
  }

  private ensureMounted(): void {
    const snapshotUris = new Set(this.currentSnapshot.files.map((file) => file.uri));
    const files = [...this.currentSnapshot.files];
    for (const [uri, document] of this.openDocuments) {
      if (!snapshotUris.has(uri)) {
        files.push({
          uri,
          path: this.pathMap.toInternalPath(uri),
          source: document.source,
          version: document.version,
        });
      }
    }
    syncWorkspaceToFileSystem(
      this.api.FS,
      { rootUri: this.currentSnapshot.rootUri, files },
      this.openDocuments,
      this.ownedPaths,
    );
  }
}
