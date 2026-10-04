import type { DocumentParams, RenameParams, ShaderDocumentSnapshot } from "@shader-studio/language-server-core";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { Diagnostic, WorkspaceEdit } from "vscode-languageserver-protocol";
import type { SlangRenameDocument } from "../rename.js";
import type { SlangLanguageServer } from "../slangLanguageServerTypes.js";

/** The authored document and generated Slang context shared by feature providers. */
export interface SlangProviderState {
  document: ShaderDocumentSnapshot;
  environment: ShaderAuthoringEnvironment;
  offset: number;
}

interface CurrentDocumentContext {
  current(params: DocumentParams): SlangProviderState | undefined;
}

export interface SlangCompletionContext extends CurrentDocumentContext {
  completion: SlangLanguageServer["completion"];
}

export interface SlangDiagnosticsContext extends CurrentDocumentContext {
  diagnostics: SlangLanguageServer["getDiagnostics"];
  compilerDiagnostics(state: SlangProviderState): Diagnostic[];
  unusedLocalDiagnostics(state: SlangProviderState, official: readonly Diagnostic[]): Diagnostic[];
}

export interface SlangHoverContext extends CurrentDocumentContext {
  hover: SlangLanguageServer["hover"];
  definition: SlangLanguageServer["gotoDefinition"];
}

export interface SlangNavigationContext extends CurrentDocumentContext {
  definition: SlangLanguageServer["gotoDefinition"];
  signatureHelp: SlangLanguageServer["signatureHelp"];
  renameDocuments(): SlangRenameDocument[];
  documentText(uri: string): string | undefined;
  nativeRename(documents: readonly SlangRenameDocument[], params: RenameParams): WorkspaceEdit | null;
  renameCompiles(documents: readonly SlangRenameDocument[], edit: WorkspaceEdit): boolean;
}

export interface SlangSymbolsContext extends CurrentDocumentContext {
  documentSymbols: SlangLanguageServer["documentSymbol"];
}
