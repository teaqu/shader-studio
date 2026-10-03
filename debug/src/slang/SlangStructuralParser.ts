import type { DebugDiagnostic,DebugSourceRange } from "@shader-studio/types";
import type { SlangPreprocessorModel } from "./SlangPreprocessor";
import { collectDoWhileTrailerIndices,controlBodyStartIndex,controlKindAt,controlledStatementEndIndex,parseControlFlows } from "./SlangStructuralControlFlows";
import { isPlausibleTypeIdentifier,matchBalancedDelimiters,matchGenericDelimiters } from "./SlangStructuralDelimiters";
import { appendMacroDeclarations } from "./SlangStructuralMacros";
import { createStatement,directDeclaration } from "./SlangStructuralNodes";
import {
arraySuffixText,
findDeclarationName,
findMatchingText,
findNextToken,
findTokenInRange,
findTopLevelToken,
isExplicitTypeTokenSequence,
moduleScopeId,
normalizedText,
previousBoundary,
previousStatementBoundary,
splitTokenText,
splitTopLevelSegments,
stableId
} from "./SlangStructuralParserTokens";
import { buildScopes,findOwningType,innermostScope,ownerDisplayName,type DelimiterPair } from "./SlangStructuralScopes";
import type {
SlangCallableNode,
SlangDeclarationNode,
SlangDelimiterNode,
SlangScopeNode,
SlangStatementKind,
SlangStatementNode,
SlangStructuralDocument,
SlangTypeKind,
SlangTypeNode
} from "./model";
import type { SlangToken,SlangTokenDocument } from "./tokens";

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
  const genericResult = matchGenericDelimiters(tokens);
  pairs.push(...genericResult.pairs);
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
  appendForLoopScopes(document, tokens, pairsByOpen, scopes);
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
  const embeddedControls = collectUnbracedControlStatements(document, tokens, pairsByOpen, scopes);
  const { declarations, statements, diagnostics: declarationDiagnostics } = parseStatementsAndDeclarations(
    document,
    tokens,
    pairs,
    scopes,
    signatureSemicolons,
    embeddedControls.semicolons,
  );
  for (const statement of embeddedControls.statements.values()) {
    statements.set(statement.id, statement);
  }
  appendForInitializerDeclarations(
    document,
    tokens,
    pairsByOpen,
    scopes,
    declarations,
    statements,
  );
  for (const declaration of parameterDeclarations.values()) {
    declarations.set(declaration.id, declaration);
  }
  const diagnostics = [
    ...preprocessor.diagnostics,
    ...delimiterResult.diagnostics,
    ...genericResult.diagnostics,
    ...declarationDiagnostics,
  ];
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
    const metadata = parseMetadataPrefix(document, tokens, previousBoundary(tokens, index) + 1, index);
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
      range: { start: tokens[metadata.startIndex].range.start, end: bodyClose.range.end },
      bodyRange: { start: bodyOpen.range.start, end: bodyClose.range.end },
      nameToken,
      scopeId: stableId("scope", bodyOpen),
      attributes: metadata.attributes,
      modifiers: metadata.modifiers,
    });
    index = bodyOpenIndex;
  }
  return types;
}

function parseMetadataPrefix(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  startIndex: number,
  declarationIndex: number,
): { startIndex: number; attributes: string[]; modifiers: string[] } {
  const attributes: string[] = [];
  const modifiers: string[] = [];
  let cursor = startIndex;
  while (tokens[cursor]?.text === "[") {
    const close = findMatchingText(tokens, cursor, "[", "]");
    if (close === undefined || close >= declarationIndex) {
      break;
    }
    attributes.push(normalizedText(document, tokens, cursor + 1, close));
    cursor = close + 1;
  }
  while (cursor < declarationIndex && declarationModifiers.has(tokens[cursor].text)) {
    modifiers.push(tokens[cursor].text);
    cursor += 1;
  }
  return cursor === declarationIndex
    ? { startIndex, attributes, modifiers }
    : { startIndex: declarationIndex, attributes: [], modifiers: [] };
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
      ownerType: owner ? ownerDisplayName(owner) : null,
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
  const modifiers: string[] = [];
  if (parameterAccess.has(tokens[cursor].text)) {
    access = parameterAccess.get(tokens[cursor].text)!;
    modifiers.push(tokens[cursor].text);
    cursor += 1;
  }
  while (cursor < endIndex && declarationModifiers.has(tokens[cursor].text)) {
    modifiers.push(tokens[cursor].text);
    cursor += 1;
  }
  const equalsIndex = findTokenInRange(tokens, cursor, endIndex, "=") ?? endIndex;
  const semanticIndex = findTopLevelToken(tokens, cursor, equalsIndex, ":") ?? equalsIndex;
  const nameIndex = findDeclarationName(tokens, cursor, semanticIndex);
  if (nameIndex === undefined || nameIndex <= cursor) {
    return undefined;
  }
  const suffix = arraySuffixText(document, tokens, nameIndex + 1, semanticIndex);
  if (suffix === null) {
    return undefined;
  }
  return directDeclaration(
    document,
    tokens[nameIndex],
    `${normalizedText(document, tokens, cursor, nameIndex)}${suffix}`,
    { start: tokens[statementStart].range.start, end: tokens[nameIndex].range.end },
    scopeId,
    access,
    modifiers,
  );
}

