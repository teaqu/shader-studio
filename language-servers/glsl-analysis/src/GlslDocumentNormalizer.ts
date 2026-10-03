import {
  generate as generatePreprocessor,
  parse as parsePreprocessor,
  preprocessAst
} from "@shaderfrog/glsl-parser/preprocessor/index.js";
import type { Range } from "vscode-languageserver-protocol";
import { deduplicateRanges, rangeContainsRange, rangesEqual } from "./GlslDocumentQueries.js";
import { arrayQuantifierDimensions, encodeArrayType, extractDeclarationMetadata, extractTypeName, flattenPostfixOperations, functionParameterTypes, publicTypeName, resolvedFunctionReturnType, resolveExpressionType, resolveFieldOwnerType, selectFunctionDefinition, withArrayDimensions } from "./GlslExpressionTypes.js";
import type { DeclarationMetadata, FieldMetadata, FieldReferenceMetadata, FunctionCallMetadata, MutableScope, ParserLocation, ParserNode, ParserProgram, ParserScope } from "./GlslParserAst.js";
import { anonymousStructIdentity, asNode, identifierNode, identifierValue, isNode, nodeArray, publicScopeName } from "./GlslParserAst.js";
import { mapGeneratedLocation, mapIdentifierLocation, mapLocation, sourceRange } from "./GlslSourceMapping.js";
import type {
  GlslScope,
  GlslSymbol,
  GlslSymbolKind,
  GlslUnresolvedReference
} from "./model.js";
import { buildGlslLineMapping, mapProcessedLine } from "./sourceMap.js";

