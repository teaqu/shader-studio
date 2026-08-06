import type { DebugDiagnostic, DebugOrigin, DebugSourceRange } from "@shader-studio/types";
import type { SlangToken } from "./tokens";

export type SlangCallableKind = "free" | "method" | "extension";

export interface SlangCallableNode {
  id: string;
  kind: SlangCallableKind;
  name: string;
  ownerType: string | null;
  returnTypeName: string;
  genericParameters: string[];
  parameters: SlangDeclarationNode[];
  signatureRange: DebugSourceRange;
  bodyRange: DebugSourceRange;
  nameToken: SlangToken;
  scopeId: string;
  attributes: string[];
  modifiers: string[];
}

export interface SlangDeclarationNode {
  id: string;
  name: string;
  typeName: string;
  sourceUri: string;
  range: DebugSourceRange;
  statementRange: DebugSourceRange;
  scopeId: string;
  access: "read" | "write" | "readwrite";
  origin: DebugOrigin;
  modifiers: string[];
}

export type SlangScopeKind = "module" | "type" | "callable" | "block" | "loop";

export interface SlangScopeNode {
  id: string;
  kind: SlangScopeKind;
  sourceUri: string;
  range: DebugSourceRange;
  parentId: string | null;
}

export type SlangStatementKind = "declaration" | "expression" | "return" | "break" | "continue" | "discard";

export interface SlangStatementNode {
  id: string;
  kind: SlangStatementKind;
  sourceUri: string;
  range: DebugSourceRange;
  scopeId: string;
}

export type SlangControlFlowKind = "if" | "switch" | "for" | "while" | "do";

export interface SlangControlFlowNode {
  id: string;
  kind: SlangControlFlowKind;
  sourceUri: string;
  range: DebugSourceRange;
  scopeId: string;
}

export type SlangTypeKind = "interface" | "struct" | "class" | "extension";

export interface SlangTypeNode {
  id: string;
  kind: SlangTypeKind;
  name: string;
  genericParameters: string[];
  conformances: string[];
  range: DebugSourceRange;
  bodyRange: DebugSourceRange;
  nameToken: SlangToken;
  scopeId: string;
  attributes: string[];
  modifiers: string[];
}

export type SlangDelimiterKind = "parenthesis" | "bracket" | "brace" | "generic";

export interface SlangDelimiterNode {
  id: string;
  kind: SlangDelimiterKind;
  range: DebugSourceRange;
  openToken: SlangToken;
  closeToken: SlangToken;
}

export interface SlangStructuralDocument {
  sourceUri: string;
  moduleName: string | null;
  imports: string[];
  delimiters: Map<string, SlangDelimiterNode>;
  scopes: Map<string, SlangScopeNode>;
  types: Map<string, SlangTypeNode>;
  callables: Map<string, SlangCallableNode>;
  declarations: Map<string, SlangDeclarationNode>;
  statements: Map<string, SlangStatementNode>;
  controlFlows: Map<string, SlangControlFlowNode>;
  diagnostics: DebugDiagnostic[];
}
