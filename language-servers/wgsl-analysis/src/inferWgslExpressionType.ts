import type { WgslExpression } from "./parseWgslDocument.js";
import {
  isBuiltinValueType,
  matrixType,
  parseWgslArrayType,
  parseWgslPointerType,
  resolveSwizzleType,
  vectorType,
  vectorTypeName,
} from "./wgslTypes.js";

export interface WgslExpressionInferenceContext {
  readonly valueType: (name: string) => string | undefined;
  readonly functionType: (name: string) => string | undefined;
  readonly aliasType: (name: string) => string | undefined;
  readonly fieldType: (owner: string, field: string) => string | undefined;
  readonly hasType: (name: string) => boolean;
}

const COMPARISON_OPERATORS = new Set(["==", "!=", "<", ">", "<=", ">="]);
const ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/", "%", "|", "&", "^", "<<", ">>"]);
const WGSL_SCALARS = new Set(["bool", "i32", "u32", "f32", "f16"]);
const INTEGER_BUILTINS = new Set(["countLeadingZeros", "countTrailingZeros", "countOneBits", "reverseBits"]);
const TYPE_PRESERVING_BUILTINS = new Set([
  "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh",
  "ceil", "cos", "cosh", "degrees", "dpdx", "dpdy", "exp", "exp2",
  "floor", "fract", "fwidth", "inverseSqrt", "log", "log2",
  "normalize", "quantizeToF16", "radians", "round", "saturate",
  "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc",
]);
const VARIADIC_MATH_BUILTINS = new Set([
  "atan2", "clamp", "cross", "faceForward", "fma", "ldexp",
  "max", "min", "mix", "pow", "reflect", "refract", "remainder",
  "smoothstep", "step",
]);

/** Conservatively infers the type of one parsed WGSL expression. */
export function inferWgslExpressionType(
  expression: WgslExpression,
  context: WgslExpressionInferenceContext,
  depth = 0,
): string | undefined {
  if (depth > 24) {
    return undefined;
  }
  const infer = (child: WgslExpression) => inferWgslExpressionType(child, context, depth + 1);
  switch (expression.kind) {
    case "identifier":
      return context.valueType(expression.name);
    case "literal":
      return scalarLiteralType(expression.text);
    case "call":
      return inferCall(expression, context, infer);
    case "member": {
      const owner = infer(expression.object);
      if (!owner) {
        return undefined;
      }
      const resolved = resolveAlias(owner, context);
      return resolveSwizzleType(resolved, expression.member) ?? context.fieldType(resolved, expression.member);
    }
    case "index": {
      const owner = infer(expression.object);
      if (!owner) {
        return undefined;
      }
      const resolved = resolveAlias(owner, context);
      const matrix = matrixType(resolved);
      return parseWgslArrayType(resolved)?.elementType ?? vectorType(resolved)?.componentType
        ?? (matrix ? vectorTypeName(matrix.componentType, matrix.rows) : undefined);
    }
    case "unary": {
      const operand = infer(expression.operand);
      if (!operand) {
        return undefined;
      }
      const resolved = resolveAlias(operand, context);
      if (expression.operator === "!") {
        const vector = vectorType(resolved);
        return resolved === "bool" ? "bool" : vector?.componentType === "bool" ? vectorTypeName("bool", vector.size) : undefined;
      }
      if (expression.operator === "-" || expression.operator === "+" || expression.operator === "~") {
        return resolved;
      }
      return expression.operator === "*" ? parseWgslPointerType(resolved)?.elementType : undefined;
    }
    case "binary":
      return inferBinary(expression, context, infer);
  }
}