export function normalizeProgram(
  parsed: ParserProgram,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[],
): { symbols: GlslSymbol[]; scopes: GlslScope[]; unresolvedReferences: GlslUnresolvedReference[] } {
  const parserScopes = parsed.scopes ?? [];
  const metadata = new Map<number, DeclarationMetadata>();
  const fields: FieldMetadata[] = [];
  const fieldReferences: FieldReferenceMetadata[] = [];
  const functionCalls: FunctionCallMetadata[] = [];
  collectDeclarationMetadata(parsed.program ?? [], metadata, fields, fieldReferences, functionCalls);

  const scopeIds = new Map<ParserScope, string>();
  parserScopes.forEach((scope, index) => scopeIds.set(scope, `scope:${index}`));
  const functionNames = new Set(parserScopes.flatMap((scope) => Object.entries(scope.functions)
    .filter(([, overloads]) => Object.values(overloads).some((overload) => overload.declaration))
    .map(([name]) => name)));
  const mutableScopes: MutableScope[] = parserScopes.map((scope, index) => ({
    id: `scope:${index}`,
    name: scope.name,
    kind: parserScopeKind(scope, functionNames),
    parentId: scope.parent ? scopeIds.get(scope.parent) : undefined,
    range: mapLocation(scope.location, originalLines, processedLines, processedToOriginal),
    symbolIds: [],
  }));

  if (mutableScopes.length === 0) {
    mutableScopes.push({
      id: "scope:0",
      name: "global",
      kind: "global",
      range: sourceRange(originalLines),
      symbolIds: [],
    });
  }

  const globalScope = mutableScopes.find((scope) => scope.parentId === undefined) ?? mutableScopes[0];
  const symbols: GlslSymbol[] = [];
  const unresolved = new Map<string, { name: string; kind: GlslUnresolvedReference["kind"]; ranges: Range[] }>();
  const characterMaps = new Map<string, readonly number[]>();
  let symbolSequence = 0;

  const addUnresolved = (
    name: string,
    kind: GlslUnresolvedReference["kind"],
    references: readonly ParserNode[],
  ): void => {
    const ranges = references
      .map((reference) => identifierNode(reference, name)?.location)
      .filter((location): location is ParserLocation => location !== undefined)
      .map((location) => mapIdentifierLocation(
        location,
        name,
        originalLines,
        processedLines,
        processedToOriginal,
        characterMaps,
      ))
      .filter((range): range is Range => range !== undefined);
    if (ranges.length === 0) {
      return;
    }
    const key = `${kind}:${name}`;
    const current = unresolved.get(key) ?? { name, kind, ranges: [] };
    current.ranges.push(...ranges);
    unresolved.set(key, current);
  };

  const addSymbol = (
    scope: MutableScope,
    name: string,
    kind: GlslSymbolKind,
    declarationNode: ParserNode,
    references: readonly ParserNode[],
    typeName?: string,
    signature?: string,
  ): void => {
    const declarationIdentifier = identifierNode(declarationNode, name);
    const declarationLocation = declarationIdentifier?.location ?? declarationNode.location;
    if (!declarationLocation) {
      return;
    }
    const declaration = mapIdentifierLocation(
      declarationLocation,
      name,
      originalLines,
      processedLines,
      processedToOriginal,
      characterMaps,
    ) ?? mapGeneratedLocation(
      declarationLocation,
      originalLines,
      processedLines,
      processedToOriginal,
      characterMaps,
    );
    const mappedDefinition = mapLocation(
      declarationNode.location ?? declarationLocation,
      originalLines,
      processedLines,
      processedToOriginal,
    );
    const definition = rangeContainsRange(mappedDefinition, declaration)
      ? mappedDefinition
      : declaration;
    const mappedReferences = references
      .map((reference) => identifierNode(reference, name)?.location)
      .filter((location): location is ParserLocation => location !== undefined)
      .map((location) => mapIdentifierLocation(
        location,
        name,
        originalLines,
        processedLines,
        processedToOriginal,
        characterMaps,
      ))
      .filter((reference): reference is Range => reference !== undefined)
      .filter((reference) => !rangesEqual(reference, declaration));
    const id = `symbol:${symbolSequence++}`;
    symbols.push({
      id,
      name,
      kind,
      typeName,
      signature,
      declaration,
      definition,
      references: deduplicateRanges(mappedReferences),
      scopeId: scope.id,
    });
    scope.symbolIds.push(id);
  };

  parserScopes.forEach((parserScope, scopeIndex) => {
    const scope = mutableScopes[scopeIndex];
    for (const [name, entry] of Object.entries(parserScope.bindings)) {
      if (!entry.declaration) {
        addUnresolved(name, "variable", entry.references);
        continue;
      }
      const kind = entry.declaration.type === "parameter_declaration" ? "parameter" : "variable";
      const declarationLocation = identifierNode(entry.declaration, name)?.location;
      const resolvedTypeName = kind === "parameter"
        ? (() => {
          const baseType = extractTypeName(entry.declaration.specifier);
          return baseType
            ? encodeArrayType(baseType, arrayQuantifierDimensions(entry.declaration))
            : undefined;
        })()
        : declarationLocation ? metadata.get(declarationLocation.start.offset)?.resolvedTypeName : undefined;
      const typeName = publicTypeName(resolvedTypeName);
      addSymbol(scope, name, kind, entry.declaration, entry.references, typeName);
    }

    for (const [name, entry] of Object.entries(parserScope.types)) {
      if (entry.declaration) {
        addSymbol(scope, name, "type", entry.declaration, entry.references, name);
      } else {
        addUnresolved(name, "type", entry.references);
      }
    }

    for (const [name, overloads] of Object.entries(parserScope.functions)) {
      const unresolvedOverloads = Object.values(overloads).filter((definition) => !definition.declaration);
      if (unresolvedOverloads.length > 0) {
        addUnresolved(name, "function", unresolvedOverloads.flatMap((definition) => definition.references));
      }
      const namedCalls = functionCalls.filter((call) => call.name === name);
      const callOffsets = new Set(namedCalls
        .map((call) => call.identifier.location?.start.offset)
        .filter((offset): offset is number => offset !== undefined));
      for (const definition of Object.values(overloads)) {
        if (!definition.declaration) {
          continue;
        }
        const returnType = publicTypeName(resolvedFunctionReturnType(definition));
        const parameterTypes = functionParameterTypes(definition);
        addSymbol(
          scope,
          name,
          "function",
          definition.declaration,
          [
            ...definition.references.filter((reference) => {
              const offset = identifierNode(reference, name)?.location?.start.offset;
              return offset === undefined || !callOffsets.has(offset);
            }),
            ...namedCalls
              .filter((call) => selectFunctionDefinition(
                parserScopes,
                call.name,
                call.arguments.map((argument) => resolveExpressionType(
                  parserScopes,
                  metadata,
                  fields,
                  argument,
                )),
              ) === definition)
              .map((call) => call.identifier),
          ],
          returnType,
          returnType ? `${returnType} ${name}(${parameterTypes.join(", ")})` : undefined,
        );
      }
    }
  });

  for (const field of fields) {
    let ownerScope = mutableScopes.find((scope) => (
      scope.name === field.ownerName && rangesEqual(
        scope.range,
        mapLocation(field.ownerLocation, originalLines, processedLines, processedToOriginal),
      )
    ));
    if (!ownerScope) {
      ownerScope = {
        id: `scope:field:${mutableScopes.length}`,
        name: field.ownerName,
        kind: "type",
        parentId: globalScope.id,
        range: mapLocation(field.ownerLocation, originalLines, processedLines, processedToOriginal),
        symbolIds: [],
      };
      mutableScopes.push(ownerScope);
    }
    addSymbol(
      ownerScope,
      field.name,
      "field",
      { type: "identifier", location: field.location, identifier: field.name },
      fieldReferences
        .filter((reference) => reference.fieldName === field.name)
        .filter((reference) => resolveFieldOwnerType(
          parserScopes,
          metadata,
          fields,
          reference,
        ) === field.ownerName)
        .map((reference) => reference.selection),
      publicTypeName(field.resolvedTypeName),
    );
  }

  for (const macro of collectMacroDefinitions(originalLines)) {
    symbols.push({
      id: `symbol:${symbolSequence++}`,
      name: macro.name,
      kind: macro.parameters ? "function" : "variable",
      signature: macro.parameters
        ? `#define ${macro.name}(${macro.parameters.join(", ")})`
        : `#define ${macro.name}`,
      declaration: macro.range,
      definition: macro.range,
      references: [],
      scopeId: globalScope.id,
    });
    globalScope.symbolIds.push(`symbol:${symbolSequence - 1}`);
  }

  return {
    symbols,
    unresolvedReferences: [...unresolved.values()].map((reference) => ({
      ...reference,
      ranges: deduplicateRanges(reference.ranges),
    })),
    scopes: mutableScopes.map((scope) => ({
      ...scope,
      name: publicScopeName(scope.name),
    })),
  };
}

