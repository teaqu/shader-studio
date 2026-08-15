import type {
  DebugDiagnostic,
  DebugSourcePosition,
  DebugSourceRange,
} from "@shader-studio/types";
import { tokenizeSlang } from "./SlangTokenizer";
import type { SlangToken, SlangTokenDocument } from "./tokens";

export interface SlangMacroDefinition {
  name: string;
  functionLike: boolean;
  parameters: string[];
  bodyTokens: SlangToken[];
  definitionRange: DebugSourceRange;
}

export interface SlangMacroInvocation {
  name: string;
  invocationRange: DebugSourceRange;
  argumentTokens: SlangToken[][];
  writableOrigin: boolean;
}

export interface SlangPreprocessorModel {
  activeTokens: SlangToken[];
  inactiveRanges: DebugSourceRange[];
  macros: Map<string, SlangMacroDefinition>;
  invocations: SlangMacroInvocation[];
  diagnostics: DebugDiagnostic[];
}

interface ConditionalFrame {
  parentActive: boolean;
  currentActive: boolean;
  branchTaken: boolean;
  sawElse: boolean;
  openingToken: SlangToken;
}

interface ParsedInvocation {
  name: string;
  invocationRange: DebugSourceRange;
  argumentTokens: SlangToken[][];
}

export function buildSlangPreprocessorModel(document: SlangTokenDocument): SlangPreprocessorModel {
  const activeTokens: SlangToken[] = [];
  const inactiveRanges: DebugSourceRange[] = [];
  const macros = new Map<string, SlangMacroDefinition>();
  const diagnostics = [...document.diagnostics];
  const frames: ConditionalFrame[] = [];
  let inactiveStart: DebugSourcePosition | null = null;

  const isActive = (): boolean => frames.every((frame) => frame.currentActive);
  const closeInactiveRange = (end: DebugSourcePosition): void => {
    if (inactiveStart) {
      inactiveRanges.push({ start: inactiveStart, end: { ...end } });
      inactiveStart = null;
    }
  };

  for (const token of document.tokens) {
    if (token.kind !== "preprocessor") {
      if (isActive()) {
        activeTokens.push(token);
      }
      continue;
    }

    closeInactiveRange(token.range.start);
    applyDirective(token, document, macros, frames, diagnostics);
    if (!isActive()) {
      inactiveStart = { ...token.range.end };
    }
  }
  closeInactiveRange(positionAt(document.source, document.source.length));
  for (const frame of frames) {
    diagnostics.push(unsupportedDirectiveDiagnostic(
      frame.openingToken,
      `Unclosed #${directiveName(frame.openingToken)} directive.`,
    ));
  }

  const invocations = findMacroInvocations(activeTokens, macros).map((invocation) => ({
    ...invocation,
    writableOrigin: true,
  }));
  for (const invocation of [...invocations]) {
    appendExpansionOnlyInvocations(invocation, macros, invocations, new Set([invocation.name]));
  }

  return { activeTokens, inactiveRanges, macros, invocations, diagnostics };
}

function applyDirective(
  token: SlangToken,
  document: SlangTokenDocument,
  macros: Map<string, SlangMacroDefinition>,
  frames: ConditionalFrame[],
  diagnostics: DebugDiagnostic[],
): void {
  const logicalDirective = token.text.replace(/\\(?:\r\n|\r|\n)/g, "");
  const match = /^#\s*([A-Za-z]+)/.exec(logicalDirective);
  if (!match) {
    diagnostics.push(unsupportedDirectiveDiagnostic(token, "Malformed preprocessor directive."));
    return;
  }

  const name = match[1];
  const expression = logicalDirective.slice(match[0].length).trim();
  const active = frames.every((frame) => frame.currentActive);
  if (name === "if") {
    const condition = evaluateCondition(expression, macros);
    if (condition === null) {
      diagnostics.push(unsupportedDirectiveDiagnostic(token, "Unsupported #if condition."));
    }
    frames.push({
      parentActive: active,
      currentActive: active && (condition ?? false),
      branchTaken: condition ?? false,
      sawElse: false,
      openingToken: token,
    });
    return;
  }
  if (name === "ifdef" || name === "ifndef") {
    const isDefined = macros.has(expression);
    frames.push({
      parentActive: active,
      currentActive: active && (name === "ifdef" ? isDefined : !isDefined),
      branchTaken: name === "ifdef" ? isDefined : !isDefined,
      sawElse: false,
      openingToken: token,
    });
    return;
  }
  if (name === "elif") {
    const frame = frames[frames.length - 1];
    if (!frame || frame.sawElse) {
      diagnostics.push(unsupportedDirectiveDiagnostic(token, "Unmatched #elif directive."));
      return;
    }
    const condition = evaluateCondition(expression, macros);
    if (condition === null) {
      diagnostics.push(unsupportedDirectiveDiagnostic(token, "Unsupported #elif condition."));
    }
    const matches = condition ?? false;
    frame.currentActive = frame.parentActive && !frame.branchTaken && matches;
    frame.branchTaken ||= matches;
    return;
  }
  if (name === "else") {
    const frame = frames[frames.length - 1];
    if (!frame || frame.sawElse) {
      diagnostics.push(unsupportedDirectiveDiagnostic(token, "Unmatched #else directive."));
      return;
    }
    frame.sawElse = true;
    frame.currentActive = frame.parentActive && !frame.branchTaken;
    frame.branchTaken = true;
    return;
  }
  if (name === "endif") {
    if (frames.pop() === undefined) {
      diagnostics.push(unsupportedDirectiveDiagnostic(token, "Unmatched #endif directive."));
    }
    return;
  }
  if (name === "define") {
    if (active) {
      const definition = parseMacroDefinition(token, document);
      if (definition) {
        macros.set(definition.name, definition);
      } else {
        diagnostics.push(unsupportedDirectiveDiagnostic(token, "Malformed #define directive."));
      }
    }
    return;
  }
  if (name === "undef") {
    if (active && /^[A-Za-z_][A-Za-z0-9_]*$/.test(expression)) {
      macros.delete(expression);
    } else if (active) {
      diagnostics.push(unsupportedDirectiveDiagnostic(token, "Malformed #undef directive."));
    }
    return;
  }
  if (["include", "import", "pragma", "line"].includes(name)) {
    return;
  }
  diagnostics.push(unsupportedDirectiveDiagnostic(token, `Unsupported #${name} directive.`));
}

