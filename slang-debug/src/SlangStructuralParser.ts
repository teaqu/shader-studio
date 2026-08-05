import type { DebugDiagnostic, DebugOrigin, DebugSourceRange } from "@shader-studio/types";
import type { SlangPreprocessorModel } from "./SlangPreprocessor";
import type {
  SlangCallableNode,
  SlangControlFlowKind,
  SlangControlFlowNode,
  SlangDeclarationNode,
  SlangDelimiterKind,
  SlangDelimiterNode,
  SlangScopeKind,
  SlangScopeNode,
  SlangStatementKind,
  SlangStatementNode,
  SlangStructuralDocument,
  SlangTypeKind,
  SlangTypeNode,
} from "./model";
import type { SlangToken, SlangTokenDocument } from "./tokens";

interface DelimiterPair {
  kind: SlangDelimiterKind;
  openIndex: number;
  closeIndex: number;
}

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
const declarationModifiers = new Set([
  "const", "extern", "inline", "internal", "mutating", "nointerpolation", "override", "private",
  "public", "static", "uniform", "virtual",
]);
const parameterAccess = new Map<string, SlangDeclarationNode["access"]>([
  ["in", "read"],
  ["out", "write"],
  ["inout", "readwrite"],
]);

export function parseSlangStructure(
  document: SlangTokenDocument,
  preprocessor: SlangPreprocessorModel,
): SlangStructuralDocument {
  const tokens = preprocessor.activeTokens.filter((token) => token.kind !== "whitespace" && token.kind !== "comment");
  const delimiterResult = matchBalancedDelimiters(tokens);
  const pairs = delimiterResult.pairs;
  pairs.push(...matchGenericDelimiters(tokens));
  pairs.sort((left, right) => tokens[left.openIndex].startOffset - tokens[right.openIndex].startOffset);
  const pairsByOpen = new Map(pairs.map((pair) => [pair.openIndex, pair]));
  const pairsByClose = new Map(pairs.map((pair) => [pair.closeIndex, pair]));

  const delimiters = new Map<string, SlangDelimiterNode>();
  for (const pair of pairs) {
    const openToken = tokens[pair.openIndex];
    const closeToken = tokens[pair.closeIndex];
    const id = stableId("delimiter", openToken);
    delimiters.set(id, {
      id,
      kind: pair.kind,
      range: { start: openToken.range.start, end: closeToken.range.end },
      openToken,
      closeToken,
    });
  }

  const scopes = buildScopes(document, tokens, pairs);
  const { moduleName, imports } = parseModuleHeader(tokens);
  const types = parseTypes(document, tokens, pairsByOpen);
  const { callables, declarations: parameterDeclarations, signatureSemicolons } = parseCallables(
    document,
    tokens,
    pairsByOpen,
    pairsByClose,
    types,
    scopes,
  );
  const { declarations, statements } = parseStatementsAndDeclarations(
    document,
    tokens,
    pairs,
    scopes,
    signatureSemicolons,
  );
  appendForInitializerDeclarations(document, tokens, pairsByOpen, scopes, declarations, statements);
  for (const declaration of parameterDeclarations.values()) {
    declarations.set(declaration.id, declaration);
  }
  const diagnostics = [...preprocessor.diagnostics, ...delimiterResult.diagnostics];
  appendMacroDeclarations(document, preprocessor, tokens, scopes, declarations, statements, diagnostics);
  const controlFlows = parseControlFlows(document, tokens, pairsByOpen, scopes);
  return {
    sourceUri: document.sourceUri,
    moduleName,
    imports,
    delimiters,
    scopes,
    types,
    callables,
    declarations,
    statements,
    controlFlows,
    diagnostics,
  };
}

function parseModuleHeader(tokens: SlangToken[]): { moduleName: string | null; imports: string[] } {
  let moduleName: string | null = null;
  const imports: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "module" && tokens[index].text !== "import") {
      continue;
    }
    const end = findNextToken(tokens, index + 1, ";");
    if (end === undefined) {
      continue;
    }
    const name = tokens.slice(index + 1, end).map((token) => token.text).join("");
    if (tokens[index].text === "module") {
      moduleName = name;
    } else {
      imports.push(name);
    }
    index = end;
  }
  return { moduleName, imports };
}

