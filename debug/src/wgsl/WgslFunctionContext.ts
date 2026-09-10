import type { DebugFunctionContext, DebugLoopInfo, DebugParameterInfo } from "../glsl/types";
import { parseWgslDocument } from "@shader-studio/wgsl-analysis";
import { tokenizeWgsl } from "@shader-studio/wgsl-analysis";
import { comparePositions } from "./model";

/**
 * Describes the WGSL function enclosing a debug line for the parameters and
 * loop-caps UI: parameter defaults in WGSL expression syntax, loops enclosing
 * the line, and whether the callable is a plain helper (overridable) rather
 * than the render/compute entry.
 */
export function extractWgslFunctionContext(source: string, debugLine: number): DebugFunctionContext | null {
  const document = parseWgslDocument("/shader-studio/debug-context.wgsl", source, "fragment");
  const callable = document.scopes
    .filter((scope) => scope.kind === "function"
      && scope.range.start.line <= debugLine && scope.range.end.line >= debugLine)
    .sort((left, right) => rangeLineSpan(left.range) - rangeLineSpan(right.range))[0];
  if (!callable) return null;
  const symbol = document.symbols.find((candidate) => candidate.kind === "function" && candidate.name === callable.name);
  if (!symbol) return null;

  const parameters = document.symbols
    .filter((candidate) => candidate.kind === "parameter" && candidate.scopeId === callable.id
      && !isOutPointer(candidate.typeName))
    .map(toParameterInfo);
  const loops = document.statements
    .filter((statement) => (statement.kind === "for" || statement.kind === "while" || statement.kind === "loop")
      && containsScope(callable.range, statement.range))
    .sort((left, right) => comparePositions(left.range.start, right.range.start))
    .map((statement, loopIndex): DebugLoopInfo => ({
      loopIndex,
      lineNumber: statement.range.start.line,
      endLine: statement.range.end.line,
      loopHeader: source.split("\n")[statement.range.start.line]?.trim().replace(/\s*\{\s*$/, "") ?? statement.kind,
      maxIter: null,
    }))
    .filter((loop) => loop.lineNumber < debugLine && loop.endLine >= debugLine);

  return {
    functionName: callable.name,
    returnType: symbol.typeName ?? "void",
    parameters,
    isFunction: callable.name !== "mainImage" && !hasComputeAttribute(source, symbol.declaration.start),
    loops,
  };
}

/** `ptr<function, T>` is WGSL's only out-parameter form; it cannot take an override expression. */
function isOutPointer(typeName: string | undefined): boolean {
  return typeName !== undefined && /^\s*ptr\s*<\s*function\b/.test(typeName);
}

function hasComputeAttribute(source: string, declaration: { line: number; character: number }): boolean {
  const tokens = tokenizeWgsl(source);
  const nameIndex = tokens.findIndex((token) => token.line === declaration.line
    && token.character === declaration.character);
  if (nameIndex < 1 || tokens[nameIndex - 1]?.text !== "fn") {
    return false;
  }

  // Attributes may share the `fn` line, span arbitrary lines, and be separated
  // by comments. Search only the declaration's attribute run: the previous
  // top-level block/statement boundary prevents a preceding entry's attributes
  // from being attributed to a following helper.
  let boundary = nameIndex - 2;
  while (boundary >= 0 && tokens[boundary]?.text !== "}" && tokens[boundary]?.text !== ";") {
    boundary -= 1;
  }
  for (let index = boundary + 1; index < nameIndex - 1; index += 1) {
    if (tokens[index]?.kind === "attribute" && tokens[index + 1]?.text === "compute") {
      return true;
    }
  }
  return false;
}

function toParameterInfo(parameter: { name: string; typeName?: string }): DebugParameterInfo {
  const typeName = (parameter.typeName ?? "").trim();
  const uvValue = uvExpression(typeName);
  const centeredUvValue = centeredUvExpression(typeName);
  const defaultExpression = isVec2(typeName) ? uvValue : defaultExpressionForType(typeName);
  return {
    name: parameter.name,
    type: typeName,
    uvValue,
    centeredUvValue,
    defaultExpression,
    expression: defaultExpression,
  };
}

function isVec2(typeName: string): boolean {
  return typeName === "vec2f" || typeName === "vec2<f32>";
}

function uvExpression(typeName: string): string {
  switch (typeName) {
    case "vec2f":
    case "vec2<f32>": return "coord / iResolution.xy";
    case "f32": return "coord.x / iResolution.x";
    case "vec3f":
    case "vec3<f32>": return "vec3f(coord / iResolution.xy, 0.0)";
    case "vec4f":
    case "vec4<f32>": return "vec4f(coord / iResolution.xy, 0.0, 1.0)";
    case "i32": return "i32(coord.x / iResolution.x * 10.0)";
    case "u32": return "u32(coord.x / iResolution.x * 10.0)";
    case "bool": return "coord.x / iResolution.x > 0.5";
    default: return "";
  }
}

function centeredUvExpression(typeName: string): string {
  const centered = "(coord * 2.0 - iResolution.xy) / iResolution.y";
  switch (typeName) {
    case "vec2f":
    case "vec2<f32>": return centered;
    case "f32": return `${centered}.x`;
    case "vec3f":
    case "vec3<f32>": return `vec3f(${centered}, 0.0)`;
    case "vec4f":
    case "vec4<f32>": return `vec4f(${centered}, 0.0, 1.0)`;
    default: return uvExpression(typeName);
  }
}

function defaultExpressionForType(typeName: string): string {
  switch (typeName) {
    case "f32": return "0.5";
    case "vec2f":
    case "vec2<f32>": return "vec2f(0.5)";
    case "vec3f":
    case "vec3<f32>": return "vec3f(0.5)";
    case "vec4f":
    case "vec4<f32>": return "vec4f(0.5)";
    case "i32": return "1";
    case "u32": return "1u";
    case "bool": return "true";
    default: return `${typeName}(0)`;
  }
}

function rangeLineSpan(range: { start: { line: number }; end: { line: number } }): number {
  return range.end.line - range.start.line;
}

function containsScope(
  outer: { start: { line: number; character: number }; end: { line: number; character: number } },
  inner: { start: { line: number; character: number }; end: { line: number; character: number } },
): boolean {
  return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}