function inferCall(
  expression: Extract<WgslExpression, { kind: "call" }>,
  context: WgslExpressionInferenceContext,
  infer: (expression: WgslExpression) => string | undefined,
): string | undefined {
  if (isBuiltinValueType(expression.name)) {
    return expression.name;
  }
  const callee = expression.callee ?? expression.name;
  const arguments_ = expression.args.map((argument) => infer(argument));
  const resolved = arguments_.map((argument) => argument === undefined ? undefined : resolveAlias(argument, context));
  if (callee === "bitcast") {
    const target = expression.templateArguments?.length === 1 ? resolveAlias(expression.templateArguments[0]!, context) : undefined;
    return expression.args.length === 1 && resolved[0] !== undefined && target !== undefined && isNumericScalarOrVector(target)
      ? target
      : undefined;
  }
  if (TYPE_PRESERVING_BUILTINS.has(callee)) {
    return resolved.length === 1 ? resolved[0] : undefined;
  }
  if (INTEGER_BUILTINS.has(callee)) {
    return resolved.length === 1 && resolved[0] !== undefined && isIntegerScalarOrVector(resolved[0]) ? resolved[0] : undefined;
  }
  if (callee === "transpose") {
    const matrix = resolved.length === 1 && resolved[0] !== undefined ? matrixType(resolved[0]) : undefined;
    return matrix ? matrixTypeName(matrix.componentType, matrix.rows, matrix.columns) : undefined;
  }
  if (callee === "determinant") {
    const matrix = resolved.length === 1 && resolved[0] !== undefined ? matrixType(resolved[0]) : undefined;
    return matrix && matrix.columns === matrix.rows ? matrix.componentType : undefined;
  }
  if (callee === "arrayLength") {
    return expression.args.length === 1 ? "u32" : undefined;
  }
  if (callee === "select") {
    const [falseValue, trueValue, condition] = resolved;
    return resolved.length === 3 && falseValue !== undefined && trueValue !== undefined && condition !== undefined
      && sameWgslType(falseValue, trueValue) ? falseValue : undefined;
  }
  if (callee === "dot" || callee === "distance") {
    const [left, right] = resolved;
    const vector = left !== undefined ? vectorType(left) : undefined;
    return resolved.length === 2 && left !== undefined && right !== undefined && vector && sameWgslType(left, right)
      ? vector.componentType : undefined;
  }
  if (callee === "length") {
    const vector = resolved.length === 1 && resolved[0] !== undefined ? vectorType(resolved[0]) : undefined;
    return vector?.componentType;
  }
  if (VARIADIC_MATH_BUILTINS.has(callee) && resolved.length > 0 && resolved.every((item): item is string => item !== undefined)) {
    if (resolved.every((item) => sameWgslType(item, resolved[0]!))) {
      return resolved[0];
    }
    const vectors = resolved.filter((item) => vectorType(item) !== undefined);
    if (vectors.length > 0 && vectors.every((item) => sameWgslType(item, vectors[0]!))
      && resolved.every((item) => sameWgslType(item, vectors[0]!) || isWgslScalarType(item))) {
      return vectors[0];
    }
    return undefined;
  }
  const functionType = context.functionType(callee);
  if (functionType !== undefined && isConcreteTypeName(functionType)) {
    return functionType;
  }
  return context.hasType(callee) ? callee : undefined;
}

function inferBinary(
  expression: Extract<WgslExpression, { kind: "binary" }>,
  context: WgslExpressionInferenceContext,
  infer: (expression: WgslExpression) => string | undefined,
): string | undefined {
  const inferredLeft = infer(expression.left);
  const inferredRight = infer(expression.right);
  if (!inferredLeft || !inferredRight) {
    return undefined;
  }
  const left = resolveAlias(inferredLeft, context);
  const right = resolveAlias(inferredRight, context);
  if (COMPARISON_OPERATORS.has(expression.operator)) {
    if (!sameWgslType(left, right)) {
      return undefined;
    }
    const vector = vectorType(left);
    return vector ? vectorTypeName("bool", vector.size) : isWgslScalarType(left) ? "bool" : undefined;
  }
  if (expression.operator === "&&" || expression.operator === "||") {
    return left === "bool" && right === "bool" ? "bool" : undefined;
  }
  if (!ARITHMETIC_OPERATORS.has(expression.operator)) {
    return undefined;
  }
  if (sameWgslType(left, right)) {
    return left;
  }
  if (expression.operator === "*") {
    const leftMatrix = matrixType(left);
    const rightMatrix = matrixType(right);
    if (leftMatrix && scalarMatchesComponent(expression.right, right, leftMatrix.componentType)) {
      return left;
    }
    if (rightMatrix && scalarMatchesComponent(expression.left, left, rightMatrix.componentType)) {
      return right;
    }
  }
  const rightVector = vectorType(right);
  if (rightVector && scalarMatchesComponent(expression.left, left, rightVector.componentType)) {
    return right;
  }
  const leftVector = vectorType(left);
  return leftVector && scalarMatchesComponent(expression.right, right, leftVector.componentType) ? left : undefined;
}

