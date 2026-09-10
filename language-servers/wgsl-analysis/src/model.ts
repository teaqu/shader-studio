import type { ShaderStage } from "@shader-studio/types";
import type { Range } from "vscode-languageserver-protocol";

export type WgslSymbolKind =
  | "variable"
  | "parameter"
  | "function"
  | "type"
  | "field"
  | "constant";

export interface WgslSymbol {
  readonly id: string;
  readonly name: string;
  readonly kind: WgslSymbolKind;
  readonly typeName?: string;
  readonly signature?: string;
  readonly declaration: Range;
  readonly definition: Range;
  readonly references: readonly Range[];
  readonly scopeId: string;
}

export interface WgslScope {
  readonly id: string;
  readonly name: string;
  readonly kind: "global" | "function" | "block" | "type";
  readonly parentId?: string;
  readonly range: Range;
  readonly symbolIds: readonly string[];
}

export interface WgslParseDiagnostic {
  readonly code: "syntax";
  readonly message: string;
  readonly range: Range;
  readonly severity: 1;
}

export interface WgslUnresolvedReference {
  readonly name: string;
  readonly kind: "variable" | "function" | "type";
  readonly ranges: readonly Range[];
}

export type WgslStatementKind =
  | "declaration"
  | "assignment"
  | "call"
  | "expression"
  | "return"
  | "if"
  | "switch"
  | "loop"
  | "for"
  | "while"
  | "break"
  | "continue"
  | "discard"
  | "const_assert"
  | "block";

export interface WgslStatement {
  readonly kind: WgslStatementKind;
  readonly range: Range;
  readonly scopeId: string;
}

export interface WgslAnalysisDocument {
  readonly uri: string;
  readonly source: string;
  /** WGSL has no preprocessor, so this is always identical to `source`. */
  readonly processedSource: string;
  readonly stage: ShaderStage;
  readonly parsedSuccessfully: boolean;
  readonly symbols: readonly WgslSymbol[];
  readonly scopes: readonly WgslScope[];
  readonly diagnostics: readonly WgslParseDiagnostic[];
  readonly unresolvedReferences: readonly WgslUnresolvedReference[];
  /** Every statement in source order, anchoring debugger sites and edits. */
  readonly statements: readonly WgslStatement[];
  /** Identity mappings: WGSL has no preprocessing step to shift lines. */
  readonly originalToProcessed: readonly number[];
  readonly processedToOriginal: readonly number[];
  /**
   * Ids of the synthetic host-global symbols (`iTime`, ...) seeded so
   * references resolve. They have no source declaration: rename, definition,
   * and outline consumers must decline or skip them.
   */
  readonly hostGlobalIds: ReadonlySet<string>;
}
