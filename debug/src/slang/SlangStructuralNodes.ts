import type { DebugOrigin, DebugSourceRange } from "@shader-studio/types";
import type { SlangDeclarationNode, SlangStatementKind, SlangStatementNode } from "./model";
import type { SlangToken, SlangTokenDocument } from "./tokens";
import { stableId } from "./SlangStructuralParserTokens";

export function directDeclaration(document: SlangTokenDocument, nameToken: SlangToken, typeName: string, statementRange: DebugSourceRange, scopeId: string, access: SlangDeclarationNode["access"], modifiers: string[] = []): SlangDeclarationNode {
  return createDeclaration(document, nameToken, typeName, statementRange, scopeId, access, { kind: "direct", writableRange: nameToken.range }, modifiers);
}

export function createDeclaration(document: SlangTokenDocument, nameToken: SlangToken, typeName: string, statementRange: DebugSourceRange, scopeId: string, access: SlangDeclarationNode["access"], origin: DebugOrigin, modifiers: string[] = []): SlangDeclarationNode {
  const id = stableId("declaration", nameToken);
  return { id, name: nameToken.text, typeName, sourceUri: document.sourceUri, range: nameToken.range, statementRange, scopeId, access, origin, modifiers };
}

export function createStatement(token: SlangToken, kind: SlangStatementKind, range: DebugSourceRange, scopeId: string): SlangStatementNode {
  return { id: stableId("statement", token), kind, sourceUri: token.sourceUri, range, scopeId };
}
