import { SlangPathMap } from "./canonicalPaths";
import { copyList, copyOptionalList } from "./embind";
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
import type { SlangDocumentSnapshot, SlangPosition, SlangRange, SlangWorkspaceSnapshot } from "./types";
import { syncWorkspaceToFileSystem } from "./virtualFileSystem";

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

function copyMarkup(markup: SlangMarkupContent): SlangMarkupContent {
  return { kind: String(markup.kind), value: String(markup.value) };
}

function copyRange(range: SlangRange): SlangRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
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

function copyDiagnostic(diagnostic: SlangDiagnosticResult): DiagnosticDto {
  return {
    code: String(diagnostic.code),
    range: copyRange(diagnostic.range),
    severity: diagnostic.severity,
    message: String(diagnostic.message),
  };
}

export class SlangWorkspace {
  private readonly pathMap: SlangPathMap;
  private readonly server;
  private readonly openDocuments = new Map<string, { source: string; version: number }>();
  private readonly ownedPaths = new Set<string>();
  private readonly snapshotSources = new Map<string, string>();

  constructor(private readonly api: SlangApi, snapshot: SlangWorkspaceSnapshot) {
    this.pathMap = new SlangPathMap(snapshot.rootUri);
    this.registerSnapshot(snapshot);
    this.rememberSnapshotSources(snapshot);
    syncWorkspaceToFileSystem(api.FS, snapshot, this.openDocuments, this.ownedPaths);
    const server = api.createLanguageServer();
    if (server === null) {
      throw new Error("Slang failed to create a language server");
    }
    this.server = server;
  }

  replaceFiles(snapshot: SlangWorkspaceSnapshot): void {
    if (snapshot.rootUri !== this.pathMap.rootUri) {
      throw new Error("Cannot replace a Slang workspace with a different root URI");
    }
    this.registerSnapshot(snapshot);
    this.rememberSnapshotSources(snapshot);
    syncWorkspaceToFileSystem(this.api.FS, snapshot, this.openDocuments, this.ownedPaths);
  }

  openDocument(uri: string, source: string, version: number): boolean {
    const current = this.openDocuments.get(uri);
    if (current && version <= current.version) {
      return false;
    }
    const path = this.pathMap.toInternalPath(uri);
    if (current) {
      return this.changeDocument(uri, source, version);
    }
    this.server.didOpenTextDocument(path, source);
    this.api.FS.writeFile(path, source);
    this.openDocuments.set(uri, { source, version });
    return true;
  }

  changeDocument(uri: string, source: string, version: number): boolean {
    const current = this.openDocuments.get(uri);
    if (!current || version <= current.version) {
      return false;
    }
    const path = this.pathMap.toInternalPath(uri);
    const edits = this.api.TextEditList();
    try {
      edits.push_back({
        range: { start: { line: 0, character: 0 }, end: endPosition(current.source) },
        text: source,
      });
      this.server.didChangeTextDocument(path, edits);
    } finally {
      edits.delete();
    }
    this.api.FS.writeFile(path, source);
    this.openDocuments.set(uri, { source, version });
    return true;
  }

  closeDocument(uri: string, version: number): boolean {
    const current = this.openDocuments.get(uri);
    if (!current || version !== current.version) {
      return false;
    }
    const path = this.pathMap.toInternalPath(uri);
    this.server.didCloseTextDocument(path);
    this.openDocuments.delete(uri);
    const source = this.snapshotSources.get(uri);
    if (source !== undefined) {
      this.api.FS.writeFile(path, source);
    }
    return true;
  }

  hover(uri: string, position: SlangPosition): HoverDto | undefined {
    const result = this.server.hover(this.pathMap.toInternalPath(uri), position);
    if (!result) {
      return undefined;
    }
    return { contents: copyMarkup(result.contents), range: copyRange(result.range) };
  }

  definition(uri: string, position: SlangPosition): LocationDto[] | undefined {
    return copyOptionalList(
      this.server.gotoDefinition(this.pathMap.toInternalPath(uri), position),
      (location) => ({ uri: this.pathMap.toUri(String(location.uri)), range: copyRange(location.range) }),
    );
  }

  completion(
    uri: string,
    position: SlangPosition,
    context: SlangCompletionContext = { triggerKind: 1, triggerCharacter: "" },
  ): CompletionItemDto[] | undefined {
    return copyOptionalList(
      this.server.completion(this.pathMap.toInternalPath(uri), position, context),
      copyCompletionItem,
    );
  }

  completionResolve(item: CompletionItemDto): CompletionItemDto | undefined {
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
    const result = this.server.signatureHelp(this.pathMap.toInternalPath(uri), position);
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
    return copyOptionalList(this.server.documentSymbol(this.pathMap.toInternalPath(uri)), copySymbol);
  }

  diagnostics(uri: string): DiagnosticDto[] | undefined {
    return copyOptionalList(this.server.getDiagnostics(this.pathMap.toInternalPath(uri)), copyDiagnostic);
  }

  dispose(): void {
    this.server.delete();
  }

  private registerSnapshot(snapshot: SlangWorkspaceSnapshot): void {
    for (const file of snapshot.files) {
      this.pathMap.register(file.uri, file.path);
    }
  }

  private rememberSnapshotSources(snapshot: SlangWorkspaceSnapshot): void {
    this.snapshotSources.clear();
    for (const file of snapshot.files) {
      this.snapshotSources.set(file.uri, file.source);
    }
  }
}
