import type { ShaderConfig, ShaderLanguageId, SlangSourceModule } from "@shader-studio/types";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { ShaderInfo } from "./types";

interface CaptureSourceContext {
  code: string;
  config: ShaderConfig | null;
  path: string;
  buffers: Record<string, string>;
  language?: ShaderLanguageId;
  scriptContextOmitted?: boolean;
  customUniformDeclarations?: string;
  customUniformInfo?: { name: string; type: string }[];
  slangModules?: SlangSourceModule[];
  slangSourcePath?: string;
  slangSourcePaths?: Record<string, string>;
}

type UniformCaptureEngine = Pick<
  RenderingEngine,
  "getCustomUniformDeclarations" | "getCustomUniformInfo" | "getCurrentCustomUniforms"
> & Partial<Pick<RenderingEngine, "getDisplayedCustomUniforms">>;

/**
 * Resolve omitted script context against the live engine while treating an
 * explicit empty context as a clear. Values are those of the displayed frame
 * (frozen while paused) and filtered to declarations owned by the current shader.
 */
export function buildRenderCaptureShaderInfo(
  source: CaptureSourceContext,
  engine: UniformCaptureEngine,
): ShaderInfo {
  const customUniformDeclarations = source.scriptContextOmitted
    ? engine.getCustomUniformDeclarations() || undefined
    : source.customUniformDeclarations;
  const customUniformInfo = source.scriptContextOmitted
    ? engine.getCustomUniformInfo()
    : source.customUniformInfo ?? [];
  const currentUniformKeys = new Set(
    customUniformInfo.map(({ name, type }) => `${name}\0${type}`),
  );
  const displayedValues = engine.getDisplayedCustomUniforms?.() ?? engine.getCurrentCustomUniforms();
  const customUniformValues = displayedValues.filter(
    ({ name, type }) => currentUniformKeys.has(`${name}\0${type}`),
  );

  return {
    code: source.code,
    config: source.config,
    path: source.path,
    buffers: source.buffers,
    language: source.language,
    customUniformDeclarations,
    customUniformInfo,
    customUniformValues,
    slangModules: source.slangModules,
    slangSourcePath: source.slangSourcePath,
    slangSourcePaths: source.slangSourcePaths,
  };
}
