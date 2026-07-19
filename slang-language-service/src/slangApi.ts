import type { SlangPosition, SlangRange } from "./types";

export interface SlangHandle {
  delete(): void;
}

export interface SlangList<T> extends SlangHandle {
  size(): number;
  get(index: number): T | undefined;
}

export interface SlangMutableList<T> extends SlangList<T> {
  push_back(value: T): void;
}

export interface SlangMarkupContent {
  kind: string;
  value: string;
}

export interface SlangTextEdit {
  range: SlangRange;
  text: string;
}

export interface SlangHover {
  contents: SlangMarkupContent;
  range: SlangRange;
}

export interface SlangLocation {
  uri: string;
  range: SlangRange;
}

export interface SlangCompletionItem {
  label: string;
  kind: number;
  detail: string;
  documentation?: SlangMarkupContent;
  textEdit?: SlangTextEdit;
  data: string;
  commitCharacters?: SlangList<string>;
}

export interface SlangCompletionContext {
  triggerKind: number;
  triggerCharacter: string;
}

export interface SlangParameterInformation {
  label: [number, number];
  documentation: SlangMarkupContent;
}

export interface SlangSignatureInformation {
  label: string;
  documentation: SlangMarkupContent;
  parameters: SlangList<SlangParameterInformation>;
}

export interface SlangSignatureHelp {
  signatures: SlangList<SlangSignatureInformation>;
  activeSignature: number;
  activeParameter: number;
}

export interface SlangDocumentSymbol {
  name: string;
  detail: string;
  kind: number;
  range: SlangRange;
  selectionRange: SlangRange;
  children: SlangList<SlangDocumentSymbol>;
}

export interface SlangDiagnosticResult {
  code: string;
  range: SlangRange;
  severity: number;
  message: string;
}

export interface SlangLanguageServer extends SlangHandle {
  didOpenTextDocument(path: string, source: string): void;
  didCloseTextDocument(path: string): void;
  didChangeTextDocument(path: string, edits: SlangList<SlangTextEdit>): void;
  hover(path: string, position: SlangPosition): SlangHover | undefined;
  gotoDefinition(path: string, position: SlangPosition): SlangList<SlangLocation> | undefined;
  completion(
    path: string,
    position: SlangPosition,
    context: SlangCompletionContext,
  ): SlangList<SlangCompletionItem> | undefined;
  completionResolve(item: SlangCompletionItem): SlangCompletionItem | undefined;
  signatureHelp(path: string, position: SlangPosition): SlangSignatureHelp | undefined;
  documentSymbol(path: string): SlangList<SlangDocumentSymbol> | undefined;
  getDiagnostics(path: string): SlangList<SlangDiagnosticResult> | undefined;
}

export interface SlangApiFileSystem {
  mkdirTree(path: string): void;
  writeFile(path: string, source: string): void;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
}

export interface SlangApi {
  FS: SlangApiFileSystem;
  TextEditList(): SlangMutableList<SlangTextEdit>;
  StringList(): SlangMutableList<string>;
  createLanguageServer(): SlangLanguageServer | null;
  getVersionString(): string;
}
