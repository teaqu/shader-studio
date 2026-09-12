import {
  SlangDebugEngine,
  WgslDebugEngine,
  applySlangFullShaderPostProcessing,
  applyWgslFullShaderPostProcessing,
  extractSlangFunctionContext,
  extractWgslFunctionContext,
} from "@shader-studio/debug";
import type {
  DebugAnalysisRequest,
  DebugDiagnostic,
  DebugPlanResult,
  DebugPreviewOptions,
  DebugSourceRange,
  ShaderConfig,
  ShaderDebugEngine,
  ShaderLanguageId,
  SlangSourceModule,
} from "@shader-studio/types";
import type { DebugFunctionContext, NormalizeMode } from "./types/ShaderDebugState";
import type { DebugTarget } from "./ShaderDebugManager";

/** Engine surface the debug strategies need, including inspector previews. */
export type PlanCapableDebugEngine = ShaderDebugEngine & {
  planPreviewValue(
    request: DebugAnalysisRequest,
    valueId: string,
    options: DebugPreviewOptions,
  ): DebugPlanResult;
};

export interface VariablePreviewSelection {
  filePath: string | null;
  debugLine: number;
}

/** Everything a strategy needs from the manager to build a debug request. */
export interface DebugRequestInputs {
  imageCode: string;
  config: ShaderConfig | null;
  originalImageCode: string;
  lineOverride?: number;
  currentLine: number;
  lineContent: string;
  filePath: string | null;
  variablePreview: VariablePreviewSelection | null;
  imagePassPath: string | null;
  bufferPathMap: Record<string, string>;
  bufferCodes: Record<string, string>;
  slangModules: SlangSourceModule[];
  getDebugTarget: (imageCode: string, config: ShaderConfig | null) => DebugTarget;
}

export interface DebugPlanStrategy {
  readonly engine: PlanCapableDebugEngine;
  /** Human language name for user-facing messages. */
  readonly label: string;
  buildRequest(inputs: DebugRequestInputs): DebugAnalysisRequest | null;
  buildPreviewOptions(inputs: {
    normalizeMode: NormalizeMode;
    stepEdge: number | null;
    functionContext: DebugFunctionContext | null;
    customParameters: ReadonlyMap<number, string>;
    loopMaxIterations: ReadonlyMap<number, number>;
  }): DebugPreviewOptions;
  staleVariableError(request: DebugAnalysisRequest, selectedRange: DebugSourceRange, varName: string): DebugDiagnostic;
  postProcessFullShader(
    code: string,
    normalizeMode: NormalizeMode,
    stepEdge: number | null,
  ): string | null;
  extractFunctionContext(code: string, line: number): DebugFunctionContext | null;
}

class SlangDebugStrategy implements DebugPlanStrategy {
  readonly engine: PlanCapableDebugEngine = new SlangDebugEngine();
  readonly label = "Slang";

  buildRequest(inputs: DebugRequestInputs): DebugAnalysisRequest | null {
    const target = inputs.getDebugTarget(inputs.imageCode, inputs.config);
    const isCommonTarget = target.passName === "common";
    const ownerPassName = isCommonTarget ? "Image" : target.passName;
    const rootPath = ownerPassName === "Image" ? inputs.imagePassPath : inputs.bufferPathMap[ownerPassName];
    if (!rootPath) {
      return null;
    }
    const rootSource = ownerPassName === "Image" ? inputs.imageCode : inputs.bufferCodes[ownerPassName] ?? inputs.imageCode;
    const commonPath = inputs.bufferPathMap.common;
    const commonSource = inputs.bufferCodes.common;
    const files = [
      { uri: rootPath, path: rootPath, source: rootSource, version: 1, moduleName: "", ownerPass: ownerPassName },
      ...(isCommonTarget && commonPath && commonSource !== undefined
        ? [{ uri: commonPath, path: commonPath, source: commonSource, version: 1, moduleName: "", ownerPass: ownerPassName }]
        : []),
      ...inputs.slangModules.filter((module) => module.ownerPass === ownerPassName).map((module) => ({ ...module, uri: module.path, version: 1 })),
    ];
    const selectedPath = inputs.variablePreview?.filePath ?? inputs.filePath ?? rootPath;
    const rawLine = inputs.lineOverride ?? inputs.variablePreview?.debugLine ?? inputs.currentLine;
    const selectedLine = rawLine + (
      selectedPath === rootPath && pathsEqual(rootPath, inputs.imagePassPath ?? "")
        ? computeSlangLineOffset(inputs.imageCode, inputs.originalImageCode)
        : 0
    );
    const selectedSource = selectedPath === rootPath
      ? rootSource
      : isCommonTarget && commonPath && pathsEqual(selectedPath, commonPath)
        ? commonSource ?? ""
        : inputs.slangModules.find((module) => pathsEqual(module.path, selectedPath ?? ""))?.source ?? "";
    const selectedLineContent = selectedSource.split("\n")[selectedLine] ?? inputs.lineContent ?? "";
    return {
      workspace: { rootUri: rootPath, rootPath, passName: ownerPassName, files, contentHash: debugWorkspaceHash(files) },
      sourceUri: selectedPath,
      position: { line: selectedLine, character: Math.max(0, selectedLineContent.search(/\S/)) },
    };
  }

