import { parse } from "@shaderfrog/glsl-parser";
import { preprocess } from "@shaderfrog/glsl-parser/preprocessor/index.js";
import type { ShaderStage } from "@shader-studio/types";
import type { Position, Range } from "vscode-languageserver-protocol";
import type {
  GlslAnalysisDocument,
  GlslParseDiagnostic,
  GlslScope,
  GlslSymbol,
  GlslSymbolKind,
} from "./model.js";
import { buildGlslLineMapping, mapProcessedLine } from "./sourceMap.js";

interface ParserLocationInfo {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

interface ParserLocation {
  readonly start: ParserLocationInfo;
  readonly end: ParserLocationInfo;
}

interface ParserNode {
  readonly type?: string;
  readonly location?: ParserLocation;
  readonly [key: string]: unknown;
}

interface ParserScopeEntry {
  readonly declaration?: ParserNode;
  readonly references: readonly ParserNode[];
}

interface ParserFunctionDefinition {
  readonly returnType: string;
  readonly parameterTypes: readonly string[];
  readonly declaration?: ParserNode;
  readonly references: readonly ParserNode[];
}

interface ParserScope {
  readonly name: string;
  readonly parent?: ParserScope;
  readonly bindings: Readonly<Record<string, ParserScopeEntry>>;
  readonly types: Readonly<Record<string, ParserScopeEntry>>;
  readonly functions: Readonly<Record<string, Readonly<Record<string, ParserFunctionDefinition>>>>;
  readonly location?: ParserLocation;
}

interface ParserProgram {
  readonly program?: readonly ParserNode[];
  readonly scopes?: readonly ParserScope[];
}

interface ParserFailure extends Error {
  readonly location?: ParserLocation;
}

interface DeclarationMetadata {
  readonly typeName?: string;
  readonly resolvedTypeName?: string;
}

type ArrayExtent = number | undefined;

interface ResolvedArrayType {
  readonly elementType: string;
  readonly dimensions: readonly ArrayExtent[];
}

interface FieldMetadata {
  readonly name: string;
  readonly typeName?: string;
  readonly resolvedTypeName?: string;
  readonly location: ParserLocation;
  readonly ownerName: string;
  readonly ownerLocation: ParserLocation;
}

interface FieldReferenceMetadata {
  readonly fieldName: string;
  readonly selection: ParserNode;
  readonly root: ParserNode;
  readonly precedingOperations: readonly ParserNode[];
}

interface FunctionCallMetadata {
  readonly name: string;
  readonly identifier: ParserNode;
  readonly arguments: readonly ParserNode[];
}

interface MutableScope {
  id: string;
  name: string;
  kind: GlslScope["kind"];
  parentId?: string;
  range: Range;
  symbolIds: string[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ARRAY_TYPE_PREFIX = "@array:";

export function parseGlslDocument(
  uri: string,
  source: string,
  stage: ShaderStage,
): GlslAnalysisDocument {
  const originalLines = source.split("\n");
  const diagnostics: GlslParseDiagnostic[] = [];
  let processedSource = source;

  if (/^\s*#/m.test(source)) {
    try {
      processedSource = preprocess(source);
    } catch (error) {
      diagnostics.push(createDiagnostic("preprocess", error, originalLines));
    }
  }

  const processedLines = processedSource.split("\n");
  const lineMapping = buildGlslLineMapping(originalLines, processedLines);
  let parsed: ParserProgram = {};
  let parsedSuccessfully = true;

  try {
    parsed = parse(processedSource, {
      includeLocation: true,
      quiet: true,
      stage: parserStage(stage),
    }) as unknown as ParserProgram;
  } catch (error) {
    parsedSuccessfully = false;
    diagnostics.push(createDiagnostic(
      "syntax",
      error,
      originalLines,
      processedLines,
      lineMapping.processedToOriginal,
    ));
  }

  const { symbols, scopes } = normalizeProgram(
    parsed,
    originalLines,
    processedLines,
    lineMapping.processedToOriginal,
  );

  return freezeDocument({
    uri,
    source,
    processedSource,
    stage,
    parsedSuccessfully,
    symbols,
    scopes,
    diagnostics,
    originalToProcessed: [...lineMapping.originalToProcessed],
    processedToOriginal: [...lineMapping.processedToOriginal],
  });
}

export function symbolAtPosition(
  document: GlslAnalysisDocument,
  position: Position,
): GlslSymbol | null {
  if (!isValidPosition(document.source, position)) {
    return null;
  }

  for (const symbol of document.symbols) {
    if (rangeContains(symbol.declaration, position)) {
      return symbol;
    }
    if (symbol.references.some((reference) => rangeContains(reference, position))) {
      return symbol;
    }
  }

  return null;
}

export function visibleSymbolsAtPosition(
  document: GlslAnalysisDocument,
  position: Position,
): readonly GlslSymbol[] {
  if (!isValidPosition(document.source, position)) {
    return [];
  }

  const containingScopes = document.scopes
    .filter((scope) => rangeContainsInclusiveEnd(scope.range, position))
    .sort((left, right) => comparePosition(right.range.start, left.range.start));
  const innermost = containingScopes[0];
  if (!innermost) {
    return [];
  }

  const scopesById = new Map(document.scopes.map((scope) => [scope.id, scope]));
  const symbolsById = new Map(document.symbols.map((symbol) => [symbol.id, symbol]));
  const visible: GlslSymbol[] = [];
  const hiddenNames = new Set<string>();
  let scope: GlslScope | undefined = innermost;

  while (scope) {
    for (const symbolId of scope.symbolIds) {
      const symbol = symbolsById.get(symbolId);
      if (!symbol || comparePosition(symbol.declaration.start, position) > 0) {
        continue;
      }
      const hidesByName = symbol.kind !== "function";
      if (hidesByName && hiddenNames.has(symbol.name)) {
        continue;
      }
      visible.push(symbol);
      if (hidesByName) {
        hiddenNames.add(symbol.name);
      }
    }
    scope = scope.parentId ? scopesById.get(scope.parentId) : undefined;
  }

  return Object.freeze(visible);
}

function normalizeProgram(
  parsed: ParserProgram,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[],
): { symbols: GlslSymbol[]; scopes: GlslScope[] } {
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
  const characterMaps = new Map<string, readonly number[]>();
  let symbolSequence = 0;

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
      }
    }

