import type { DebugDiagnostic } from "@shader-studio/types";
import type { SlangDelimiterKind, SlangTypeKind } from "./model";
import type { SlangToken } from "./tokens";
import type { DelimiterPair } from "./SlangStructuralScopes";

const openingDelimiterKinds = new Map<string, SlangDelimiterKind>([
  ["(", "parenthesis"],
  ["[", "bracket"],
  ["{", "brace"],
]);
const closingDelimiterText = new Map<string, string>([
  [")", "("],
  ["]", "["],
  ["}", "{"],
]);
const controlFlowKeywords = new Set(["if", "switch", "for", "while"]);
const typeKeywords = new Set<SlangTypeKind>(["interface", "struct", "class", "extension"]);

export function matchBalancedDelimiters(tokens: SlangToken[]): {
  pairs: DelimiterPair[];
  diagnostics: DebugDiagnostic[];
} {
  const stack: Array<{ text: string; index: number; kind: SlangDelimiterKind }> = [];
  const pairs: DelimiterPair[] = [];
  const diagnostics: DebugDiagnostic[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const kind = openingDelimiterKinds.get(token.text);
    if (kind) {
      stack.push({ text: token.text, index, kind });
      continue;
    }
    const expectedOpen = closingDelimiterText.get(token.text);
    if (!expectedOpen) {
      continue;
    }
    const open = stack[stack.length - 1];
    if (open?.text === expectedOpen) {
      stack.pop();
      pairs.push({ kind: open.kind, openIndex: open.index, closeIndex: index });
    } else {
      diagnostics.push(unmatchedDelimiterDiagnostic(token, `Unmatched closing '${token.text}' delimiter.`));
    }
  }
  for (const open of stack) {
    const token = tokens[open.index];
    diagnostics.push(unmatchedDelimiterDiagnostic(token, `Unmatched opening '${token.text}' delimiter.`));
  }
  return { pairs, diagnostics };
}

function unmatchedDelimiterDiagnostic(token: SlangToken, message: string): DebugDiagnostic {
  return {
    code: "slang-debug-unsupported-syntax",
    message,
    sourceUri: token.sourceUri,
    range: token.range,
  };
}

export function matchGenericDelimiters(tokens: SlangToken[]): {
  pairs: DelimiterPair[];
  diagnostics: DebugDiagnostic[];
} {
  const candidates: DelimiterPair[] = [];
  const diagnostics: DebugDiagnostic[] = [];
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text === "<" && isPlausibleGenericOpen(tokens, index)) {
      stack.push(index);
      continue;
    }
    if (["{", ";", "="].includes(tokens[index].text) && stack.length > 0) {
      appendUnmatchedGenericDiagnostics(tokens, stack.splice(0), diagnostics);
      continue;
    }
    if (tokens[index].text !== ">" || stack.length === 0) {
      continue;
    }
    const openIndex = stack.pop()!;
    candidates.push({ kind: "generic", openIndex, closeIndex: index });
  }
  appendUnmatchedGenericDiagnostics(tokens, stack, diagnostics);
  const pairs = candidates.filter((pair) => isGenericPairContext(tokens, pair));
  return { pairs, diagnostics };
}

function appendUnmatchedGenericDiagnostics(
  tokens: SlangToken[],
  openIndices: number[],
  diagnostics: DebugDiagnostic[],
): void {
  for (const openIndex of openIndices) {
    if (isConfidentDeclarationGenericOpen(tokens, openIndex)) {
      diagnostics.push({
        code: "slang-debug-unsupported-syntax",
        message: "Unmatched generic '<' delimiter.",
        sourceUri: tokens[openIndex].sourceUri,
        range: tokens[openIndex].range,
      });
    }
  }
}

function isPlausibleGenericOpen(tokens: SlangToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  return (previous?.kind === "identifier" || previous?.text === ">")
    && (next?.kind === "identifier" || next?.text === "[");
}

function isGenericPairContext(tokens: SlangToken[], pair: DelimiterPair): boolean {
  const beforeName = tokens[pair.openIndex - 2];
  if (typeKeywords.has(beforeName?.text as SlangTypeKind)) {
    return true;
  }
  if (["=", "+", "-", "/", "%", "!", "&&", "||", "return"].includes(beforeName?.text ?? "")) {
    return false;
  }
  if (beforeName?.text === "(" && controlFlowKeywords.has(tokens[pair.openIndex - 3]?.text ?? "")) {
    return false;
  }
  const next = tokens[pair.closeIndex + 1];
  if (!next) {
    return true;
  }
  if (["(", "{", ":", ",", ">", "[", "]", "."].includes(next.text)) {
    return true;
  }
  const afterName = tokens[pair.closeIndex + 2];
  return next.kind === "identifier"
    && afterName !== undefined
    && ["=", ",", ")", ";", "[", "("].includes(afterName.text)
    && isPlausibleTypeIdentifier(tokens[pair.openIndex - 1].text);
}

export function isPlausibleTypeIdentifier(text: string): boolean {
  return text.length > 1 || text[0] === text[0]?.toUpperCase();
}

function isConfidentDeclarationGenericOpen(tokens: SlangToken[], openIndex: number): boolean {
  if (typeKeywords.has(tokens[openIndex - 2]?.text as SlangTypeKind)) {
    return true;
  }
  let identifiersAfter = 0;
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    if ([";", "{", "}"].includes(tokens[index].text)) {
      return identifiersAfter >= 2;
    }
    if (tokens[index].text === "(") {
      return identifiersAfter >= 1;
    }
    if (tokens[index].kind === "identifier") {
      identifiersAfter += 1;
    }
  }
  return false;
}
