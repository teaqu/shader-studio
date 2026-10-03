import type { DocumentParams } from "@shader-studio/language-server-core";
import type { DocumentSymbol } from "vscode-languageserver-protocol";
import { documentSymbolKind } from "../WgslLanguageServiceSupport.js";
import type { WgslProviderContext } from "../WgslLanguageServiceBackend.js";

export class WgslSymbolsProvider {
  constructor(private readonly context: WgslProviderContext) {}
  async provide(params: DocumentParams): Promise<DocumentSymbol[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const globalScopeIds = new Set(state.analysis.scopes.filter((scope) => scope.kind === "global").map((scope) => scope.id));
    return state.analysis.symbols
      .filter((symbol) => !state.analysis.hostGlobalIds.has(symbol.id))
      .filter((symbol) => globalScopeIds.has(symbol.scopeId) || symbol.kind === "function" || symbol.kind === "type")
      .map((symbol) => ({ name: symbol.name, detail: symbol.signature ?? symbol.typeName, kind: documentSymbolKind(symbol), range: symbol.definition, selectionRange: symbol.declaration }));
  }
}