  buildPreviewOptions(inputs: {
    normalizeMode: NormalizeMode;
    stepEdge: number | null;
    functionContext: DebugFunctionContext | null;
    customParameters: ReadonlyMap<number, string>;
    loopMaxIterations: ReadonlyMap<number, number>;
  }): DebugPreviewOptions {
    return {
      normalizeMode: inputs.normalizeMode,
      stepEdge: inputs.stepEdge,
      customParameters: effectiveDebugParameters(inputs.functionContext, inputs.customParameters),
      loopMaxIterations: inputs.loopMaxIterations,
    };
  }

  staleVariableError(request: DebugAnalysisRequest, selectedRange: DebugSourceRange, varName: string): DebugDiagnostic {
    return {
      code: "slang-debug-stale-request",
      message: `The selected variable '${varName}' is no longer visible at this location.`,
      sourceUri: request.sourceUri,
      range: selectedRange,
    };
  }

  postProcessFullShader(code: string, normalizeMode: NormalizeMode, stepEdge: number | null): string | null {
    return applySlangFullShaderPostProcessing(code, { normalizeMode, stepEdge });
  }

  extractFunctionContext(code: string, line: number): DebugFunctionContext | null {
    return extractSlangFunctionContext(code, line);
  }
}

class WgslDebugStrategy implements DebugPlanStrategy {
  readonly engine: PlanCapableDebugEngine = new WgslDebugEngine();
  readonly label = "WGSL";

  buildRequest(inputs: DebugRequestInputs): DebugAnalysisRequest | null {
    const target = inputs.getDebugTarget(inputs.imageCode, inputs.config);
    const ownerPassName = target.passName === "common" ? "Image" : target.passName;
    const rootPath = ownerPassName === "Image" ? inputs.imagePassPath : inputs.bufferPathMap[ownerPassName];
    if (!rootPath) {
      return null;
    }
    const rootSource = ownerPassName === "Image" ? inputs.imageCode : inputs.bufferCodes[ownerPassName] ?? inputs.imageCode;
    const selectedPath = inputs.variablePreview?.filePath ?? inputs.filePath ?? rootPath;
    const commonPath = inputs.bufferPathMap.common;
    const commonSource = inputs.bufferCodes.common;
    const files = [
      { uri: rootPath, path: rootPath, source: rootSource, version: 1, moduleName: "", ownerPass: ownerPassName },
      ...(commonPath && commonSource !== undefined && !pathsEqual(commonPath, rootPath)
        ? [{ uri: commonPath, path: commonPath, source: commonSource, version: 1, moduleName: "", ownerPass: ownerPassName }]
        : []),
    ];
    const selectedSource = files.find(file => pathsEqual(file.path, selectedPath))?.source;
    if (selectedSource === undefined) {
      return null;
    }
    const rawLine = inputs.lineOverride ?? inputs.variablePreview?.debugLine ?? inputs.currentLine;
    const selectedLineContent = selectedSource.split("\n")[rawLine] ?? inputs.lineContent ?? "";
    const computePass = inputs.config?.passes[ownerPassName];
    const compute = computePass && "type" in computePass && computePass.type === "compute"
      ? {
        ...(computePass.entryPoint ? { entryPoint: computePass.entryPoint } : {}),
        storageNames: Object.keys(inputs.config?.storage ?? {}),
      }
      : undefined;
    const storage = Object.fromEntries(Object.entries(inputs.config?.storage ?? {})
      .map(([name, declaration]) => [name, { elementType: declaration.elementType }]));
    return {
      workspace: {
        rootUri: rootPath,
        rootPath,
        passName: ownerPassName,
        ...(compute ? { compute } : {}),
        storage,
        files,
        contentHash: debugWorkspaceHash(files, compute, storage),
      },
      sourceUri: selectedPath,
      position: { line: rawLine, character: Math.max(0, selectedLineContent.search(/\S/)) },
    };
  }