function collectMacroDefinitions(
  originalLines: readonly string[],
): { name: string; parameters?: readonly string[]; range: Range }[] {
  // Keep macro nodes while the parser's own preprocessor evaluates conditionals
  // and expands continuations. This gives macro indexing exactly the same active
  // branches as compilation, without reimplementing its expression evaluator.
  let effectiveSource: string;
  try {
    const program = parsePreprocessor(originalLines.join("\n"));
    effectiveSource = generatePreprocessor(preprocessAst(program, {
      preserve: {
        define: () => true,
        define_arguments: () => true,
        undef: () => true,
      },
    }));
  } catch {
    return [];
  }

  const effectiveLines = effectiveSource.split("\n");
  const lineMapping = buildGlslLineMapping(originalLines, effectiveLines);
  const macros = new Map<string, { name: string; parameters?: readonly string[]; range: Range }>();
  const pattern = /^\s*#\s*(define|undef)\s+([A-Za-z_]\w*)(\()?/;

  effectiveLines.forEach((line, effectiveLine) => {
    const match = pattern.exec(line);
    if (!match) {
      return;
    }
    const [, command, name, functionLike] = match;
    if (command === "undef") {
      macros.delete(name);
      return;
    }
    const originalLine = mapProcessedLine(lineMapping.processedToOriginal, effectiveLine);
    const original = originalLines[originalLine] ?? line;
    const character = original.indexOf(name, original.indexOf("define"));
    if (character < 0) {
      return;
    }
    const openIndex = character + name.length;
    const closeIndex = functionLike ? original.indexOf(")", openIndex) : -1;
    const parameters = closeIndex === -1
      ? undefined
      : original.slice(openIndex + 1, closeIndex)
        .split(",")
        .map((parameter) => parameter.trim())
        .filter((parameter) => parameter.length > 0);
    macros.set(name, {
      name,
      parameters,
      range: {
        start: { line: originalLine, character },
        end: { line: originalLine, character: character + name.length },
      },
    });
  });

  return [...macros.values()];
}