function parseTypes(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairsByOpen: Map<number, DelimiterPair>,
): Map<string, SlangTypeNode> {
  const types = new Map<string, SlangTypeNode>();
  for (let index = 0; index < tokens.length; index += 1) {
    const kind = typeKeywords.has(tokens[index].text as SlangTypeKind)
      ? tokens[index].text as SlangTypeKind
      : undefined;
    if (!kind || tokens[index + 1]?.kind !== "identifier") {
      continue;
    }
    const nameIndex = index + 1;
    let headerIndex = nameIndex + 1;
    let genericPair: DelimiterPair | undefined;
    if (tokens[headerIndex]?.text === "<") {
      genericPair = pairsByOpen.get(headerIndex);
      if (genericPair?.kind === "generic") {
        headerIndex = genericPair.closeIndex + 1;
      }
    }
    const bodyOpenIndex = findNextToken(tokens, headerIndex, "{", ";");
    if (bodyOpenIndex === undefined || tokens[bodyOpenIndex].text !== "{") {
      continue;
    }
    const bodyPair = pairsByOpen.get(bodyOpenIndex);
    if (bodyPair?.kind !== "brace") {
      continue;
    }
    const nameToken = tokens[nameIndex];
    const bodyOpen = tokens[bodyOpenIndex];
    const bodyClose = tokens[bodyPair.closeIndex];
    const genericParameters = genericPair
      ? splitTokenText(document, tokens, genericPair.openIndex + 1, genericPair.closeIndex)
      : [];
    const conformances = tokens[headerIndex]?.text === ":"
      ? splitTokenText(document, tokens, headerIndex + 1, bodyOpenIndex)
      : [];
    const id = stableId("type", nameToken);
    types.set(id, {
      id,
      kind,
      name: nameToken.text,
      genericParameters,
      conformances,
      range: { start: tokens[index].range.start, end: bodyClose.range.end },
      bodyRange: { start: bodyOpen.range.start, end: bodyClose.range.end },
      nameToken,
      scopeId: stableId("scope", bodyOpen),
      attributes: [],
      modifiers: [],
    });
    index = bodyOpenIndex;
  }
  return types;
}

function parseCallables(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairsByOpen: Map<number, DelimiterPair>,
  pairsByClose: Map<number, DelimiterPair>,
  types: Map<string, SlangTypeNode>,
  scopes: Map<string, SlangScopeNode>,
): {
  callables: Map<string, SlangCallableNode>;
  declarations: Map<string, SlangDeclarationNode>;
  signatureSemicolons: Set<number>;
} {
  const callables = new Map<string, SlangCallableNode>();
  const declarations = new Map<string, SlangDeclarationNode>();
  const signatureSemicolons = new Set<number>();
  for (const pair of pairsByOpen.values()) {
    if (pair.kind !== "parenthesis") {
      continue;
    }
    const terminator = tokens[pair.closeIndex + 1];
    if (!terminator || (terminator.text !== "{" && terminator.text !== ";")) {
      continue;
    }
    const nameInfo = callableNameInfo(tokens, pair.openIndex, pairsByClose);
    if (!nameInfo || controlFlowKeywords.has(nameInfo.nameToken.text)) {
      continue;
    }
    const boundary = previousBoundary(tokens, nameInfo.nameIndex);
    const prefix = parseDeclarationPrefix(document, tokens, boundary + 1, nameInfo.nameIndex);
    if (prefix.typeStartIndex >= nameInfo.nameIndex || prefix.invalid) {
      continue;
    }
    const returnTypeName = normalizedText(document, tokens, prefix.typeStartIndex, nameInfo.nameIndex);
    if (!returnTypeName || ["return", "module", "import"].includes(returnTypeName)) {
      continue;
    }
    const bodyPair = terminator.text === "{" ? pairsByOpen.get(pair.closeIndex + 1) : undefined;
    if (terminator.text === "{" && bodyPair?.kind !== "brace") {
      continue;
    }
    const owner = findOwningType(types, nameInfo.nameToken.startOffset, document, tokens);
    const kind = owner?.kind === "extension" ? "extension" : owner ? "method" : "free";
    const bodyEnd = bodyPair ? tokens[bodyPair.closeIndex].range.end : terminator.range.end;
    const scopeId = bodyPair ? stableId("scope", terminator) : owner?.scopeId ?? moduleScopeId(document);
    const id = stableId("callable", nameInfo.nameToken);
    const parameters = parseParameters(document, tokens, pair, scopeId);
    for (const parameter of parameters) {
      declarations.set(parameter.id, parameter);
    }
    callables.set(id, {
      id,
      kind,
      name: nameInfo.nameToken.text,
      ownerType: owner ? ownerDisplayName(document, owner) : null,
      returnTypeName,
      genericParameters: nameInfo.genericPair
        ? splitTokenText(document, tokens, nameInfo.genericPair.openIndex + 1, nameInfo.genericPair.closeIndex)
        : [],
      parameters,
      signatureRange: {
        start: tokens[prefix.signatureStartIndex].range.start,
        end: terminator.text === "{" ? terminator.range.start : terminator.range.end,
      },
      bodyRange: { start: terminator.range.start, end: bodyEnd },
      nameToken: nameInfo.nameToken,
      scopeId,
      attributes: prefix.attributes,
      modifiers: prefix.modifiers,
    });
    if (terminator.text === ";") {
      signatureSemicolons.add(pair.closeIndex + 1);
    }
  }
  return { callables, declarations, signatureSemicolons };
}