function parseStatementsAndDeclarations(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairs: DelimiterPair[],
  scopes: Map<string, SlangScopeNode>,
  signatureSemicolons: Set<number>,
  ignoredSemicolons: Set<number>,
): {
  declarations: Map<string, SlangDeclarationNode>;
  statements: Map<string, SlangStatementNode>;
  diagnostics: DebugDiagnostic[];
} {
  const declarations = new Map<string, SlangDeclarationNode>();
  const statements = new Map<string, SlangStatementNode>();
  const diagnostics: DebugDiagnostic[] = [];
  const parenthesisRanges = pairs.filter((pair) => pair.kind === "parenthesis");
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== ";" || signatureSemicolons.has(index) || ignoredSemicolons.has(index)) {
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
    const parsedDeclarations = parseDirectStatementDeclarations(document, tokens, start, index, scope.id, range);
    if (parsedDeclarations.length > 0) {
      for (const declaration of parsedDeclarations) {
        declarations.set(declaration.id, declaration);
      }
      const statement = createStatement(tokens[start], "declaration", range, scope.id);
      statements.set(statement.id, statement);
      continue;
    }
    const statement = createStatement(tokens[start], "expression", range, scope.id);
    statements.set(statement.id, statement);
  }
  return { declarations, statements, diagnostics };
}

function collectUnbracedControlStatements(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairsByOpen: Map<number, DelimiterPair>,
  scopes: Map<string, SlangScopeNode>,
): { statements: Map<string, SlangStatementNode>; semicolons: Set<number> } {
  const statements = new Map<string, SlangStatementNode>();
  const semicolons = new Set<number>();
  const doWhileTrailers = collectDoWhileTrailerIndices(tokens, pairsByOpen);
  const append = (controlIndex: number, startIndex: number, endIndex: number): void => {
    const scope = tokens[controlIndex].text === "for"
      ? scopes.get(stableId("scope", tokens[controlIndex]))
      : innermostScope(scopes, tokens[startIndex].startOffset, document, tokens);
    if (!scope) {
      return;
    }
    const kind = statementKind(tokens[startIndex].text) ?? "expression";
    const range = { start: tokens[startIndex].range.start, end: tokens[endIndex].range.end };
    const statement = createStatement(tokens[startIndex], kind, range, scope.id);
    statements.set(statement.id, statement);
    semicolons.add(endIndex);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    if (doWhileTrailers.has(index)) {
      continue;
    }
    const kind = controlKindAt(tokens, index);
    if (!kind) {
      continue;
    }
    const bodyStartIndex = controlBodyStartIndex(tokens, index, kind, pairsByOpen);
    if (bodyStartIndex === undefined) {
      continue;
    }
    if (tokens[bodyStartIndex]?.text !== "{" && !controlKindAt(tokens, bodyStartIndex)) {
      const bodyEndIndex = controlledStatementEndIndex(tokens, bodyStartIndex, pairsByOpen);
      if (bodyEndIndex !== undefined) {
        append(index, bodyStartIndex, bodyEndIndex);
      }
    }
    const bodyEndIndex = controlledStatementEndIndex(tokens, bodyStartIndex, pairsByOpen);
    const elseStartIndex = kind === "if" && bodyEndIndex !== undefined && tokens[bodyEndIndex + 1]?.text === "else"
      ? bodyEndIndex + 2
      : undefined;
    if (elseStartIndex !== undefined
      && tokens[elseStartIndex]?.text !== "{"
      && !controlKindAt(tokens, elseStartIndex)) {
      const elseEndIndex = controlledStatementEndIndex(tokens, elseStartIndex, pairsByOpen);
      if (elseEndIndex !== undefined) {
        append(index, elseStartIndex, elseEndIndex);
      }
    }
    if (kind === "do") {
      const whileIndex = bodyEndIndex === undefined ? undefined : bodyEndIndex + 1;
      const conditionPair = whileIndex !== undefined && tokens[whileIndex]?.text === "while"
        ? pairsByOpen.get(whileIndex + 1)
        : undefined;
      const terminatorIndex = conditionPair?.kind === "parenthesis" ? conditionPair.closeIndex + 1 : undefined;
      if (tokens[terminatorIndex ?? -1]?.text === ";") {
        semicolons.add(terminatorIndex!);
      }
    }
  }
  return { statements, semicolons };
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
  const modifiers: string[] = [];
  while (cursor < endIndex && declarationModifiers.has(tokens[cursor].text)) {
    modifiers.push(tokens[cursor].text);
    cursor += 1;
  }
  const equalsIndex = findTokenInRange(tokens, cursor, endIndex, "=") ?? endIndex;
  const nameIndex = findDeclarationName(tokens, cursor, equalsIndex);
  if (nameIndex === undefined || nameIndex <= cursor) {
    return undefined;
  }
  const typeTokens = tokens.slice(cursor, nameIndex);
  if (!isExplicitTypeTokenSequence(typeTokens)) {
    return undefined;
  }
  if (typeTokens.some((token) => token.text === "<") && !isPlausibleTypeIdentifier(typeTokens[0].text)) {
    return undefined;
  }
  const typeName = normalizedText(document, tokens, cursor, nameIndex);
  if (!typeName || ["return", "break", "continue", "discard"].includes(typeName)) {
    return undefined;
  }
  const suffix = arraySuffixText(document, tokens, nameIndex + 1, equalsIndex);
  if (suffix === null) {
    return undefined;
  }
  return directDeclaration(
    document,
    tokens[nameIndex],
    `${typeName}${suffix}`,
    statementRange,
    scopeId,
    "readwrite",
    modifiers,
  );
}

