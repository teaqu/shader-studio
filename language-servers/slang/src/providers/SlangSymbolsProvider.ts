import {
  type DocumentParams
} from "@shader-studio/language-server-core";
import {
  type DocumentSymbol
} from "vscode-languageserver-protocol";

import { consumeList, convertDocumentSymbol, findSlangDeclarations } from "../SlangLanguageServiceSupport.js";
import type { SlangSymbolsContext } from "./SlangProviderContext.js";

export class SlangSymbolsProvider {
  constructor(private readonly context: SlangSymbolsContext) {}

  async provide(params: DocumentParams): Promise<DocumentSymbol[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.context.documentSymbols(params.document.uri), (item) => convertDocumentSymbol(item, state.offset, state.document.text))
      .filter((item): item is DocumentSymbol => item !== undefined);
    return official.length > 0 ? official : findSlangDeclarations(state.document.text).map((item) => ({
      name: item.name,
      detail: item.detail,
      kind: item.kind,
      range: item.range,
      selectionRange: item.selectionRange,
    }));
  }

}