function callableNameInfo(
  tokens: SlangToken[],
  openParenthesisIndex: number,
  pairsByClose: Map<number, DelimiterPair>,
): { nameToken: SlangToken; nameIndex: number; genericPair?: DelimiterPair } | undefined {
  const previousIndex = openParenthesisIndex - 1;
  if (tokens[previousIndex]?.kind === "identifier") {
    return { nameToken: tokens[previousIndex], nameIndex: previousIndex };
  }
  const genericPair = pairsByClose.get(previousIndex);
  if (genericPair?.kind !== "generic" || tokens[genericPair.openIndex - 1]?.kind !== "identifier") {
    return undefined;
  }
  const nameIndex = genericPair.openIndex - 1;
  return { nameToken: tokens[nameIndex], nameIndex, genericPair };
}

function parseDeclarationPrefix(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  startIndex: number,
  nameIndex: number,
): {
  signatureStartIndex: number;
  typeStartIndex: number;
  attributes: string[];
  modifiers: string[];
  invalid: boolean;
} {
  const attributes: string[] = [];
  const modifiers: string[] = [];
  let cursor = startIndex;
  const signatureStartIndex = cursor;
  while (tokens[cursor]?.text === "[") {
    const close = findMatchingText(tokens, cursor, "[", "]");
    if (close === undefined || close >= nameIndex) {
      return { signatureStartIndex, typeStartIndex: nameIndex, attributes, modifiers, invalid: true };
    }
    attributes.push(normalizedText(document, tokens, cursor + 1, close));
    cursor = close + 1;
  }
  while (cursor < nameIndex && declarationModifiers.has(tokens[cursor].text)) {
    modifiers.push(tokens[cursor].text);
    cursor += 1;
  }
  const invalid = tokens.slice(cursor, nameIndex).some((token) => token.kind === "operator" && !["*", "&"].includes(token.text));
  return { signatureStartIndex, typeStartIndex: cursor, attributes, modifiers, invalid };
}

function parseParameters(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pair: DelimiterPair,
  scopeId: string,
): SlangDeclarationNode[] {
  return splitTopLevelSegments(tokens, pair.openIndex + 1, pair.closeIndex, ",")
    .map(([start, end]) => parseParameter(document, tokens, start, end, scopeId))
    .filter((parameter): parameter is SlangDeclarationNode => parameter !== undefined);
}

function parseParameter(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  startIndex: number,
  endIndex: number,
  scopeId: string,
): SlangDeclarationNode | undefined {
  if (startIndex >= endIndex) {
    return undefined;
  }
  const statementStart = startIndex;
  let cursor = startIndex;
  let access: SlangDeclarationNode["access"] = "read";
  if (parameterAccess.has(tokens[cursor].text)) {
    access = parameterAccess.get(tokens[cursor].text)!;
    cursor += 1;
  }
  while (cursor < endIndex && declarationModifiers.has(tokens[cursor].text)) {
    cursor += 1;
  }
  const equalsIndex = findTokenInRange(tokens, cursor, endIndex, "=") ?? endIndex;
  const nameIndex = findLastIdentifier(tokens, cursor, equalsIndex);
  if (nameIndex === undefined || nameIndex <= cursor) {
    return undefined;
  }
  return directDeclaration(
    document,
    tokens[nameIndex],
    normalizedText(document, tokens, cursor, nameIndex),
    { start: tokens[statementStart].range.start, end: tokens[nameIndex].range.end },
    scopeId,
    access,
  );
}