function parseDirectStatementDeclarations(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  startIndex: number,
  endIndex: number,
  scopeId: string,
  statementRange: DebugSourceRange,
): SlangDeclarationNode[] {
  const segments: Array<{ start: number; end: number }> = [];
  let segmentStart = startIndex;
  while (segmentStart < endIndex) {
    const comma = findTopLevelToken(tokens, segmentStart, endIndex, ",");
    segments.push({ start: segmentStart, end: comma ?? endIndex });
    if (comma === undefined) {
      break;
    }
    segmentStart = comma + 1;
  }
  const firstSegment = segments[0];
  if (!firstSegment) {
    return [];
  }
  const first = parseDirectStatementDeclaration(
    document,
    tokens,
    firstSegment.start,
    firstSegment.end,
    scopeId,
    statementRange,
  );
  if (!first) {
    return [];
  }
  if (segments.length === 1) {
    return [first];
  }

  const baseTypeName = withoutArraySuffix(first.typeName);
  const declarations = [first];
  for (const segment of segments.slice(1)) {
    const equalsIndex = findTokenInRange(tokens, segment.start, segment.end, "=") ?? segment.end;
    const nameToken = tokens[segment.start];
    if (!nameToken || nameToken.kind !== "identifier") {
      return [];
    }
    const suffix = arraySuffixText(document, tokens, segment.start + 1, equalsIndex);
    if (suffix === null) {
      return [];
    }
    declarations.push(directDeclaration(
      document,
      nameToken,
      `${baseTypeName}${suffix}`,
      statementRange,
      scopeId,
      "readwrite",
      first.modifiers,
    ));
  }
  return declarations;
}

function withoutArraySuffix(typeName: string): string {
  let end = typeName.length;
  while (end > 0 && typeName[end - 1] === "]") {
    const open = typeName.lastIndexOf("[", end - 1);
    if (open === -1) {
      break;
    }
    end = open;
  }
  return typeName.slice(0, end);
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
    const scope = scopes.get(stableId("scope", tokens[index]))
      ?? innermostScope(scopes, tokens[index].startOffset, document, tokens);
    const range = { start: tokens[startIndex].range.start, end: tokens[semicolonIndex].range.end };
    const parsedDeclarations = parseDirectStatementDeclarations(
      document,
      tokens,
      startIndex,
      semicolonIndex,
      scope.id,
      range,
    );
    if (parsedDeclarations.length === 0) {
      continue;
    }
    for (const declaration of parsedDeclarations) {
      declarations.set(declaration.id, declaration);
    }
    const statement = createStatement(tokens[startIndex], "declaration", range, scope.id);
    statements.set(statement.id, statement);
  }
}

function appendForLoopScopes(
  document: SlangTokenDocument,
  tokens: SlangToken[],
  pairsByOpen: Map<number, DelimiterPair>,
  scopes: Map<string, SlangScopeNode>,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].text !== "for" || tokens[index + 1]?.text !== "(") {
      continue;
    }
    const conditionPair = pairsByOpen.get(index + 1);
    const bodyOpenIndex = conditionPair?.kind === "parenthesis" ? conditionPair.closeIndex + 1 : undefined;
    const bodyEndIndex = bodyOpenIndex === undefined
      ? undefined
      : controlledStatementEndIndex(tokens, bodyOpenIndex, pairsByOpen);
    if (bodyOpenIndex === undefined || bodyEndIndex === undefined) {
      continue;
    }
    const token = tokens[index];
    const parent = innermostScope(scopes, token.startOffset, document, tokens);
    const id = stableId("scope", token);
    scopes.set(id, {
      id,
      kind: "loop",
      sourceUri: document.sourceUri,
      range: { start: token.range.start, end: tokens[bodyEndIndex].range.end },
      parentId: parent.id,
    });
    const bodyScope = tokens[bodyOpenIndex].text === "{"
      ? scopes.get(stableId("scope", tokens[bodyOpenIndex]))
      : undefined;
    if (bodyScope) {
      bodyScope.parentId = id;
    }
  }
}

function statementKind(text: string): SlangStatementKind | undefined {
  return ["return", "break", "continue", "discard"].includes(text)
    ? text as SlangStatementKind
    : undefined;
}
