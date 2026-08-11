import type { ShaderStage } from "@shader-studio/types";
import type { Range } from "vscode-languageserver-protocol";

export type GlslSymbolKind = "variable" | "parameter" | "function" | "type" | "field";

export interface GlslSymbol {
  readonly id: string;
  readonly name: string;
  readonly kind: GlslSymbolKind;
  readonly typeName?: string;
  readonly signature?: string;
  readonly declaration: Range;
  readonly references: readonly Range[];
  readonly scopeId: string;
}

export interface GlslScope {
  readonly id: string;
  readonly name: string;
  readonly kind: "global" | "function" | "block" | "type";
  readonly parentId?: string;
  readonly range: Range;
  readonly symbolIds: readonly string[];
}

export interface GlslParseDiagnostic {
  readonly code: "preprocess" | "syntax";
  readonly message: string;
  readonly range: Range;
  readonly severity: 1;
}

export interface GlslAnalysisDocument {
  readonly uri: string;
  readonly source: string;
  readonly processedSource: string;
  readonly stage: ShaderStage;
  readonly parsedSuccessfully: boolean;
  readonly symbols: readonly GlslSymbol[];
  readonly scopes: readonly GlslScope[];
  readonly diagnostics: readonly GlslParseDiagnostic[];
  readonly originalToProcessed: readonly number[];
  readonly processedToOriginal: readonly number[];
}