function parseStatementsAndDeclarations(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairs: DelimiterPair[],
  scopes: Map<string, SlangScopeNode>,
  signatureSemicolons: Set<number>,
): { declarations: Map<string, SlangDeclarationNode>; statements: Map<string, SlangStatementNode> } {
  const declarations = new Map<string, SlangDeclarationNode>();
  const statements = new Map<string, SlangStatementNode>();
  const parenthesisRanges = pairs.filter((pair) => pair.kind === "parenthesis");
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== ";" || signatureSemicolons.has(index)) {
      continue;
    }
    if (parenthesisRanges.some((pair) => pair.openIndex < index && index < pair.closeIndex)) {
      continue;
    }
    const start = previousStatementBoundary(tokens, index) + 1;
    if (start >= index || ["module", "import"].includes(tokens[start].text)) {
      continue;
    }
    const scope = innermostScope(scopes, tokens[start].startOffset, document, tokens);
    const range = { start: tokens[start].range.start, end: tokens[index].range.end };
    const keywordKind = statementKind(tokens[start].text);
    if (keywordKind) {
      const statement = createStatement(tokens[start], keywordKind, range, scope.id);
      statements.set(statement.id, statement);
      continue;
    }
    const declaration = parseDirectStatementDeclaration(document, tokens, start, index, scope.id, range);
    if (declaration) {
      declarations.set(declaration.id, declaration);
      const statement = createStatement(tokens[start], "declaration", range, scope.id);
      statements.set(statement.id, statement);
      continue;
    }
    const statement = createStatement(tokens[start], "expression", range, scope.id);
    statements.set(statement.id, statement);
  }
  return { declarations, statements };
}

function parseDirectStatementDeclaration(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  startIndex: number,
  endIndex: number,
  scopeId: string,
  statementRange: DebugSourceRange,
): SlangDeclarationNode | undefined {
  let cursor = startIndex;
  while (cursor < endIndex && declarationModifiers.has(tokens[cursor].text)) {
    cursor += 1;
  }
  const equalsIndex = findTokenInRange(tokens, cursor, endIndex, "=") ?? endIndex;
  const nameIndex = findLastIdentifier(tokens, cursor, equalsIndex);
  if (nameIndex === undefined || nameIndex <= cursor) {
    return undefined;
  }
  if (tokens.slice(cursor, nameIndex).some((token) => ["(", ")", "="].includes(token.text))) {
    return undefined;
  }
  const typeName = normalizedText(document, tokens, cursor, nameIndex);
  if (!typeName || ["return", "break", "continue", "discard"].includes(typeName)) {
    return undefined;
  }
  return directDeclaration(document, tokens[nameIndex], typeName, statementRange, scopeId, "readwrite");
}

function appendForInitializerDeclarations(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairsByOpen: Map<number, DelimiterPair>,
  scopes: Map<string, SlangScopeNode>,
  declarations: Map<string, SlangDeclarationNode>,
  statements: Map<string, SlangStatementNode>,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "for" || tokens[index + 1]?.text !== "(") {
      continue;
    }
    const conditionPair = pairsByOpen.get(index + 1);
    if (conditionPair?.kind !== "parenthesis") {
      continue;
    }
    const semicolonIndex = findTokenInRange(tokens, conditionPair.openIndex + 1, conditionPair.closeIndex, ";");
    if (semicolonIndex === undefined || semicolonIndex === conditionPair.openIndex + 1) {
      continue;
    }
    const startIndex = conditionPair.openIndex + 1;
    const scope = innermostScope(scopes, tokens[index].startOffset, document, tokens);
    const range = { start: tokens[startIndex].range.start, end: tokens[semicolonIndex].range.end };
    const declaration = parseDirectStatementDeclaration(
      document,
      tokens,
      startIndex,
      semicolonIndex,
      scope.id,
      range,
    );
    if (!declaration) {
      continue;
    }
    declarations.set(declaration.id, declaration);
    const statement = createStatement(tokens[startIndex], "declaration", range, scope.id);
    statements.set(statement.id, statement);
  }
}

