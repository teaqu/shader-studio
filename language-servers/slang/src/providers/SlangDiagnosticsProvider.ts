import {
  type DocumentParams
} from "@shader-studio/language-server-core";
import {
  validateShaderAuthoringEnvironment
} from "@shader-studio/types";
import {
  DiagnosticSeverity,
  type Diagnostic
} from "vscode-languageserver-protocol";

import { authoredChannelCollisionDiagnostics, consumeList, convertDiagnostic, zeroRange } from "../SlangLanguageServiceSupport.js";
import type { SlangDiagnosticsContext } from "./SlangProviderContext.js";

export class SlangDiagnosticsProvider {
  constructor(private readonly context: SlangDiagnosticsContext) {}

  async provide(params: DocumentParams): Promise<Diagnostic[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.context.diagnostics(params.document.uri), (item) => convertDiagnostic(item, state.offset, state.document.text))
      .filter((item): item is Diagnostic => item !== undefined);
    const environment = validateShaderAuthoringEnvironment(state.environment).map((issue) => ({
      range: zeroRange(),
      severity: DiagnosticSeverity.Warning,
      source: "shader-studio-slang-ls",
      code: issue.code,
      message: issue.message,
    }));
    const compiler = official.length === 0 ? this.context.compilerDiagnostics(state) : [];
    return [...official, ...compiler, ...environment, ...authoredChannelCollisionDiagnostics(state), ...this.context.unusedLocalDiagnostics(state, official)];
  }

}
