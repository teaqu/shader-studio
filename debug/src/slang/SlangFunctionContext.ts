import type { DebugFunctionContext, DebugLoopInfo, DebugParameterInfo } from "../glsl/types";
import { createSlangWorkspace } from "./SlangWorkspace";

export function extractSlangFunctionContext(source: string, debugLine: number): DebugFunctionContext | null {
  const path = "/shader-studio/debug-context.slang";
  const created = createSlangWorkspace({
    rootUri: path,
    rootPath: path,
    passName: "Image",
    contentHash: "context0",
    files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }],
  });
  if (!created.ok) return null;
  const file = created.workspace.filesByUri.get(created.workspace.rootUri);
  if (!file) return null;
  const callable = [...file.structure.callables.values()]
    .filter((candidate) => candidate.bodyRange.start.line <= debugLine && candidate.bodyRange.end.line >= debugLine)
    .sort((left, right) => rangeLineSpan(left.bodyRange) - rangeLineSpan(right.bodyRange))[0];
  if (!callable) return null;

  const parameters = callable.parameters
    .filter((parameter) => parameter.access !== "write")
    .map(toParameterInfo);
  const loopNodes = [...file.structure.controlFlows.values()]
    .filter((control) => control.kind === "for" || control.kind === "while" || control.kind === "do")
    .filter((control) => containsRange(callable.bodyRange, control.range))
    .sort((left, right) => comparePosition(left.range.start, right.range.start));
  const loops = loopNodes
    .map((control, loopIndex): DebugLoopInfo => ({
      loopIndex,
      lineNumber: control.range.start.line,
      endLine: control.range.end.line,
      loopHeader: source.split("\n")[control.range.start.line]?.trim().replace(/\s*\{\s*$/, "") ?? control.kind,
      maxIter: null,
    }))
    .filter((loop) => loop.lineNumber < debugLine && loop.endLine >= debugLine);

  return {
    functionName: callable.name,
    returnType: callable.returnTypeName,
    parameters,
    isFunction: callable.name !== "mainImage"
      && !callable.attributes.some((attribute) => /^shader\s*\(\s*["']compute["']\s*\)$/i.test(attribute)),
    loops,
  };
}

function toParameterInfo(parameter: { name: string; typeName: string }): DebugParameterInfo {
  const uvValue = uvExpression(parameter.typeName);
  const centeredUvValue = centeredUvExpression(parameter.typeName);
  const defaultExpression = parameter.typeName === "float2" ? uvValue : defaultExpressionForType(parameter.typeName);
  return {
    name: parameter.name,
    type: parameter.typeName,
    uvValue,
    centeredUvValue,
    defaultExpression,
    expression: defaultExpression,
  };
}

function uvExpression(typeName: string): string {
  switch (typeName) {
    case "float2": return "fragCoord / iResolution.xy";
    case "float": return "fragCoord.x / iResolution.x";
    case "float3": return "float3(fragCoord / iResolution.xy, 0.0)";
    case "float4": return "float4(fragCoord / iResolution.xy, 0.0, 1.0)";
    case "int": return "int(fragCoord.x / iResolution.x * 10.0)";
    case "bool": return "fragCoord.x / iResolution.x > 0.5";
    default: return "";
  }
}

function centeredUvExpression(typeName: string): string {
  const centered = "(fragCoord * 2.0 - iResolution.xy) / iResolution.y";
  switch (typeName) {
    case "float2": return centered;
    case "float": return `${centered}.x`;
    case "float3": return `float3(${centered}, 0.0)`;
    case "float4": return `float4(${centered}, 0.0, 1.0)`;
    default: return uvExpression(typeName);
  }
}

function defaultExpressionForType(typeName: string): string {
  switch (typeName) {
    case "float": return "0.5";
    case "float2": return "float2(0.5)";
    case "float3": return "float3(0.5)";
    case "float4": return "float4(0.5)";
    case "int": return "1";
    case "uint": return "1u";
    case "bool": return "true";
    case "float2x2": return "float2x2(1.0)";
    case "float3x3": return "float3x3(1.0)";
    case "float4x4": return "float4x4(1.0)";
    default: return `${typeName}(0)`;
  }
}

function rangeLineSpan(range: { start: { line: number }; end: { line: number } }): number {
  return range.end.line - range.start.line;
}

function containsRange(
  outer: { start: { line: number; character: number }; end: { line: number; character: number } },
  inner: { start: { line: number; character: number }; end: { line: number; character: number } },
): boolean {
  return comparePosition(outer.start, inner.start) <= 0 && comparePosition(outer.end, inner.end) >= 0;
}

function comparePosition(
  left: { line: number; character: number },
  right: { line: number; character: number },
): number {
  return left.line - right.line || left.character - right.character;
}