function appendMacroDeclarations(
  document: SlangTokenDocument,
  preprocessor: SlangPreprocessorModel,
  tokens: SlangToken[],
  scopes: Map<string, SlangScopeNode>,
  declarations: Map<string, SlangDeclarationNode>,
  statements: Map<string, SlangStatementNode>,
  diagnostics: DebugDiagnostic[],
): void {
  for (const invocation of preprocessor.invocations) {
    if (!invocation.writableOrigin) {
      diagnostics.push({
        code: "slang-debug-no-writable-origin",
        message: `Macro expansion for ${invocation.name} has no writable declaration origin.`,
        sourceUri: document.sourceUri,
        range: invocation.invocationRange,
      });
      continue;
    }
    const definition = preprocessor.macros.get(invocation.name);
    const body = definition?.bodyTokens.filter((token) => token.kind !== "whitespace" && token.kind !== "comment") ?? [];
    if (!definition || body.length < 2 || invocation.argumentTokens.length !== 1) {
      continue;
    }
    const nameParameterIndex = definition.parameters.indexOf(body[body.length - 1].text);
    const argument = invocation.argumentTokens[nameParameterIndex]?.filter((token) => token.kind !== "whitespace" && token.kind !== "comment");
    if (nameParameterIndex < 0 || argument?.length !== 1 || argument[0].kind !== "identifier") {
      continue;
    }
    const nameToken = argument[0];
    const typeName = body.slice(0, -1).map((token) => token.text).join("");
    if (!typeName) {
      continue;
    }
    const semicolon = tokens.find((token) => token.text === ";" && token.startOffset >= rangeEndOffset(document, invocation.invocationRange));
    const statementRange = {
      start: invocation.invocationRange.start,
      end: semicolon?.range.end ?? invocation.invocationRange.end,
    };
    const scope = innermostScope(scopes, nameToken.startOffset, document, tokens);
    const origin: DebugOrigin = { kind: "macro-invocation", writableRange: invocation.invocationRange };
    const declaration = createDeclaration(document, nameToken, typeName, statementRange, scope.id, "readwrite", origin);
    declarations.set(declaration.id, declaration);
    const invocationToken = tokens.find((token) => token.startOffset === rangeStartOffset(document, invocation.invocationRange)) ?? nameToken;
    const statement = createStatement(invocationToken, "declaration", statementRange, scope.id);
    statements.set(statement.id, statement);
  }
}

function parseControlFlows(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairsByOpen: Map<number, DelimiterPair>,
  scopes: Map<string, SlangScopeNode>,
): Map<string, SlangControlFlowNode> {
  const controls = new Map<string, SlangControlFlowNode>();
  for (let index = 0; index < tokens.length; index += 1) {
    const kind = controlFlowKeywords.has(tokens[index].text)
      ? tokens[index].text as SlangControlFlowKind
      : tokens[index].text === "do" ? "do" : undefined;
    if (!kind) {
      continue;
    }
    let bodyOpenIndex: number | undefined;
    if (kind === "do") {
      bodyOpenIndex = tokens[index + 1]?.text === "{" ? index + 1 : undefined;
    } else {
      const conditionPair = tokens[index + 1]?.text === "(" ? pairsByOpen.get(index + 1) : undefined;
      bodyOpenIndex = conditionPair && tokens[conditionPair.closeIndex + 1]?.text === "{"
        ? conditionPair.closeIndex + 1
        : undefined;
    }
    const bodyPair = bodyOpenIndex === undefined ? undefined : pairsByOpen.get(bodyOpenIndex);
    if (bodyPair?.kind !== "brace") {
      continue;
    }
    const scope = innermostScope(scopes, tokens[index].startOffset, document, tokens);
    const id = stableId("control-flow", tokens[index]);
    controls.set(id, {
      id,
      kind,
      sourceUri: document.sourceUri,
      range: { start: tokens[index].range.start, end: tokens[bodyPair.closeIndex].range.end },
      scopeId: scope.id,
    });
  }
  return controls;
}

function matchBalancedDelimiters(tokens: SlangToken[]): {
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

function matchGenericDelimiters(tokens: SlangToken[]): DelimiterPair[] {
  const pairs: DelimiterPair[] = [];
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text === "<" && isPlausibleGenericOpen(tokens, index)) {
      stack.push(index);
      continue;
    }
    if (tokens[index].text !== ">" || stack.length === 0) {
      continue;
    }
    const openIndex = stack.pop()!;
    if (stack.length > 0 || isPlausibleGenericClose(tokens[index + 1])) {
      pairs.push({ kind: "generic", openIndex, closeIndex: index });
    }
  }
  return pairs;
}

function isPlausibleGenericOpen(tokens: SlangToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  return (previous?.kind === "identifier" || previous?.text === ">")
    && (next?.kind === "identifier" || next?.text === "[");
}

