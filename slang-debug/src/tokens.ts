import type { DebugDiagnostic, DebugSourceRange } from "@shader-studio/types";

export type SlangTokenKind =
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "punctuation"
  | "comment"
  | "preprocessor"
  | "whitespace"
  | "unknown";

export interface SlangToken {
  kind: SlangTokenKind;
  text: string;
  sourceUri: string;
  startOffset: number;
  endOffset: number;
  range: DebugSourceRange;
}

export interface SlangTokenDocument {
  sourceUri: string;
  source: string;
  tokens: SlangToken[];
  diagnostics: DebugDiagnostic[];
}