function evaluateCondition(expression: string, macros: Map<string, SlangMacroDefinition>): boolean | null {
  const expandedDefined = expression.replace(
    /defined\s*(?:\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)|([A-Za-z_][A-Za-z0-9_]*))/g,
    (_match, parenthesized: string | undefined, bare: string | undefined) => macros.has(parenthesized ?? bare ?? "") ? "1" : "0",
  );
  const tokens = expandedDefined.match(/&&|\|\||==|!=|<=|>=|[()!<>]|0[xX][0-9a-fA-F]+|\d+|[A-Za-z_][A-Za-z0-9_]*/g);
  if (!tokens || tokens.join("").length !== expandedDefined.replace(/\s+/g, "").length) return null;
  const conditionTokens = tokens;
  let cursor = 0;
  const macroValue = (name: string, seen = new Set<string>()): number | null => {
    if (seen.has(name)) return null;
    const macro = macros.get(name);
    if (!macro || macro.functionLike) return 0;
    const body = macro.bodyTokens.map((token) => token.text).join("").trim();
    if (!body) return 1;
    const numeric = Number(body);
    if (Number.isFinite(numeric)) return numeric;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(body)) return macroValue(body, new Set([...seen, name]));
    return null;
  };
  const primary = (): number | null => {
    const token = tokens[cursor++];
    if (token === "(") {
      const value = orExpression();
      if (tokens[cursor++] !== ")") return null;
      return value;
    }
    if (token === "!") {
      const value = primary();
      return value === null ? null : Number(!value);
    }
    if (/^0[xX]/.test(token ?? "")) return Number.parseInt(token, 16);
    if (/^\d+$/.test(token ?? "")) return Number(token);
    return token && /^[A-Za-z_]/.test(token) ? macroValue(token) : null;
  };
  const comparison = (): number | null => {
    let left = primary();
    while (["==", "!=", "<", ">", "<=", ">="].includes(tokens[cursor])) {
      const operator = tokens[cursor++];
      const right = primary();
      if (left === null || right === null) return null;
      if (operator === "==") left = Number(left === right);
      else if (operator === "!=") left = Number(left !== right);
      else if (operator === "<") left = Number(left < right);
      else if (operator === ">") left = Number(left > right);
      else if (operator === "<=") left = Number(left <= right);
      else left = Number(left >= right);
    }
    return left;
  };
  const andExpression = (): number | null => {
    let left = comparison();
    while (tokens[cursor] === "&&") {
      cursor += 1;
      const right = comparison();
      if (left === null || right === null) return null;
      left = Number(Boolean(left) && Boolean(right));
    }
    return left;
  };
  function orExpression(): number | null {
    let left = andExpression();
    while (conditionTokens[cursor] === "||") {
      cursor += 1;
      const right = andExpression();
      if (left === null || right === null) return null;
      left = Number(Boolean(left) || Boolean(right));
    }
    return left;
  }
  const value = orExpression();
  return value !== null && cursor === tokens.length ? Boolean(value) : null;
}