function isPlausibleGenericClose(next: SlangToken | undefined): boolean {
  return next === undefined
    || next.kind === "identifier"
    || ["(", ")", "[", "]", "{", "}", ":", ",", ";", ".", ">"].includes(next.text);
}

function buildScopes(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairs: DelimiterPair[],
): Map<string, SlangScopeNode> {
  const scopes = new Map<string, SlangScopeNode>();
  const documentEnd = document.tokens[document.tokens.length - 1]?.range.end ?? { line: 0, character: 0 };
  const moduleId = `scope:${document.sourceUri}:0:0`;
  scopes.set(moduleId, {
    id: moduleId,
    kind: "module",
    sourceUri: document.sourceUri,
    range: { start: { line: 0, character: 0 }, end: documentEnd },
    parentId: null,
  });

  const parenthesisByClose = new Map<number, number>();
  for (const pair of pairs) {
    if (pair.kind === "parenthesis") {
      parenthesisByClose.set(pair.closeIndex, pair.openIndex);
    }
  }
  const braces = pairs
    .filter((pair) => pair.kind === "brace")
    .sort((left, right) => tokens[left.openIndex].startOffset - tokens[right.openIndex].startOffset);

  for (const brace of braces) {
    const openToken = tokens[brace.openIndex];
    const closeToken = tokens[brace.closeIndex];
    const parent = findParentScope(scopes, openToken.startOffset, document, tokens);
    const kind = classifyBraceScope(tokens, brace.openIndex, parenthesisByClose);
    const id = stableId("scope", openToken);
    scopes.set(id, {
      id,
      kind,
      sourceUri: document.sourceUri,
      range: { start: openToken.range.start, end: closeToken.range.end },
      parentId: parent.id,
    });
  }
  return scopes;
}

function classifyBraceScope(
  tokens: SlangToken[],
  openIndex: number,
  parenthesisByClose: Map<number, number>,
): SlangScopeKind {
  const boundary = previousBoundary(tokens, openIndex);
  const header = tokens.slice(boundary + 1, openIndex);
  if (header.some((token) => ["interface", "struct", "class", "extension"].includes(token.text))) {
    return "type";
  }
  const closeParenthesisIndex = openIndex - 1;
  if (tokens[closeParenthesisIndex]?.text === ")") {
    const openParenthesisIndex = parenthesisByClose.get(closeParenthesisIndex);
    if (openParenthesisIndex !== undefined) {
      const nameToken = callableNameBefore(tokens, openParenthesisIndex);
      if (nameToken && !controlFlowKeywords.has(nameToken.text)) {
        return "callable";
      }
    }
  }
  return "block";
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
    } else if (tokens[index].text === "<") {
      depth -= 1;
      if (depth === 0) {
        return tokens[index - 1]?.kind === "identifier" ? tokens[index - 1] : undefined;
      }
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

function findParentScope(
  scopes: Map<string, SlangScopeNode>,
  offset: number,
  document: SlangTokenDocument,
  tokens: SlangToken[],
): SlangScopeNode {
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

function findOwningType(
  types: Map<string, SlangTypeNode>,
  offset: number,
  document: SlangTokenDocument,
  tokens: SlangToken[],
): SlangTypeNode | undefined {
  let owner: SlangTypeNode | undefined;
  for (const type of types.values()) {
    const start = offsetForPosition(document, type.bodyRange.start, tokens);
    const end = offsetForPosition(document, type.bodyRange.end, tokens);
    if (start < offset && offset < end) {
      owner = type;
    }
  }
  return owner;
}

function ownerDisplayName(document: SlangTokenDocument, owner: SlangTypeNode): string {
  if (owner.kind !== "extension" || owner.genericParameters.length === 0) {
    return owner.name;
  }
  return `${owner.name}<${owner.genericParameters.join(", ")}>`;
}

function innermostScope(
  scopes: Map<string, SlangScopeNode>,
  offset: number,
  document: SlangTokenDocument,
  tokens: SlangToken[],
): SlangScopeNode {
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

function directDeclaration(
  document: SlangTokenDocument,
  nameToken: SlangToken,
  typeName: string,
  statementRange: DebugSourceRange,
  scopeId: string,
  access: SlangDeclarationNode["access"],
): SlangDeclarationNode {
  return createDeclaration(
    document,
    nameToken,
    typeName,
    statementRange,
    scopeId,
    access,
    { kind: "direct", writableRange: nameToken.range },
  );
}

function createDeclaration(
  document: SlangTokenDocument,
  nameToken: SlangToken,
  typeName: string,
  statementRange: DebugSourceRange,
  scopeId: string,
  access: SlangDeclarationNode["access"],
  origin: DebugOrigin,
): SlangDeclarationNode {
  const id = stableId("declaration", nameToken);
  return {
    id,
    name: nameToken.text,
    typeName,
    sourceUri: document.sourceUri,
    range: nameToken.range,
    statementRange,
    scopeId,
    access,
    origin,
  };
}

function createStatement(
  token: SlangToken,
  kind: SlangStatementKind,
  range: DebugSourceRange,
  scopeId: string,
): SlangStatementNode {
  const id = stableId("statement", token);
  return { id, kind, sourceUri: token.sourceUri, range, scopeId };
}

function statementKind(text: string): SlangStatementKind | undefined {
  return ["return", "break", "continue", "discard"].includes(text)
    ? text as SlangStatementKind
    : undefined;
}

function previousStatementBoundary(tokens: SlangToken[], index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if ([";", "{", "}"].includes(tokens[cursor].text)) {
      return cursor;
    }
  }
  return -1;
}

function splitTopLevelSegments(
  tokens: SlangToken[],
  startIndex: number,
  endIndex: number,
  separator: string,
): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let start = startIndex;
  let depth = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    if (["(", "[", "{", "<"].includes(tokens[index].text)) {
      depth += 1;
    } else if ([")", "]", "}", ">"].includes(tokens[index].text)) {
      depth -= 1;
    } else if (tokens[index].text === separator && depth === 0) {
      segments.push([start, index]);
      start = index + 1;
    }
  }
  segments.push([start, endIndex]);
  return segments;
}