function parserScopeKind(
  scope: ParserScope,
  functionNames: ReadonlySet<string>,
): GlslScope["kind"] {
  if (!scope.parent) {
    return "global";
  }
  if (scope.parent.name === "global" && functionNames.has(scope.name)) {
    return "function";
  }
  return "block";
}

function collectDeclarationMetadata(
  value: unknown,
  metadata: Map<number, DeclarationMetadata>,
  fields: FieldMetadata[],
  fieldReferences: FieldReferenceMetadata[],
  functionCalls: FunctionCallMetadata[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectDeclarationMetadata(entry, metadata, fields, fieldReferences, functionCalls));
    return;
  }
  if (!isNode(value)) {
    return;
  }

  if (value.type === "declarator_list") {
    const declarationMetadata = extractDeclarationMetadata(value.specified_type);
    const specifiedArrayDimensions = arrayQuantifierDimensions(value.specified_type);
    for (const declaration of nodeArray(value.declarations)) {
      const identifier = identifierNode(declaration);
      if (identifier?.location) {
        metadata.set(
          identifier.location.start.offset,
          withArrayDimensions(
            declarationMetadata,
            [...specifiedArrayDimensions, ...arrayQuantifierDimensions(declaration)],
          ),
        );
      }
    }
  }

  if (value.type === "struct") {
    const ownerName = identifierValue(asNode(value.typeName)) ?? anonymousStructIdentity(value);
    if (ownerName && value.location) {
      for (const structDeclaration of nodeArray(value.declarations)) {
        const declarator = asNode(structDeclaration.declaration);
        const fieldType = extractDeclarationMetadata(declarator?.specified_type);
        const specifiedArrayDimensions = arrayQuantifierDimensions(declarator?.specified_type);
        for (const declaration of nodeArray(declarator?.declarations)) {
          const identifier = identifierNode(declaration);
          const name = identifierValue(identifier);
          if (name && identifier?.location) {
            fields.push({
              name,
              typeName: fieldType.typeName,
              resolvedTypeName: withArrayDimensions(
                fieldType,
                [...specifiedArrayDimensions, ...arrayQuantifierDimensions(declaration)],
              ).resolvedTypeName,
              location: identifier.location,
              ownerName,
              ownerLocation: value.location,
            });
          }
        }
      }
    }
  }

  if (value.type === "postfix") {
    const root = asNode(value.expression);
    if (root?.location) {
      const precedingOperations: ParserNode[] = [];
      for (const operation of flattenPostfixOperations(asNode(value.postfix))) {
        if (operation.type === "quantifier") {
          precedingOperations.push(operation);
          continue;
        }
        if (operation.type !== "field_selection") {
          continue;
        }
        const selection = asNode(operation.selection);
        const fieldName = identifierValue(selection);
        if (!fieldName || !selection?.location) {
          continue;
        }
        fieldReferences.push({
          fieldName,
          selection,
          root,
          precedingOperations: [...precedingOperations],
        });
        precedingOperations.push(operation);
      }
    }
  }

  if (value.type === "function_call") {
    const callIdentifier = asNode(value.identifier);
    const name = identifierValue(callIdentifier) ?? extractTypeName(callIdentifier);
    const identifier = identifierNode(callIdentifier, name);
    if (name && identifier) {
      functionCalls.push({
        name,
        identifier,
        arguments: nodeArray(value.args),
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== "location") {
      collectDeclarationMetadata(child, metadata, fields, fieldReferences, functionCalls);
    }
  }
}