    for (const [name, overloads] of Object.entries(parserScope.functions)) {
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

  return {
    symbols,
    scopes: mutableScopes.map((scope) => ({
      ...scope,
      name: publicScopeName(scope.name),
    })),
  };
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

function normalizeParserType(typeName: string | undefined): string | undefined {
  return typeName && typeName !== "undefined" && typeName !== "UNKNOWN TYPE"
    ? typeName
    : undefined;
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

function flattenPostfixOperations(node: ParserNode | undefined): ParserNode[] {
  if (!node) {
    return [];
  }
  if (node.type !== "postfix") {
    return [node];
  }
  const expression = asNode(node.expression);
  return [
    ...(expression ? [expression] : []),
    ...flattenPostfixOperations(asNode(node.postfix)),
  ];
}

function resolveFieldOwnerType(
  scopes: readonly ParserScope[],
  metadata: ReadonlyMap<number, DeclarationMetadata>,
  fields: readonly FieldMetadata[],
  reference: FieldReferenceMetadata,
): string | undefined {
  let ownerType = resolveExpressionType(
    scopes,
    metadata,
    fields,
    reference.root,
  );
  for (const operation of reference.precedingOperations) {
    if (operation.type === "quantifier") {
      const indexExpression = asNode(operation.expression);
      const indexType = indexExpression
        ? resolveExpressionType(scopes, metadata, fields, indexExpression)
        : undefined;
      ownerType = ownerType && isValidIndexType(indexType) ? indexedType(ownerType) : undefined;
    } else if (operation.type === "field_selection") {
      const fieldName = identifierValue(asNode(operation.selection));
      ownerType = fields.find((field) => (
        field.ownerName === ownerType && field.name === fieldName
      ))?.resolvedTypeName;
    }
    if (!ownerType) {
      return undefined;
    }
  }
  return ownerType;
}

function resolveExpressionType(
  scopes: readonly ParserScope[],
  metadata: ReadonlyMap<number, DeclarationMetadata>,
  fields: readonly FieldMetadata[],
  expression: ParserNode,
): string | undefined {
  if (expression.type === "identifier") {
    const name = identifierValue(expression);
    return name && expression.location
      ? resolveBindingTypeAtReference(scopes, metadata, name, expression.location.start.offset)
      : undefined;
  }
  if (expression.type === "group") {
    const grouped = asNode(expression.expression);
    return grouped ? resolveExpressionType(scopes, metadata, fields, grouped) : undefined;
  }
  if (expression.type === "unary") {
    const operand = asNode(expression.expression);
    const operandType = operand
      ? resolveExpressionType(scopes, metadata, fields, operand)
      : undefined;
    return resolveUnaryType(literalValue(asNode(expression.operator)), operandType);
  }
  if (expression.type === "binary") {
    const left = asNode(expression.left);
    const right = asNode(expression.right);
    return resolveBinaryType(
      literalValue(asNode(expression.operator)),
      left ? resolveExpressionType(scopes, metadata, fields, left) : undefined,
      right ? resolveExpressionType(scopes, metadata, fields, right) : undefined,
    );
  }
  if (expression.type === "ternary") {
    const condition = asNode(expression.expression);
    const left = asNode(expression.left);
    const right = asNode(expression.right);
    const conditionType = condition
      ? resolveExpressionType(scopes, metadata, fields, condition)
      : undefined;
    const leftType = left ? resolveExpressionType(scopes, metadata, fields, left) : undefined;
    const rightType = right ? resolveExpressionType(scopes, metadata, fields, right) : undefined;
    return conditionType === "bool" && leftType && rightType && typesEquivalent(leftType, rightType)
      ? canonicalTypeName(leftType)
      : undefined;
  }
  if (expression.type === "function_call") {
    const callIdentifier = asNode(expression.identifier);
    const name = identifierValue(callIdentifier) ?? extractTypeName(callIdentifier);
    if (name && isBuiltinValueType(name)) {
      return name;
    }
    const identifier = identifierNode(callIdentifier, name);
    if (!name || !identifier?.location) {
      return undefined;
    }
    if (scopes.some((scope) => scope.types[name]?.declaration)) {
      return name;
    }
    const argumentTypes = nodeArray(expression.args).map((argument) => (
      resolveExpressionType(scopes, metadata, fields, argument)
    ));
    return resolveFunctionReturnTypeAtReference(
      scopes,
      name,
      argumentTypes,
    );
  }
  if (expression.type === "float_constant") {
    return "float";
  }
  if (expression.type === "int_constant") {
    return "int";
  }
  if (expression.type === "uint_constant") {
    return "uint";
  }
  if (expression.type === "bool_constant") {
    return "bool";
  }
  if (expression.type === "postfix") {
    const root = asNode(expression.expression);
    let ownerType = root ? resolveExpressionType(scopes, metadata, fields, root) : undefined;
    for (const operation of flattenPostfixOperations(asNode(expression.postfix))) {
      if (operation.type === "quantifier") {
        const indexExpression = asNode(operation.expression);
        const indexType = indexExpression
          ? resolveExpressionType(scopes, metadata, fields, indexExpression)
          : undefined;
        ownerType = ownerType && isValidIndexType(indexType) ? indexedType(ownerType) : undefined;
        if (!ownerType) {
          return undefined;
        }
        continue;
      }
      if (operation.type !== "field_selection") {
        return undefined;
      }
      const fieldName = identifierValue(asNode(operation.selection));
      ownerType = ownerType && fieldName
        ? resolveSwizzleType(ownerType, fieldName) ?? fields.find((field) => (
          field.ownerName === ownerType && field.name === fieldName
        ))?.resolvedTypeName
        : undefined;
      if (!ownerType) {
        return undefined;
      }
    }
    return ownerType;
  }
  return undefined;
}

function resolveFunctionReturnTypeAtReference(
  scopes: readonly ParserScope[],
  functionName: string,
  argumentTypes: readonly (string | undefined)[],
): string | undefined {
  const definition = selectFunctionDefinition(
    scopes,
    functionName,
    argumentTypes,
  );
  if (!definition) {
    return undefined;
  }
  return resolvedFunctionReturnType(definition);
}

function resolvedFunctionReturnType(definition: ParserFunctionDefinition): string | undefined {
  const prototype = asNode(definition.declaration?.prototype);
  const header = asNode(prototype?.header);
  const returnType = extractTypeName(header?.returnType);
  return returnType
    ? encodeArrayType(returnType, arrayQuantifierDimensions(header?.returnType))
    : encodeParserArrayType(normalizeParserType(definition.returnType));
}

function selectFunctionDefinition(
  scopes: readonly ParserScope[],
  functionName: string,
  argumentTypes: readonly (string | undefined)[],
): ParserFunctionDefinition | undefined {
  if (!argumentTypes.every((type): type is string => type !== undefined)) {
    return undefined;
  }
  if (!argumentTypes.every(isWebGlSemanticType)) {
    return undefined;
  }
  for (const scope of scopes) {
    const overloads = scope.functions[functionName];
    if (!overloads) {
      continue;
    }
    const definitions = Object.values(overloads);
    const matchingDefinitions = definitions.filter((candidate) => {
      const parameterTypes = resolvedFunctionParameterTypes(candidate);
      const returnType = resolvedFunctionReturnType(candidate);
      return parameterTypes.every(isWebGlSemanticType)
        && (!returnType || isWebGlSemanticType(returnType))
        && parameterTypes.length === argumentTypes.length
        && parameterTypes.every((type, index) => typesEquivalent(type, argumentTypes[index]));
    });
    return matchingDefinitions.length === 1 ? matchingDefinitions[0] : undefined;
  }
  return undefined;
}

function functionParameterTypes(definition: ParserFunctionDefinition): readonly string[] {
  const prototype = asNode(definition.declaration?.prototype);
  const declaredParameterTypes = nodeArray(prototype?.parameters)
    .map((parameter) => {
      const typeName = extractTypeName(parameter.specifier);
      return typeName
        ? publicTypeName(encodeArrayType(typeName, arrayQuantifierDimensions(parameter)))
        : undefined;
    });
  return declaredParameterTypes.every((type): type is string => type !== undefined)
    ? declaredParameterTypes
    : definition.parameterTypes
      .map(normalizeParserType)
      .map(encodeParserArrayType)
      .map(publicTypeName)
      .filter((type): type is string => type !== undefined && type !== "void");
}

function resolvedFunctionParameterTypes(definition: ParserFunctionDefinition): readonly string[] {
  const prototype = asNode(definition.declaration?.prototype);
  const declaredParameterTypes = nodeArray(prototype?.parameters)
    .map((parameter) => {
      const typeName = extractTypeName(parameter.specifier);
      return typeName
        ? encodeArrayType(typeName, arrayQuantifierDimensions(parameter))
        : undefined;
    });
  if (declaredParameterTypes.every((type): type is string => type !== undefined)) {
    return declaredParameterTypes.length === 1 && declaredParameterTypes[0] === "void"
      ? []
      : declaredParameterTypes;
  }
  return definition.parameterTypes
    .map(normalizeParserType)
    .map(encodeParserArrayType)
    .filter((type): type is string => type !== undefined && type !== "void");
}

function resolveUnaryType(operator: string | undefined, operandType: string | undefined): string | undefined {
  if (!operator || !operandType) {
    return undefined;
  }
  if (operator === "!") {
    return operandType === "bool" ? "bool" : undefined;
  }
  if (operator === "~") {
    return isIntegerType(operandType) ? operandType : undefined;
  }
  return ["+", "-", "++", "--"].includes(operator) && isNumericType(operandType)
    ? operandType
    : undefined;
}

function resolveBinaryType(
  operator: string | undefined,
  leftType: string | undefined,
  rightType: string | undefined,
): string | undefined {
  if (!operator || !leftType || !rightType) {
    return undefined;
  }
  if (["&&", "||", "^^"].includes(operator)) {
    return leftType === "bool" && rightType === "bool" ? "bool" : undefined;
  }
  if (["==", "!="].includes(operator)) {
    return typesEquivalent(leftType, rightType) && isEqualityComparableType(leftType)
      ? "bool"
      : undefined;
  }
  if (["<", ">", "<=", ">="].includes(operator)) {
    return leftType === rightType && isNumericScalarType(leftType) ? "bool" : undefined;
  }
  if (["&", "|", "^"].includes(operator)) {
    return resolveIntegerComponentwiseType(leftType, rightType);
  }
  if (["<<", ">>"].includes(operator)) {
    return resolveShiftType(leftType, rightType);
  }
  if (operator === "%") {
    return resolveIntegerComponentwiseType(leftType, rightType);
  }
  if (["+", "-", "/"].includes(operator)) {
    return resolveArithmeticComponentwiseType(leftType, rightType);
  }
  return operator === "*" ? resolveMultiplicationType(leftType, rightType) : undefined;
}

function resolveArithmeticComponentwiseType(leftType: string, rightType: string): string | undefined {
  if (typesEquivalent(leftType, rightType)) {
    return isNumericType(leftType) ? canonicalTypeName(leftType) : undefined;
  }
  if (isNumericAggregateWithComponent(leftType, rightType)) {
    return leftType;
  }
  return isNumericAggregateWithComponent(rightType, leftType) ? rightType : undefined;
}

function resolveIntegerComponentwiseType(leftType: string, rightType: string): string | undefined {
  if (leftType === rightType) {
    return isIntegerType(leftType) ? leftType : undefined;
  }
  const leftVector = vectorType(leftType);
  if (leftVector && isIntegerType(leftType) && leftVector.componentType === rightType) {
    return leftType;
  }
  const rightVector = vectorType(rightType);
  return rightVector && isIntegerType(rightType) && rightVector.componentType === leftType
    ? rightType
    : undefined;
}

function resolveShiftType(leftType: string, rightType: string): string | undefined {
  if (!isIntegerType(leftType) || !isIntegerType(rightType)) {
    return undefined;
  }
  const leftVector = vectorType(leftType);
  const rightVector = vectorType(rightType);
  if (!leftVector) {
    return rightVector ? undefined : leftType;
  }
  return !rightVector || leftVector.size === rightVector.size ? leftType : undefined;
}

function resolveMultiplicationType(leftType: string, rightType: string): string | undefined {
  const leftMatrix = matrixType(leftType);
  const rightMatrix = matrixType(rightType);
  const leftVector = vectorType(leftType);
  const rightVector = vectorType(rightType);

  if (leftMatrix || rightMatrix) {
    if (leftMatrix && rightMatrix) {
      return leftMatrix.componentType === rightMatrix.componentType
        && leftMatrix.columns === rightMatrix.rows
        ? matrixTypeName(leftMatrix.componentType, rightMatrix.columns, leftMatrix.rows)
        : undefined;
    }
    if (leftMatrix && rightVector) {
      return leftMatrix.componentType === rightVector.componentType
        && leftMatrix.columns === rightVector.size
        ? vectorTypeName(leftMatrix.componentType, leftMatrix.rows)
        : undefined;
    }
    if (leftVector && rightMatrix) {
      return leftVector.componentType === rightMatrix.componentType
        && leftVector.size === rightMatrix.rows
        ? vectorTypeName(rightMatrix.componentType, rightMatrix.columns)
        : undefined;
    }
    if (leftMatrix && rightType === leftMatrix.componentType) {
      return leftType;
    }
    if (rightMatrix && leftType === rightMatrix.componentType) {
      return rightType;
    }
    return undefined;
  }

  return resolveArithmeticComponentwiseType(leftType, rightType);
}

function isNumericAggregateWithComponent(aggregateType: string, componentType: string): boolean {
  const vector = vectorType(aggregateType);
  const matrix = matrixType(aggregateType);
  return isNumericType(aggregateType)
    && (vector?.componentType === componentType || matrix?.componentType === componentType);
}

function indexedType(typeName: string): string | undefined {
  const arrayType = decodeArrayType(typeName);
  if (arrayType) {
    return arrayType.dimensions.length === 1 ? arrayType.elementType : undefined;
  }
  const vector = vectorType(typeName);
  if (vector) {
    return vector.componentType;
  }
  const matrix = /^(d?)mat([234])(?:x([234]))?$/.exec(typeName);
  if (matrix) {
    const rowCount = Number(matrix[3] ?? matrix[2]);
    return `${matrix[1]}vec${rowCount}`;
  }
  return undefined;
}

function isValidIndexType(typeName: string | undefined): boolean {
  return typeName === "int" || typeName === "uint";
}

interface MatrixType {
  readonly componentType: "float" | "double";
  readonly columns: number;
  readonly rows: number;
}

function matrixType(typeName: string): MatrixType | undefined {
  const match = /^(d?)mat([234])(?:x([234]))?$/.exec(typeName);
  if (!match) {
    return undefined;
  }
  return {
    componentType: match[1] === "d" ? "double" : "float",
    columns: Number(match[2]),
    rows: Number(match[3] ?? match[2]),
  };
}

function matrixTypeName(componentType: MatrixType["componentType"], columns: number, rows: number): string {
  const prefix = componentType === "double" ? "dmat" : "mat";
  return columns === rows ? `${prefix}${columns}` : `${prefix}${columns}x${rows}`;
}

function canonicalTypeName(typeName: string): string {
  const array = decodeArrayType(typeName);
  if (array) {
    return encodeArrayType(canonicalTypeName(array.elementType), array.dimensions);
  }
  const matrix = matrixType(typeName);
  return matrix
    ? matrixTypeName(matrix.componentType, matrix.columns, matrix.rows)
    : typeName;
}

function typesEquivalent(leftType: string, rightType: string | undefined): boolean {
  if (rightType === undefined) {
    return false;
  }
  const leftArray = decodeArrayType(leftType);
  const rightArray = decodeArrayType(rightType);
  if (leftArray || rightArray) {
    return leftArray !== undefined
      && rightArray !== undefined
      && leftArray.dimensions.every((extent) => extent !== undefined)
      && rightArray.dimensions.every((extent) => extent !== undefined)
      && canonicalTypeName(leftType) === canonicalTypeName(rightType);
  }
  return canonicalTypeName(leftType) === canonicalTypeName(rightType);
}

function isWebGlSemanticType(typeName: string): boolean {
  const array = decodeArrayType(typeName);
  return !array || array.dimensions.length === 1;
}

function isEqualityComparableType(typeName: string): boolean {
  const array = decodeArrayType(typeName);
  if (array) {
    return array.dimensions.length === 1
      && array.dimensions[0] !== undefined
      && isEqualityComparableType(array.elementType);
  }
  return /^(?:bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?)$/.test(canonicalTypeName(typeName));
}

function resolveSwizzleType(ownerType: string, selection: string): string | undefined {
  const vector = vectorType(ownerType);
  if (!vector || selection.length < 1 || selection.length > 4) {
    return undefined;
  }
  const componentSets = ["xyzw", "rgba", "stpq"];
  const componentSet = componentSets.find((set) => [...selection].every((component) => set.includes(component)));
  if (!componentSet || [...selection].some((component) => componentSet.indexOf(component) >= vector.size)) {
    return undefined;
  }
  return selection.length === 1
    ? vector.componentType
    : vectorTypeName(vector.componentType, selection.length);
}

function vectorType(typeName: string): { componentType: string; size: number } | undefined {
  const match = /^(b|i|u|d)?vec([234])$/.exec(typeName);
  if (!match) {
    return undefined;
  }
  const componentTypes: Readonly<Record<string, string>> = {
    "": "float",
    b: "bool",
    i: "int",
    u: "uint",
    d: "double",
  };
  return {
    componentType: componentTypes[match[1] ?? ""],
    size: Number(match[2]),
  };
}

function vectorTypeName(componentType: string, size: number): string | undefined {
  const prefixes: Readonly<Record<string, string>> = {
    bool: "b",
    int: "i",
    uint: "u",
    float: "",
    double: "d",
  };
  const prefix = prefixes[componentType];
  return prefix === undefined ? undefined : `${prefix}vec${size}`;
}

function isIntegerType(typeName: string): boolean {
  return /^(?:int|uint|[iu]vec[234])$/.test(typeName);
}

function isNumericScalarType(typeName: string): boolean {
  return /^(?:int|uint|float|double)$/.test(typeName);
}

function isNumericType(typeName: string): boolean {
  return /^(?:int|uint|float|double|[iud]?vec[234]|d?mat[234](?:x[234])?)$/.test(typeName);
}

function isBuiltinValueType(name: string): boolean {
  return /^(?:bool|int|uint|float|double|[biud]?vec[234]|d?mat[234](?:x[234])?)$/.test(name);
}

function resolveBindingTypeAtReference(
  scopes: readonly ParserScope[],
  metadata: ReadonlyMap<number, DeclarationMetadata>,
  bindingName: string,
  referenceOffset: number,
): string | undefined {
  for (const scope of scopes) {
    const entry = scope.bindings[bindingName];
    if (!entry?.declaration || !entry.references.some((reference) => (
      identifierNode(reference, bindingName)?.location?.start.offset === referenceOffset
    ))) {
      continue;
    }
    if (entry.declaration.type === "parameter_declaration") {
      const typeName = extractTypeName(entry.declaration.specifier);
      return typeName
        ? encodeArrayType(typeName, arrayQuantifierDimensions(entry.declaration))
        : undefined;
    }
    const declarationLocation = identifierNode(entry.declaration, bindingName)?.location;
    return declarationLocation
      ? metadata.get(declarationLocation.start.offset)?.resolvedTypeName
      : undefined;
  }
  return undefined;
}

function parserStage(stage: ShaderStage): "vertex" | "fragment" | "either" {
  if (stage === "vertex" || stage === "fragment") {
    return stage;
  }
  return "either";
}

function createDiagnostic(
  code: GlslParseDiagnostic["code"],
  error: unknown,
  originalLines: readonly string[],
  processedLines: readonly string[] = originalLines,
  processedToOriginal?: readonly number[],
): GlslParseDiagnostic {
  const failure = error instanceof Error ? error as ParserFailure : undefined;
  const rawRange = failure?.location;
  const range = rawRange
    ? code === "syntax"
      ? mapDiagnosticLocation(rawRange, originalLines, processedLines, processedToOriginal)
      : mapLocation(rawRange, originalLines, originalLines, processedToOriginal)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const adjustedRange = code === "syntax" && rawRange && parserLocationIsEmpty(rawRange)
    ? moveEofRangeToCode(range, originalLines)
    : range;
  return {
    code,
    message: failure?.message ?? String(error),
    range: adjustedRange,
    severity: 1,
  };
}

function mapDiagnosticLocation(
  location: ParserLocation,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal?: readonly number[],
): Range {
  const range = mapLocation(location, originalLines, processedLines, processedToOriginal);
  const processedLineIndex = Math.max(0, location.start.line - 1);
  if (
    location.start.line !== location.end.line
    || range.start.line !== range.end.line
    || parserLocationIsEmpty(location)
  ) {
    return range;
  }

  const original = originalLines[range.start.line] ?? "";
  const processed = processedLines[processedLineIndex] ?? "";
  const processedStart = Math.max(0, location.start.column - 1);
  const length = Math.max(1, location.end.column - location.start.column);
  const characterMaps = new Map<string, readonly number[]>();
  const characterMap = buildCharacterMap(original, processed);
  characterMaps.set(`${range.start.line}:${processedLineIndex}`, characterMap);
  const originalStart = mapProcessedSpanToOriginal(
    original,
    processed,
    processedStart,
    length,
    characterMap,
  );
  if (originalStart !== undefined) {
    return {
      start: { line: range.start.line, character: originalStart },
      end: { line: range.start.line, character: originalStart + length },
    };
  }
  return mapGeneratedLocation(
    location,
    originalLines,
    processedLines,
    processedToOriginal ?? processedLines.map((_, index) => index),
    characterMaps,
  );
}

function parserLocationIsEmpty(location: ParserLocation): boolean {
  return location.start.offset === location.end.offset;
}

function moveEofRangeToCode(range: Range, lines: readonly string[]): Range {
  let line = range.start.line;
  while (line > 0 && (lines[line] ?? "").trim() === "") {
    line--;
  }
  const character = lines[line]?.length ?? 0;
  return {
    start: { line, character },
    end: { line, character },
  };
}

function mapIdentifierLocation(
  location: ParserLocation,
  name: string,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[],
  characterMaps: Map<string, readonly number[]>,
): Range | undefined {
  const range = mapLocation(location, originalLines, processedLines, processedToOriginal);
  if (range.start.line !== range.end.line || !IDENTIFIER.test(name)) {
    return range;
  }
  const line = originalLines[range.start.line] ?? "";
  const matches = [...line.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))];
  if (matches.length === 0) {
    return undefined;
  }
  const processedLine = processedLines[Math.max(0, location.start.line - 1)] ?? "";
  const processedCharacter = Math.max(0, location.start.column - 1);
  const characterMapKey = `${range.start.line}:${Math.max(0, location.start.line - 1)}`;
  let characterMap = characterMaps.get(characterMapKey);
  if (!characterMap) {
    characterMap = buildCharacterMap(line, processedLine);
    characterMaps.set(characterMapKey, characterMap);
  }
  const alignedCharacter = mapProcessedSpanToOriginal(
    line,
    processedLine,
    processedCharacter,
    name.length,
    characterMap,
  );
  if (alignedCharacter !== undefined && line.slice(alignedCharacter, alignedCharacter + name.length) === name) {
    return {
      start: { line: range.start.line, character: alignedCharacter },
      end: { line: range.start.line, character: alignedCharacter + name.length },
    };
  }
  const processedMatches = [...processedLine.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))];
  const processedOccurrence = processedMatches.findIndex((match) => (
    (match.index ?? -1) <= processedCharacter
    && processedCharacter < (match.index ?? -1) + name.length
  ));
  if (processedOccurrence >= 0 && processedMatches.length === matches.length) {
    const character = matches[processedOccurrence].index ?? range.start.character;
    return {
      start: { line: range.start.line, character },
      end: { line: range.start.line, character: character + name.length },
    };
  }
  return undefined;
}

