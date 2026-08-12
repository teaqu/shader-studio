import type { Position, Range } from "vscode-languageserver-protocol";

export interface SlangList<T> {
  size(): number;
  get(index: number): T | undefined;
  delete?(): void;
}

export interface SlangMarkup { kind: string; value: string }
export interface SlangTextEdit { range: Range; text: string }
export interface SlangCompletionItem {
  label: string;
  kind: number;
  detail: string;
  documentation?: SlangMarkup;
  textEdit?: SlangTextEdit;
  data: string;
}
export interface SlangHover { contents: SlangMarkup; range: Range }
export interface SlangLocation { uri: string; range: Range }
export interface SlangParameterInformation { label: [number, number]; documentation: SlangMarkup }
export interface SlangSignatureInformation {
  label: string;
  documentation: SlangMarkup;
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
  range: Range;
  selectionRange: Range;
  children: SlangList<SlangDocumentSymbol>;
}
export interface SlangDiagnostic { code: string; range: Range; severity: number; message: string }

export interface SlangLanguageServer {
  didOpenTextDocument(uri: string, text: string): void;
  didCloseTextDocument(uri: string): void;
  didChangeTextDocument(uri: string, edits: unknown): void;
  hover(uri: string, position: Position): SlangHover | undefined;
  gotoDefinition(uri: string, position: Position): SlangList<SlangLocation> | undefined;
  completion(uri: string, position: Position, context: { triggerKind: number; triggerCharacter: string }): SlangList<SlangCompletionItem> | undefined;
  signatureHelp(uri: string, position: Position): SlangSignatureHelp | undefined;
  documentSymbol(uri: string): SlangList<SlangDocumentSymbol> | undefined;
  getDiagnostics(uri: string): SlangList<SlangDiagnostic> | undefined;
  delete?(): void;
}

export interface SlangLanguageServerModule {
  createLanguageServer(): SlangLanguageServer | null;
}
