import type { ArrayExtent, DeclarationMetadata, FieldMetadata, FieldReferenceMetadata, ParserFunctionDefinition, ParserNode, ParserScope, ResolvedArrayType } from "./GlslParserAst.js";
import { anonymousStructIdentity, asNode, findStructNode, identifierNode, identifierValue, isNode, literalValue, nodeArray } from "./GlslParserAst.js";
import {
  isBuiltinValueType,
  matrixType,
  matrixTypeName,
  resolveSwizzleType,
  vectorType,
  vectorTypeName
} from "./glslTypes.js";

const ARRAY_TYPE_PREFIX = "@array:";

export function flattenPostfixOperations(node: ParserNode | undefined): ParserNode[] {
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

export function resolveFieldOwnerType(
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

export function resolveExpressionType(
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

export function resolvedFunctionReturnType(definition: ParserFunctionDefinition): string | undefined {
  const prototype = asNode(definition.declaration?.prototype);
  const header = asNode(prototype?.header);
  const returnType = extractTypeName(header?.returnType);
  return returnType
    ? encodeArrayType(returnType, arrayQuantifierDimensions(header?.returnType))
    : encodeParserArrayType(normalizeParserType(definition.returnType));
}

export function selectFunctionDefinition(
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

export function functionParameterTypes(definition: ParserFunctionDefinition): readonly string[] {
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

function isIntegerType(typeName: string): boolean {
  return /^(?:int|uint|[iu]vec[234])$/.test(typeName);
}

function isNumericScalarType(typeName: string): boolean {
  return /^(?:int|uint|float|double)$/.test(typeName);
}

function isNumericType(typeName: string): boolean {
  return /^(?:int|uint|float|double|[iud]?vec[234]|d?mat[234](?:x[234])?)$/.test(typeName);
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

function normalizeParserType(typeName: string | undefined): string | undefined {
  return typeName && typeName !== "undefined" && typeName !== "UNKNOWN TYPE"
    ? typeName
    : undefined;
}

export function extractTypeName(value: unknown): string | undefined {
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

export function extractDeclarationMetadata(value: unknown): DeclarationMetadata {
  const typeName = extractTypeName(value);
  const anonymousStruct = findStructNode(value);
  return {
    typeName,
    resolvedTypeName: typeName ?? (anonymousStruct ? anonymousStructIdentity(anonymousStruct) : undefined),
  };
}

export function withArrayDimensions(
  metadata: DeclarationMetadata,
  dimensions: readonly ArrayExtent[],
): DeclarationMetadata {
  return dimensions.length > 0 && metadata.resolvedTypeName
    ? { ...metadata, resolvedTypeName: encodeArrayType(metadata.resolvedTypeName, dimensions) }
    : metadata;
}

export function arrayQuantifierDimensions(value: unknown): readonly ArrayExtent[] {
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

export function encodeArrayType(elementType: string, dimensions: readonly ArrayExtent[]): string {
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

export function publicTypeName(typeName: string | undefined): string | undefined {
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