function mapProcessedSpanToOriginal(
  original: string,
  processed: string,
  processedStart: number,
  length: number,
  characterMap: readonly number[],
): number | undefined {
  if (processedStart + length > processed.length || original.length === 0) {
    return undefined;
  }
  const originalStart = characterMap[processedStart];
  if (originalStart === undefined || originalStart < 0) {
    return undefined;
  }
  for (let offset = 1; offset < length; offset++) {
    if (characterMap[processedStart + offset] !== originalStart + offset) {
      return undefined;
    }
  }
  return originalStart;
}

function mapGeneratedLocation(
  location: ParserLocation,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[],
  characterMaps: Map<string, readonly number[]>,
): Range {
  const range = mapLocation(location, originalLines, processedLines, processedToOriginal);
  if (range.start.line !== range.end.line) {
    return range;
  }
  const processedLineIndex = Math.max(0, location.start.line - 1);
  const original = originalLines[range.start.line] ?? "";
  const processed = processedLines[processedLineIndex] ?? "";
  const characterMapKey = `${range.start.line}:${processedLineIndex}`;
  let characterMap = characterMaps.get(characterMapKey);
  if (!characterMap) {
    characterMap = buildCharacterMap(original, processed);
    characterMaps.set(characterMapKey, characterMap);
  }

  const processedStart = Math.max(0, location.start.column - 1);
  const processedEnd = Math.max(processedStart, location.end.column - 1);
  let originalStart = 0;
  for (let index = processedStart - 1; index >= 0; index--) {
    const mapped = characterMap[index];
    if (mapped !== undefined && mapped >= 0) {
      originalStart = mapped + 1;
      break;
    }
  }
  let originalEnd = original.length;
  for (let index = processedEnd; index < characterMap.length; index++) {
    const mapped = characterMap[index];
    if (mapped !== undefined && mapped >= originalStart) {
      originalEnd = mapped;
      break;
    }
  }

  const replacement = original.slice(originalStart, originalEnd);
  const invocation = replacement.match(/[A-Za-z_]\w*/);
  if (invocation?.index !== undefined) {
    originalStart += invocation.index;
    originalEnd = originalStart + invocation[0].length;
  } else {
    const containingInvocation = findContainingInvocation(original, originalStart, originalEnd);
    if (containingInvocation) {
      originalStart = containingInvocation.start;
      originalEnd = containingInvocation.end;
    }
  }
  return {
    start: { line: range.start.line, character: originalStart },
    end: { line: range.start.line, character: Math.max(originalStart, originalEnd) },
  };
}