  buildPreviewOptions(inputs: {
    normalizeMode: NormalizeMode;
    stepEdge: number | null;
    functionContext: DebugFunctionContext | null;
    customParameters: ReadonlyMap<number, string>;
    loopMaxIterations: ReadonlyMap<number, number>;
  }): DebugPreviewOptions {
    return {
      normalizeMode: inputs.normalizeMode,
      stepEdge: inputs.stepEdge,
      customParameters: effectiveDebugParameters(inputs.functionContext, inputs.customParameters),
      loopMaxIterations: inputs.loopMaxIterations,
    };
  }

  staleVariableError(request: DebugAnalysisRequest, selectedRange: DebugSourceRange, varName: string): DebugDiagnostic {
    return {
      code: "wgsl-debug-stale-request",
      message: `The selected variable '${varName}' is no longer visible at this location.`,
      sourceUri: request.sourceUri,
      range: selectedRange,
    };
  }

  postProcessFullShader(code: string, normalizeMode: NormalizeMode, stepEdge: number | null): string | null {
    return applyWgslFullShaderPostProcessing(code, { normalizeMode, stepEdge });
  }

  extractFunctionContext(code: string, line: number): DebugFunctionContext | null {
    return extractWgslFunctionContext(code, line);
  }
}

const STRATEGIES: Record<string, DebugPlanStrategy> = {
  slang: new SlangDebugStrategy(),
  wgsl: new WgslDebugStrategy(),
};

/** Plan-based debugging strategy for language, or null for GLSL source rewriting. */
export function debugPlanStrategy(language: ShaderLanguageId): DebugPlanStrategy | null {
  return STRATEGIES[language] ?? null;
}

function pathsEqual(firstPath: string, secondPath: string): boolean {
  return firstPath.replace(/\\/g, "/") === secondPath.replace(/\\/g, "/");
}

function debugWorkspaceHash(
  files: Array<{ path: string; source: string; version: number }>,
  compute?: { entryPoint?: string; storageNames?: string[] },
  storage?: Record<string, { elementType: string }>,
): string {
  let hash = 2166136261;
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    for (const character of `${file.path}\0${file.version}\0${file.source}`) {
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    }
  }
  for (const character of JSON.stringify({ compute, storage })) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function computeSlangLineOffset(processed: string, original: string): number {
  const processedLines = processed.split("\n");
  const originalLines = original.split("\n");
  for (let index = 0; index < originalLines.length; index += 1) {
    const trimmed = originalLines[index].trim();
    if (!trimmed || originalLines.filter((line) => line.trim() === trimmed).length !== 1) {
      continue;
    }
    const processedIndex = processedLines.findIndex((line) => line.trim() === trimmed);
    if (processedIndex >= 0 && processedIndex !== index) {
      return processedIndex - index;
    }
  }
  return 0;
}

function effectiveDebugParameters(
  functionContext: DebugFunctionContext | null,
  customParameters: ReadonlyMap<number, string>,
): ReadonlyMap<number, string> {
  const effective = new Map<number, string>();
  if (functionContext?.isFunction) {
    functionContext.parameters.forEach((parameter, index) => {
      effective.set(index, parameter.defaultExpression);
    });
  }
  for (const [index, expression] of customParameters) {
    effective.set(index, expression);
  }
  return effective;
}
