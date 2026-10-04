import type { SlangControlFlowKind, SlangControlFlowNode, SlangScopeNode } from "./model";
import type { SlangToken, SlangTokenDocument } from "./tokens";
import { innermostScope, type DelimiterPair } from "./SlangStructuralScopes";
import { findNextToken, stableId } from "./SlangStructuralParserTokens";

const controlFlowKeywords = new Set(["if", "switch", "for", "while"]);

export function parseControlFlows(document: SlangTokenDocument, tokens: SlangToken[], pairsByOpen: Map<number, DelimiterPair>, scopes: Map<string, SlangScopeNode>): Map<string, SlangControlFlowNode> {
  const controls = new Map<string, SlangControlFlowNode>();
  const doWhileTrailers = collectDoWhileTrailerIndices(tokens, pairsByOpen);
  for (let index = 0; index < tokens.length; index += 1) {
    if (doWhileTrailers.has(index)) {
      continue;
    }
    const kind = controlKindAt(tokens, index);
    const endIndex = kind ? controlledStatementEndIndex(tokens, index, pairsByOpen) : undefined;
    if (!kind || endIndex === undefined) {
      continue;
    }
    const scope = innermostScope(scopes, tokens[index].startOffset, document, tokens);
    const id = stableId("control-flow", tokens[index]);
    controls.set(id, { id, kind, sourceUri: document.sourceUri, range: { start: tokens[index].range.start, end: tokens[endIndex].range.end }, scopeId: scope.id });
  }
  return controls;
}

export function controlledStatementEndIndex(tokens: SlangToken[], startIndex: number, pairsByOpen: Map<number, DelimiterPair>): number | undefined {
  if (tokens[startIndex]?.text === "{") {
    return pairsByOpen.get(startIndex)?.kind === "brace" ? pairsByOpen.get(startIndex)?.closeIndex : undefined;
  }
  const kind = controlKindAt(tokens, startIndex);
  if (!kind) {
    return findNextToken(tokens, startIndex, ";");
  }
  const bodyStartIndex = controlBodyStartIndex(tokens, startIndex, kind, pairsByOpen);
  const bodyEndIndex = bodyStartIndex === undefined ? undefined : controlledStatementEndIndex(tokens, bodyStartIndex, pairsByOpen);
  if (bodyEndIndex === undefined) {
    return undefined;
  }
  if (kind === "if" && tokens[bodyEndIndex + 1]?.text === "else") {
    return controlledStatementEndIndex(tokens, bodyEndIndex + 2, pairsByOpen);
  }
  if (kind !== "do") {
    return bodyEndIndex;
  }
  const whileIndex = bodyEndIndex + 1;
  const conditionPair = tokens[whileIndex]?.text === "while" && tokens[whileIndex + 1]?.text === "(" ? pairsByOpen.get(whileIndex + 1) : undefined;
  const terminatorIndex = conditionPair?.kind === "parenthesis" ? conditionPair.closeIndex + 1 : undefined;
  return tokens[terminatorIndex ?? -1]?.text === ";" ? terminatorIndex : undefined;
}

export function controlKindAt(tokens: SlangToken[], index: number): SlangControlFlowKind | undefined {
  return controlFlowKeywords.has(tokens[index]?.text) ? tokens[index].text as SlangControlFlowKind : tokens[index]?.text === "do" ? "do" : undefined;
}
export function controlBodyStartIndex(tokens: SlangToken[], controlIndex: number, kind: SlangControlFlowKind, pairsByOpen: Map<number, DelimiterPair>): number | undefined {
  if (kind === "do") {
    return controlIndex + 1;
  }
  const pair = tokens[controlIndex + 1]?.text === "(" ? pairsByOpen.get(controlIndex + 1) : undefined;
  return pair?.kind === "parenthesis" ? pair.closeIndex + 1 : undefined;
}
export function collectDoWhileTrailerIndices(tokens: SlangToken[], pairsByOpen: Map<number, DelimiterPair>): Set<number> {
  const trailers = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "do") {
      continue;
    }
    const bodyEndIndex = controlledStatementEndIndex(tokens, index + 1, pairsByOpen);
    if (bodyEndIndex !== undefined && tokens[bodyEndIndex + 1]?.text === "while") {
      trailers.add(bodyEndIndex + 1);
    }
  }
  return trailers;
}