function findContainingInvocation(
  line: string,
  rangeStart: number,
  rangeEnd: number,
): { start: number; end: number } | undefined {
  const candidates: { start: number; end: number }[] = [];
  for (const match of line.matchAll(/\b[A-Za-z_]\w*\s*\(/g)) {
    const matchStart = match.index ?? -1;
    const open = matchStart + match[0].lastIndexOf("(");
    let depth = 0;
    let close = -1;
    for (let index = open; index < line.length; index++) {
      if (line[index] === "(") {
        depth++;
      }
      if (line[index] === ")") {
        depth--;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close >= 0 && rangeStart >= matchStart && rangeEnd <= close + 1) {
      const name = match[0].match(/[A-Za-z_]\w*/)?.[0];
      if (name) {
        candidates.push({ start: matchStart, end: matchStart + name.length });
      }
    }
  }
  return candidates[candidates.length - 1];
}

function buildCharacterMap(original: string, processed: string): number[] {
  const map = new Array(processed.length).fill(-1) as number[];
  let prefix = 0;
  while (prefix < original.length && prefix < processed.length && original[prefix] === processed[prefix]) {
    map[prefix] = prefix;
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < original.length - prefix
    && suffix < processed.length - prefix
    && original[original.length - suffix - 1] === processed[processed.length - suffix - 1]
  ) {
    map[processed.length - suffix - 1] = original.length - suffix - 1;
    suffix++;
  }

  const originalMiddle = original.slice(prefix, original.length - suffix);
  const processedMiddle = processed.slice(prefix, processed.length - suffix);
  const longestCommonSubsequence: number[][] = Array.from(
    { length: originalMiddle.length + 1 },
    () => new Array(processedMiddle.length + 1).fill(0) as number[],
  );
  for (let originalIndex = originalMiddle.length - 1; originalIndex >= 0; originalIndex--) {
    for (let processedIndex = processedMiddle.length - 1; processedIndex >= 0; processedIndex--) {
      longestCommonSubsequence[originalIndex][processedIndex] = originalMiddle[originalIndex] === processedMiddle[processedIndex]
        ? longestCommonSubsequence[originalIndex + 1][processedIndex + 1] + 1
        : Math.max(
          longestCommonSubsequence[originalIndex + 1][processedIndex],
          longestCommonSubsequence[originalIndex][processedIndex + 1],
        );
    }
  }

  let originalIndex = 0;
  let processedIndex = 0;
  while (originalIndex < originalMiddle.length && processedIndex < processedMiddle.length) {
    if (originalMiddle[originalIndex] === processedMiddle[processedIndex]) {
      map[prefix + processedIndex] = prefix + originalIndex;
      originalIndex++;
      processedIndex++;
    } else if (
      longestCommonSubsequence[originalIndex + 1][processedIndex]
      >= longestCommonSubsequence[originalIndex][processedIndex + 1]
    ) {
      originalIndex++;
    } else {
      processedIndex++;
    }
  }
  return map;
}

function mapLocation(
  location: ParserLocation | undefined,
  originalLines: readonly string[],
  processedLines: readonly string[],
  processedToOriginal: readonly number[] = processedLines.map((_, index) => index),
): Range {
  if (!location) {
    return sourceRange(originalLines);
  }
  const startProcessedLine = Math.max(0, location.start.line - 1);
  const endProcessedLine = Math.max(0, location.end.line - 1);
  const startLine = clampLine(
    mapProcessedLine(processedToOriginal, startProcessedLine),
    originalLines.length,
  );
  const endLine = clampLine(
    mapProcessedLine(processedToOriginal, endProcessedLine),
    originalLines.length,
  );
  return {
    start: {
      line: startLine,
      character: clampCharacter(location.start.column - 1, originalLines[startLine]),
    },
    end: {
      line: endLine,
      character: clampCharacter(location.end.column - 1, originalLines[endLine]),
    },
  };
}

function sourceRange(lines: readonly string[]): Range {
  const endLine = Math.max(0, lines.length - 1);
  return {
    start: { line: 0, character: 0 },
    end: { line: endLine, character: lines[endLine]?.length ?? 0 },
  };
}

function identifierNode(node: ParserNode | undefined, expectedName?: string): ParserNode | undefined {
  if (!node) {
    return undefined;
  }
  const ownName = identifierValue(node);
  if (ownName && (!expectedName || ownName === expectedName) && node.location) {
    return node;
  }

  for (const key of ["identifier", "prototype", "header", "name", "specifier"]) {
    const child = asNode(node[key]);
    const found = identifierNode(child, expectedName);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function identifierValue(node: ParserNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (typeof node.identifier === "string") {
    return node.identifier;
  }
  return undefined;
}

function literalValue(node: ParserNode | undefined): string | undefined {
  return node && typeof node.literal === "string" ? node.literal : undefined;
}

function extractTypeName(value: unknown): string | undefined {
  if (!isNode(value)) {
    return undefined;
  }
  if (typeof value.token === "string") {
    return value.token;
  }
  if (value.type === "type_name" && typeof value.identifier === "string") {
    return value.identifier;
  }
  if (value.type === "struct") {
    return identifierValue(asNode(value.typeName));
  }
  return extractTypeName(value.specifier);
}

function extractDeclarationMetadata(value: unknown): DeclarationMetadata {
  const typeName = extractTypeName(value);
  const anonymousStruct = findStructNode(value);
  return {
    typeName,
    resolvedTypeName: typeName ?? (anonymousStruct ? anonymousStructIdentity(anonymousStruct) : undefined),
  };
}

function withArrayDimensions(
  metadata: DeclarationMetadata,
  dimensions: readonly ArrayExtent[],
): DeclarationMetadata {
  return dimensions.length > 0 && metadata.resolvedTypeName
    ? { ...metadata, resolvedTypeName: encodeArrayType(metadata.resolvedTypeName, dimensions) }
    : metadata;
}

function arrayQuantifierDimensions(value: unknown): readonly ArrayExtent[] {
  if (!isNode(value)) {
    return [];
  }
  const quantifiers = Array.isArray(value.quantifier)
    ? value.quantifier.filter(isNode)
    : isNode(value.quantifier) ? [value.quantifier] : [];
  return [
    ...arrayQuantifierDimensions(value.specifier),
    ...quantifiers.map((quantifier) => arrayExtent(asNode(quantifier.expression))),
  ];
}

function arrayExtent(expression: ParserNode | undefined): ArrayExtent {
  if (!expression || expression.type !== "int_constant" || typeof expression.token !== "string") {
    return undefined;
  }
  return parseArrayExtentToken(expression.token);
}

function encodeArrayType(elementType: string, dimensions: readonly ArrayExtent[]): string {
  if (dimensions.length === 0) {
    return elementType;
  }
  const encodedDimensions = dimensions.map((extent) => extent ?? "?").join(",");
  return `${ARRAY_TYPE_PREFIX}${encodedDimensions}:${elementType}`;
}

function decodeArrayType(typeName: string): ResolvedArrayType | undefined {
  const match = /^@array:([^:]+):(.+)$/.exec(typeName);
  if (!match) {
    return undefined;
  }
  const dimensions = match[1].split(",").map((encoded): ArrayExtent | null => {
    if (encoded === "?") {
      return undefined;
    }
    if (!/^(?:0|[1-9]\d*)$/.test(encoded)) {
      return null;
    }
    const extent = Number(encoded);
    return Number.isSafeInteger(extent) ? extent : null;
  });
  if (dimensions.length === 0 || dimensions.some((extent) => extent === null)) {
    return undefined;
  }
  return {
    elementType: match[2],
    dimensions: dimensions as ArrayExtent[],
  };
}

function publicTypeName(typeName: string | undefined): string | undefined {
  if (!typeName) {
    return undefined;
  }
  const encodedTypeName = encodeParserArrayType(typeName) ?? typeName;
  const array = decodeArrayType(encodedTypeName);
  if (array) {
    const elementType = publicTypeName(array.elementType);
    return elementType
      ? `${elementType}${array.dimensions.map((extent) => `[${extent ?? ""}]`).join("")}`
      : undefined;
  }
  return encodedTypeName.startsWith("@anonymous-struct:")
    ? "anonymous struct"
    : encodedTypeName;
}

function encodeParserArrayType(typeName: string | undefined): string | undefined {
  if (!typeName) {
    return undefined;
  }
  const match = /^([^\[\]]+)((?:\[[^\[\]]*\])*)$/.exec(typeName);
  if (!match || match[2].length === 0) {
    return typeName;
  }
  const dimensions = [...match[2].matchAll(/\[([^\[\]]*)\]/g)]
    .map((quantifier): ArrayExtent => parserArrayExtent(quantifier[1]));
  return encodeArrayType(match[1], dimensions);
}

function parserArrayExtent(value: string): ArrayExtent {
  return parseArrayExtentToken(value);
}

function parseArrayExtentToken(value: string): ArrayExtent {
  const token = value.trim().replace(/[uU]$/, "");
  if (!/^(?:0[xX][0-9a-fA-F]+|0[0-7]*|[1-9]\d*)$/.test(token)) {
    return undefined;
  }
  const radix = /^0[xX]/.test(token) ? 16 : /^0[0-7]+$/.test(token) ? 8 : 10;
  const extent = Number.parseInt(token.replace(/^0[xX]/, ""), radix);
  return Number.isSafeInteger(extent) && extent >= 0 ? extent : undefined;
}

function findStructNode(value: unknown): ParserNode | undefined {
  if (!isNode(value)) {
    return undefined;
  }
  if (value.type === "struct") {
    return value;
  }
  return findStructNode(value.specifier);
}

function anonymousStructIdentity(node: ParserNode): string | undefined {
  return node.location
    ? `@anonymous-struct:${node.location.start.offset}:${node.location.end.offset}`
    : undefined;
}

function publicScopeName(name: string): string {
  return name.startsWith("@anonymous-struct:") ? "anonymous struct" : name;
}

function nodeArray(value: unknown): readonly ParserNode[] {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function asNode(value: unknown): ParserNode | undefined {
  return isNode(value) ? value : undefined;
}

function isNode(value: unknown): value is ParserNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPosition(source: string, position: Position): boolean {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character)) {
    return false;
  }
  const lines = source.split("\n");
  return position.line >= 0
    && position.line < lines.length
    && position.character >= 0
    && position.character <= lines[position.line].length;
}

function rangeContains(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) < 0;
}

function rangeContainsInclusiveEnd(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

function rangeContainsRange(outer: Range, inner: Range): boolean {
  return comparePosition(outer.start, inner.start) <= 0
    && comparePosition(inner.end, outer.end) <= 0;
}

function comparePosition(left: Position, right: Position): number {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}

function rangesEqual(left: Range, right: Range): boolean {
  return comparePosition(left.start, right.start) === 0 && comparePosition(left.end, right.end) === 0;
}

function deduplicateRanges(ranges: readonly Range[]): Range[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(0, Math.min(line, Math.max(0, lineCount - 1)));
}

function clampCharacter(character: number, line: string | undefined): number {
  return Math.max(0, Math.min(character, line?.length ?? 0));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function freezeRange(range: Range): Range {
  return Object.freeze({
    start: Object.freeze({ ...range.start }),
    end: Object.freeze({ ...range.end }),
  });
}

function freezeDocument(document: GlslAnalysisDocument): GlslAnalysisDocument {
  const symbols = document.symbols.map((symbol) => Object.freeze({
    ...symbol,
    declaration: freezeRange(symbol.declaration),
    definition: freezeRange(symbol.definition),
    references: Object.freeze(symbol.references.map(freezeRange)),
  }));
  const scopes = document.scopes.map((scope) => Object.freeze({
    ...scope,
    range: freezeRange(scope.range),
    symbolIds: Object.freeze([...scope.symbolIds]),
  }));
  const diagnostics = document.diagnostics.map((diagnostic) => Object.freeze({
    ...diagnostic,
    range: freezeRange(diagnostic.range),
  }));
  return Object.freeze({
    ...document,
    symbols: Object.freeze(symbols),
    scopes: Object.freeze(scopes),
    diagnostics: Object.freeze(diagnostics),
    originalToProcessed: Object.freeze([...document.originalToProcessed]),
    processedToOriginal: Object.freeze([...document.processedToOriginal]),
  });
}