function splitTokenText(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  startIndex: number,
  endIndex: number,
): string[] {
  if (startIndex >= endIndex) {
    return [];
  }
  return splitTopLevelSegments(tokens, startIndex, endIndex, ",")
    .map(([start, end]) => normalizedText(document, tokens, start, end))
    .filter(Boolean);
}

function normalizedText(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  startIndex: number,
  endIndex: number,
): string {
  if (startIndex >= endIndex) {
    return "";
  }
  return document.source
    .slice(tokens[startIndex].startOffset, tokens[endIndex - 1].endOffset)
    .trim()
    .replace(/\s+/g, " ");
}

function findNextToken(tokens: SlangToken[], startIndex: number, wanted: string, stop?: string): number | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].text === wanted) {
      return index;
    }
    if (stop && tokens[index].text === stop) {
      return index;
    }
  }
  return undefined;
}

function findMatchingText(
  tokens: SlangToken[],
  openIndex: number,
  openText: string,
  closeText: string,
): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].text === openText) {
      depth += 1;
    } else if (tokens[index].text === closeText) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function findTokenInRange(
  tokens: SlangToken[],
  startIndex: number,
  endIndex: number,
  text: string,
): number | undefined {
  for (let index = startIndex; index < endIndex; index += 1) {
    if (tokens[index].text === text) {
      return index;
    }
  }
  return undefined;
}

function findLastIdentifier(tokens: SlangToken[], startIndex: number, endIndex: number): number | undefined {
  for (let index = endIndex - 1; index >= startIndex; index -= 1) {
    if (tokens[index].kind === "identifier") {
      return index;
    }
  }
  return undefined;
}

function moduleScopeId(document: SlangTokenDocument): string {
  return `scope:${document.sourceUri}:0:0`;
}

function rangeStartOffset(document: SlangTokenDocument, range: DebugSourceRange): number {
  return offsetAt(document.source, range.start);
}

function rangeEndOffset(document: SlangTokenDocument, range: DebugSourceRange): number {
  return offsetAt(document.source, range.end);
}

function offsetAt(source: string, target: { line: number; character: number }): number {
  let line = 0;
  let character = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    if (line === target.line && character === target.character) {
      return offset;
    }
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
  return source.length;
}

function offsetForPosition(
  document: SlangTokenDocument,
  position: { line: number; character: number },
  _tokens: SlangToken[],
): number {
  return offsetAt(document.source, position);
}

function stableId(prefix: string, token: SlangToken): string {
  return `${prefix}:${token.sourceUri}:${token.range.start.line}:${token.range.start.character}`;
}
