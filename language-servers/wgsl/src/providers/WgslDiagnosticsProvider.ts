import type { DocumentParams } from "@shader-studio/language-server-core";
import type { Diagnostic } from "vscode-languageserver-protocol";
import { DiagnosticSeverity } from "vscode-languageserver-protocol";
import { validateShaderAuthoringEnvironment } from "@shader-studio/types";
import { comparePosition, errorDiagnostic, rangeKey, reservedWordDiagnostics, samplingStageWarnings, SERVICE_SOURCE, stageDiagnostics, unresolvedReferenceDiagnostics, unusedSymbolDiagnostics, zeroRange } from "../WgslLanguageServiceSupport.js";
import type { WgslProviderContext } from "../WgslLanguageServiceBackend.js";

export class WgslDiagnosticsProvider {
  constructor(private readonly context: WgslProviderContext) {}
  async provide(params: DocumentParams): Promise<Diagnostic[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const includes = this.context.includes(params.document.uri);
    const samplingWarnings = samplingStageWarnings(state.analysis, state.environment, includes);
    const diagnostics: Diagnostic[] = [];
    const [syntax] = state.analysis.diagnostics;
    if (syntax) {
      diagnostics.push(errorDiagnostic(syntax.range, "syntax", syntax.message));
    } else {
      const warned = new Set(samplingWarnings.map((warning) => rangeKey(warning.range)));
      const names = state.environment.passName.toLowerCase() === "common" ? [] : unresolvedReferenceDiagnostics(state.analysis, state.environment, includes);
      diagnostics.push(...[...reservedWordDiagnostics(state.analysis), ...names.filter((diagnostic) => !warned.has(rangeKey(diagnostic.range))), ...stageDiagnostics(state.analysis, state.environment, includes.filter((included) => included.uri !== "shader-studio://generated/channels.wgsl"))].sort((left, right) => comparePosition(left.range.start, right.range.start)));
    }
    diagnostics.push(...unusedSymbolDiagnostics(state.analysis), ...samplingWarnings);
    diagnostics.push(...validateShaderAuthoringEnvironment(state.environment).map((issue) => ({ range: zeroRange(), severity: DiagnosticSeverity.Warning, source: SERVICE_SOURCE, code: issue.code, message: issue.message })));
    return diagnostics;
  }
}