function resolveAlias(typeName: string, context: WgslExpressionInferenceContext): string {
  const visited = new Set<string>();
  let resolved = typeName;
  while (!visited.has(resolved)) {
    visited.add(resolved);
    const next = context.aliasType(resolved);
    if (!next) {
      break;
    }
    resolved = next;
  }
  return resolved;
}

function scalarMatchesComponent(expression: WgslExpression, scalar: string, component: string): boolean {
  if (!isWgslScalarType(scalar) || scalar === "bool") {
    return false;
  }
  if (scalar === component) {
    return true;
  }
  if (expression.kind !== "literal") {
    return false;
  }
  return isUnsuffixedIntegerLiteral(expression.text)
    ? component !== "bool"
    : isUnsuffixedFloatLiteral(expression.text) && (component === "f32" || component === "f16");
}

function isUnsuffixedIntegerLiteral(text: string): boolean {
  return /^\d+$/.test(text.trim());
}

function isUnsuffixedFloatLiteral(text: string): boolean {
  return /^(?:\d+\.\d*|\.\d+|\d+[eE][-+]?\d+)$/.test(text.trim());
}

function isIntegerScalarOrVector(typeName: string): boolean {
  const vector = vectorType(typeName);
  return typeName === "i32" || typeName === "u32" || vector?.componentType === "i32" || vector?.componentType === "u32";
}

function isNumericScalarOrVector(typeName: string): boolean {
  const vector = vectorType(typeName);
  return ["i32", "u32", "f32", "f16"].includes(typeName)
    || (vector !== undefined && ["i32", "u32", "f32", "f16"].includes(vector.componentType));
}

function matrixTypeName(componentType: "f32" | "f16", columns: number, rows: number): string {
  return `mat${columns}x${rows}${componentType === "f16" ? "h" : "f"}`;
}

function sameWgslType(left: string, right: string): boolean {
  return canonicalTypeKey(left) === canonicalTypeKey(right);
}

function canonicalTypeKey(typeName: string): string {
  const vector = vectorType(typeName.trim());
  if (vector) {
    return `vec${vector.size}<${vector.componentType}>`;
  }
  const matrix = matrixType(typeName.trim());
  return matrix ? `mat${matrix.columns}x${matrix.rows}<${matrix.componentType}>` : typeName.trim();
}

function isConcreteTypeName(typeName: string): boolean {
  return isBuiltinValueType(typeName) || (/^[A-Za-z_]\w+$/.test(typeName) && !/^[A-Z]$/.test(typeName));
}

function isWgslScalarType(typeName: string): boolean {
  return WGSL_SCALARS.has(typeName.trim());
}

function scalarLiteralType(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "true" || trimmed === "false") {
    return "bool";
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(trimmed) || /^\d+i$/.test(trimmed)) {
    return "i32";
  }
  if (/^\d+u$/.test(trimmed)) {
    return "u32";
  }
  if (/^\d+h$/.test(trimmed) || /^(\d+\.\d*|\.\d+|\d+[eE])[^a-zA-Z]*h$/.test(trimmed)) {
    return "f16";
  }
  if (/^(\d+\.\d*|\.\d+|\d+[eE][-+]?\d+|\d+f)$/.test(trimmed)) {
    return "f32";
  }
  return /^\d+$/.test(trimmed) ? "i32" : undefined;
}
