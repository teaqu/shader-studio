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

/**
 * Declarations that live outside the parsed source, such as configured storage
 * buffers, Common helpers, and generated channel functions. Inference consults
 * it only for names the document itself does not resolve.
 */
export interface WgslInferenceContext {
  readonly valueType?: (name: string) => string | undefined;
  /** Return type of a function; generic results such as `T` are ignored. */
  readonly functionType?: (name: string) => string | undefined;
  /** Field type of a struct the document does not declare, such as one from Common. */
  readonly fieldType?: (owner: string, field: string) => string | undefined;
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
