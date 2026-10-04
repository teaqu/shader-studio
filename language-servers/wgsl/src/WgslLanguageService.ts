import type { ColorPresentationParams, DocumentParams, DocumentPositionParams, LanguageService, ReferenceParams, RenameParams, ServerCapabilities, ShaderDocumentSnapshot } from "@shader-studio/language-server-core";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import type { CompletionItem, Diagnostic, DocumentHighlight, DocumentSymbol, Hover, Location, SignatureHelp, WorkspaceEdit } from "vscode-languageserver-protocol";
import { WgslLanguageServiceBackend } from "./WgslLanguageServiceBackend.js";
import { WgslCompletionProvider } from "./providers/WgslCompletionProvider.js";
import { WgslDiagnosticsProvider } from "./providers/WgslDiagnosticsProvider.js";
import { WgslHoverProvider } from "./providers/WgslHoverProvider.js";
import { WgslNavigationProvider } from "./providers/WgslNavigationProvider.js";
import { WgslSymbolsProvider } from "./providers/WgslSymbolsProvider.js";

/** Coordinates document lifecycle and focused WGSL language-feature providers. */
export class WgslLanguageService implements LanguageService {
  private readonly backend = new WgslLanguageServiceBackend();
  private readonly completionProvider = new WgslCompletionProvider(this.backend);
  private readonly hoverProvider = new WgslHoverProvider(this.backend);
  private readonly navigationProvider = new WgslNavigationProvider(this.backend);
  private readonly symbolsProvider = new WgslSymbolsProvider(this.backend);
  private readonly diagnosticsProvider = new WgslDiagnosticsProvider(this.backend);

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
    return this.navigationProvider.highlights(params);
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