function parseMacroDefinition(token: SlangToken, document: SlangTokenDocument): SlangMacroDefinition | null {
  const header = /^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?:(\()([^)]*)\))?/.exec(token.text);
  if (!header) {
    return null;
  }
  const bodyStart = token.startOffset + header[0].length + leadingWhitespaceLength(token.text.slice(header[0].length));
  const bodyTokens = tokenizeFragment(document, bodyStart, token.endOffset);
  return {
    name: header[1],
    functionLike: header[2] === "(",
    parameters: header[3] === undefined || header[3].trim() === ""
      ? []
      : header[3].split(",").map((parameter) => parameter.trim()),
    bodyTokens,
    definitionRange: token.range,
  };
}

function tokenizeFragment(document: SlangTokenDocument, startOffset: number, endOffset: number): SlangToken[] {
  const source = document.source.slice(startOffset, endOffset);
  return tokenizeSlang(document.sourceUri, source).tokens.map((token) => {
    const start = startOffset + token.startOffset;
    const end = startOffset + token.endOffset;
    return {
      ...token,
      startOffset: start,
      endOffset: end,
      range: rangeAt(document.source, start, end),
    };
  });
}

function findMacroInvocations(
  tokens: SlangToken[],
  macros: Map<string, SlangMacroDefinition>,
): ParsedInvocation[] {
  const invocations: ParsedInvocation[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "identifier" || !macros.has(token.text)) {
      continue;
    }
    const parsed = parseInvocation(tokens, index, macros.get(token.text)!);
    if (parsed) {
      invocations.push(parsed);
    }
  }
  return invocations;
}

function parseInvocation(
  tokens: SlangToken[],
  identifierIndex: number,
  definition: SlangMacroDefinition,
): ParsedInvocation | null {
  const identifier = tokens[identifierIndex];
  const openIndex = nextMeaningfulToken(tokens, identifierIndex + 1);
  if (openIndex === undefined || tokens[openIndex].text !== "(") {
    if (definition.functionLike) {
      return null;
    }
    return {
      name: identifier.text,
      invocationRange: identifier.range,
      argumentTokens: [],
    };
  }

  const argumentsList: SlangToken[][] = [];
  let argument: SlangToken[] = [];
  let depth = 0;
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.text === "(") {
      depth += 1;
      argument.push(token);
      continue;
    }
    if (token.text === ")") {
      if (depth === 0) {
        if (argument.length > 0) {
          argumentsList.push(argument);
        }
        return {
          name: identifier.text,
          invocationRange: { start: identifier.range.start, end: token.range.end },
          argumentTokens: argumentsList,
        };
      }
      depth -= 1;
      argument.push(token);
      continue;
    }
    if (token.text === "," && depth === 0) {
      argumentsList.push(argument);
      argument = [];
      continue;
    }
    argument.push(token);
  }
  return null;
}

function appendExpansionOnlyInvocations(
  invocation: SlangMacroInvocation,
  macros: Map<string, SlangMacroDefinition>,
  invocations: SlangMacroInvocation[],
  expansionPath: Set<string>,
): void {
  const definition = macros.get(invocation.name);
  if (!definition) {
    return;
  }
  for (const expandedInvocation of findMacroInvocations(definition.bodyTokens, macros)) {
    const expansionOnly: SlangMacroInvocation = {
      ...expandedInvocation,
      invocationRange: invocation.invocationRange,
      writableOrigin: false,
    };
    invocations.push(expansionOnly);
    if (!expansionPath.has(expansionOnly.name)) {
      const nextPath = new Set(expansionPath);
      nextPath.add(expansionOnly.name);
      appendExpansionOnlyInvocations(expansionOnly, macros, invocations, nextPath);
    }
  }
}

function nextMeaningfulToken(tokens: SlangToken[], startIndex: number): number | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].kind !== "whitespace" && tokens[index].kind !== "comment") {
      return index;
    }
  }
  return undefined;
}

function leadingWhitespaceLength(text: string): number {
  const match = /^[ \t]*/.exec(text);
  return match?.[0].length ?? 0;
}

function unsupportedDirectiveDiagnostic(token: SlangToken, message: string): DebugDiagnostic {
  return {
    code: "slang-debug-unsupported-syntax",
    message,
    sourceUri: token.sourceUri,
    range: token.range,
  };
}

function directiveName(token: SlangToken): string {
  return /^#\s*([A-Za-z]+)/.exec(token.text)?.[1] ?? "directive";
}

function rangeAt(source: string, startOffset: number, endOffset: number): DebugSourceRange {
  return {
    start: positionAt(source, startOffset),
    end: positionAt(source, endOffset),
  };
}

function positionAt(source: string, targetOffset: number): DebugSourcePosition {
  let line = 0;
  let character = 0;
  for (let offset = 0; offset < targetOffset; offset += 1) {
    if (source[offset] === "\r" && source[offset + 1] === "\n") {
      offset += 1;
      line += 1;
      character = 0;
    } else if (source[offset] === "\r" || source[offset] === "\n") {
      line += 1;
      character = 0;
    } else {
      character += 1;
    }
  }
  return { line, character };
}
