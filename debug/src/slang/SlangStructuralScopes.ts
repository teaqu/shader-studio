import type { SlangScopeKind,SlangScopeNode,SlangTypeNode } from "./model";
import { moduleScopeId,offsetForPosition,stableId } from "./SlangStructuralParserTokens";
import type { SlangToken,SlangTokenDocument } from "./tokens";

export interface DelimiterPair {
  kind: "parenthesis" | "bracket" | "brace" | "generic";
  openIndex: number;
  closeIndex: number;
}

export function buildScopes(document: SlangTokenDocument, tokens: SlangToken[], pairs: DelimiterPair[]): Map<string, SlangScopeNode> {
  const scopes = new Map<string, SlangScopeNode>();
  const documentEnd = document.tokens[document.tokens.length - 1]?.range.end ?? { line: 0, character: 0 };
  const moduleId = moduleScopeId(document);
  scopes.set(moduleId, { id: moduleId, kind: "module", sourceUri: document.sourceUri, range: { start: { line: 0, character: 0 }, end: documentEnd }, parentId: null });
  const parenthesisByClose = new Map<number, number>();
  for (const pair of pairs) {
    if (pair.kind === "parenthesis") {
      parenthesisByClose.set(pair.closeIndex, pair.openIndex);
    }
  }
  const braces = pairs.filter((pair) => pair.kind === "brace").sort((left, right) => tokens[left.openIndex].startOffset - tokens[right.openIndex].startOffset);
  for (const brace of braces) {
    const openToken = tokens[brace.openIndex];
    const closeToken = tokens[brace.closeIndex];
    const parent = findParentScope(scopes, openToken.startOffset, document, tokens);
    const id = stableId("scope", openToken);
    scopes.set(id, { id, kind: classifyBraceScope(tokens, brace.openIndex, parenthesisByClose), sourceUri: document.sourceUri, range: { start: openToken.range.start, end: closeToken.range.end }, parentId: parent.id });
  }
  return scopes;
}

function classifyBraceScope(tokens: SlangToken[], openIndex: number, parenthesisByClose: Map<number, number>): SlangScopeKind {
  const header = tokens.slice(previousBoundary(tokens, openIndex) + 1, openIndex);
  if (header.some((token) => ["interface", "struct", "class", "extension"].includes(token.text))) {
    return "type";
  }
  const openParenthesisIndex = tokens[openIndex - 1]?.text === ")" ? parenthesisByClose.get(openIndex - 1) : undefined;
  const nameToken = openParenthesisIndex === undefined ? undefined : callableNameBefore(tokens, openParenthesisIndex);
  return nameToken && !new Set(["if", "switch", "for", "while"]).has(nameToken.text) ? "callable" : "block";
}

function callableNameBefore(tokens: SlangToken[], openParenthesisIndex: number): SlangToken | undefined {
  const previous = tokens[openParenthesisIndex - 1];
  if (previous?.kind === "identifier") {
    return previous;
  }
  if (previous?.text !== ">") {
    return undefined;
  }
  let depth = 1;
  for (let index = openParenthesisIndex - 2; index >= 0; index -= 1) {
    if (tokens[index].text === ">") {
      depth += 1;
    } else if (tokens[index].text === "<" && --depth === 0) {
      return tokens[index - 1]?.kind === "identifier" ? tokens[index - 1] : undefined;
    }
  }
  return undefined;
}

function previousBoundary(tokens: SlangToken[], index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if ([";", "{", "}"].includes(tokens[cursor].text)) {
      return cursor;
    }
  }
  return -1;
}

function findParentScope(scopes: Map<string, SlangScopeNode>, offset: number, document: SlangTokenDocument, tokens: SlangToken[]): SlangScopeNode {
  let parent = scopes.values().next().value as SlangScopeNode;
  for (const scope of scopes.values()) {
    const startOffset = offsetForPosition(document, scope.range.start, tokens);
    const endOffset = offsetForPosition(document, scope.range.end, tokens);
    if (startOffset < offset && offset < endOffset && startOffset >= offsetForPosition(document, parent.range.start, tokens)) {
      parent = scope;
    }
  }
  return parent;
}

export function findOwningType(types: Map<string, SlangTypeNode>, offset: number, document: SlangTokenDocument, tokens: SlangToken[]): SlangTypeNode | undefined {
  let owner: SlangTypeNode | undefined;
  for (const type of types.values()) {
    if (offsetForPosition(document, type.bodyRange.start, tokens) < offset && offset < offsetForPosition(document, type.bodyRange.end, tokens)) {
      owner = type;
    }
  }
  return owner;
}

export function ownerDisplayName(owner: SlangTypeNode): string {
  return owner.kind === "extension" && owner.genericParameters.length > 0
    ? `${owner.name}<${owner.genericParameters.join(", ")}>`
    : owner.name;
}

export function innermostScope(scopes: Map<string, SlangScopeNode>, offset: number, document: SlangTokenDocument, tokens: SlangToken[]): SlangScopeNode {
  let result = scopes.get(moduleScopeId(document))!;
  for (const scope of scopes.values()) {
    const start = offsetForPosition(document, scope.range.start, tokens);
    const end = offsetForPosition(document, scope.range.end, tokens);
    if (start < offset && offset < end && start >= offsetForPosition(document, result.range.start, tokens)) {
      result = scope;
    }
  }
  return result;
}
