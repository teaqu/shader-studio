import type { DebugDiagnostic, DebugOrigin, DebugSourceRange } from "@shader-studio/types";
import type { SlangPreprocessorModel } from "./SlangPreprocessor";
import type { SlangDeclarationNode, SlangScopeNode, SlangStatementNode } from "./model";
import type { SlangToken, SlangTokenDocument } from "./tokens";
import { createDeclaration, createStatement } from "./SlangStructuralNodes";
import { innermostScope } from "./SlangStructuralScopes";
import { findMatchingText, isExplicitTypeTokenSequence, rangeEndOffset, rangeStartOffset } from "./SlangStructuralParserTokens";

const declarationModifiers = new Set(["const", "extern", "inline", "internal", "mutating", "nointerpolation", "override", "private", "public", "static", "uniform", "virtual"]);


export function appendMacroDeclarations(
  document: SlangTokenDocument,
  preprocessor: SlangPreprocessorModel,
  tokens: SlangToken[],
  scopes: Map<string, SlangScopeNode>,
  declarations: Map<string, SlangDeclarationNode>,
  statements: Map<string, SlangStatementNode>,
  diagnostics: DebugDiagnostic[],
): void {
  for (const invocation of preprocessor.invocations) {
    const definition = preprocessor.macros.get(invocation.name);
    const declarationShape = definition
      ? macroDeclarationShape(definition.bodyTokens, definition.parameters)
      : undefined;
    if (!invocation.writableOrigin) {
      if (declarationShape) {
        diagnostics.push({
          code: "slang-debug-no-writable-origin",
          message: `Macro expansion for ${invocation.name} has no writable declaration origin.`,
          sourceUri: document.sourceUri,
          range: invocation.invocationRange,
        });
      }
      continue;
    }
    if (preprocessor.invocations.some((expanded) => !expanded.writableOrigin
      && sameRange(expanded.invocationRange, invocation.invocationRange))) {
      continue;
    }
    if (!declarationShape) {
      continue;
    }
    const argument = invocation.argumentTokens[declarationShape.nameParameterIndex]
      ?.filter((token) => token.kind !== "whitespace" && token.kind !== "comment");
    if (argument?.length !== 1 || argument[0].kind !== "identifier") {
      continue;
    }
    const nameToken = argument[0];
    const semicolon = tokens.find((token) => token.text === ";" && token.startOffset >= rangeEndOffset(document, invocation.invocationRange));
    const statementRange = {
      start: invocation.invocationRange.start,
      end: semicolon?.range.end ?? invocation.invocationRange.end,
    };
    const scope = innermostScope(scopes, nameToken.startOffset, document, tokens);
    const origin: DebugOrigin = { kind: "macro-invocation", writableRange: invocation.invocationRange };
    const declaration = createDeclaration(
      document,
      nameToken,
      declarationShape.typeName,
      statementRange,
      scope.id,
      "readwrite",
      origin,
    );
    declarations.set(declaration.id, declaration);
    const invocationToken = tokens.find((token) => token.startOffset === rangeStartOffset(document, invocation.invocationRange)) ?? nameToken;
    const statement = createStatement(invocationToken, "declaration", statementRange, scope.id);
    statements.set(statement.id, statement);
  }
}

function sameRange(left: DebugSourceRange, right: DebugSourceRange): boolean {
  return left.start.line === right.start.line
    && left.start.character === right.start.character
    && left.end.line === right.end.line
    && left.end.character === right.end.character;
}

function macroDeclarationShape(
  tokens: SlangToken[],
  parameters: string[],
): { nameParameterIndex: number; typeName: string } | undefined {
  const body = tokens.filter((token) => token.kind !== "whitespace" && token.kind !== "comment");
  const end = body.findIndex((token) => token.text === ";");
  const statement = body.slice(0, end < 0 ? body.length : end);
  const equals = statement.findIndex((token) => token.text === "=");
  const declaratorEnd = equals < 0 ? statement.length : equals;
  let typeStart = 0;
  while (typeStart < declaratorEnd && declarationModifiers.has(statement[typeStart].text)) {
    typeStart += 1;
  }
  for (let index = typeStart + 1; index < declaratorEnd; index += 1) {
    const nameParameterIndex = parameters.indexOf(statement[index].text);
    if (nameParameterIndex < 0 || !isExplicitTypeTokenSequence(statement.slice(typeStart, index))) {
      continue;
    }
    const suffix = macroArraySuffix(statement.slice(index + 1, declaratorEnd));
    if (suffix !== null) {
      const typeName = statement.slice(typeStart, index).map((token) => token.text).join("") + suffix;
      return { nameParameterIndex, typeName };
    }
  }
  return undefined;
}

function macroArraySuffix(tokens: SlangToken[]): string | null {
  let cursor = 0;
  while (cursor < tokens.length) {
    if (tokens[cursor].text !== "[") {
      return null;
    }
    const close = findMatchingText(tokens, cursor, "[", "]");
    if (close === undefined) {
      return null;
    }
    cursor = close + 1;
  }
  return tokens.map((token) => token.text).join("");
}
