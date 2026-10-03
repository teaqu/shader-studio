import type { ColorPresentationParams, DocumentParams, DocumentPositionParams, LanguageService, ReferenceParams, RenameParams, ServerCapabilities, ShaderDocumentSnapshot } from "@shader-studio/language-server-core";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { CompletionItem, Diagnostic, DocumentHighlight, DocumentSymbol, Hover, Location, SignatureHelp, WorkspaceEdit } from "vscode-languageserver-protocol";
import { SlangLanguageServiceBackend } from "./SlangLanguageServiceBackend.js";
import type { SlangLanguageServerModule } from "./slangLanguageServerTypes.js";
import { SlangCompletionProvider } from "./providers/SlangCompletionProvider.js";
import { SlangDiagnosticsProvider } from "./providers/SlangDiagnosticsProvider.js";
import { SlangHoverProvider } from "./providers/SlangHoverProvider.js";
import { SlangNavigationProvider } from "./providers/SlangNavigationProvider.js";
import { SlangSymbolsProvider } from "./providers/SlangSymbolsProvider.js";

/** Coordinates document lifecycle and focused Slang language-feature providers. */
export class SlangLanguageService implements LanguageService {
  private readonly backend: SlangLanguageServiceBackend;
  private readonly completionProvider: SlangCompletionProvider;
  private readonly hoverProvider: SlangHoverProvider;
  private readonly navigationProvider: SlangNavigationProvider;
  private readonly symbolsProvider: SlangSymbolsProvider;
  private readonly diagnosticsProvider: SlangDiagnosticsProvider;

  constructor(module: SlangLanguageServerModule) {
    this.backend = new SlangLanguageServiceBackend(module);
    this.completionProvider = new SlangCompletionProvider(this.backend);
    this.hoverProvider = new SlangHoverProvider(this.backend);
    this.navigationProvider = new SlangNavigationProvider(this.backend);
    this.symbolsProvider = new SlangSymbolsProvider(this.backend);
    this.diagnosticsProvider = new SlangDiagnosticsProvider(this.backend);
  }

  initialize(): Promise<ServerCapabilities> {
    return this.backend.initialize();
  }
  syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    return this.backend.syncEnvironment(environment);
  }
  openDocument(document: ShaderDocumentSnapshot): Promise<void> {
    return this.backend.openDocument(document);
  }
  changeDocument(document: ShaderDocumentSnapshot): Promise<void> {
    return this.backend.changeDocument(document);
  }
  closeDocument(uri: string): Promise<void> {
    return this.backend.closeDocument(uri);
  }
  completion(params: DocumentPositionParams): Promise<CompletionItem[]> {
    return this.completionProvider.provide(params);
  }
  hover(params: DocumentPositionParams): Promise<Hover | null> {
    return this.hoverProvider.provide(params);
  }
  definition(params: DocumentPositionParams): Promise<Location[]> {
    return this.navigationProvider.definition(params);
  }
  signatureHelp(params: DocumentPositionParams): Promise<SignatureHelp | null> {
    return this.navigationProvider.signatureHelp(params);
  }
  documentSymbols(params: DocumentParams): Promise<DocumentSymbol[]> {
    return this.symbolsProvider.provide(params);
  }
  references(params: ReferenceParams): Promise<Location[]> {
    return this.navigationProvider.references(params);
  }
  documentHighlights(params: DocumentPositionParams): Promise<DocumentHighlight[]> {
    return this.navigationProvider.documentHighlights(params);
  }
  rename(params: RenameParams): Promise<WorkspaceEdit | null> {
    return this.navigationProvider.rename(params);
  }
  diagnostics(params: DocumentParams): Promise<Diagnostic[]> {
    return this.diagnosticsProvider.provide(params);
  }
  documentColors(params: DocumentParams) {
    return this.backend.documentColors(params);
  }
  colorPresentations(params: ColorPresentationParams) {
    return this.backend.colorPresentations(params);
  }
  dispose(): Promise<void> {
    return this.backend.dispose();
  }
}
