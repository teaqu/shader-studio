import type { ShaderConfig, ShaderLanguageId, SlangSourceModule } from "@shader-studio/types";
import type { RenderingEngine } from "../../../../rendering/src/types/RenderingEngine";
import type { RenderCaptureSnapshot, ShaderInfo } from "./types";

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

type LiveInputKind = "mouse" | "keyboard" | "audio" | "video";

/**
 * Live inputs a Render export cannot reproduce for this shader. Render runs
 * on its own timeline from a snapshot: it doesn't replay pointer or keyboard
 * history, and audio/video inputs play on the wall clock rather than the
 * export clock. Returns the kinds this shader actually uses.
 */
export function renderInputLimitations(
  snapshot: Pick<RenderCaptureSnapshot, "code" | "buffers" | "config">,
): LiveInputKind[] {
  const kinds = new Set<LiveInputKind>();
  const sources = [snapshot.code, ...Object.values(snapshot.buffers ?? {})];
  if (sources.some((source) => /\biMouse\b/.test(source))) {
    kinds.add("mouse");
  }
  for (const pass of Object.values(snapshot.config?.passes ?? {})) {
    const inputs = (pass as { inputs?: Record<string, { type?: string }> } | undefined)?.inputs ?? {};
    for (const input of Object.values(inputs)) {
      if (input?.type === "keyboard" || input?.type === "audio" || input?.type === "video") {
        kinds.add(input.type);
      }
    }
  }
  return (["mouse", "keyboard", "audio", "video"] as const).filter((kind) => kinds.has(kind));
}

/** A short user-facing note for the limitations, or null when there are none. */
export function describeRenderInputLimitations(kinds: LiveInputKind[]): string | null {
  if (kinds.length === 0) {
    return null;
  }
  const parts: string[] = [];
  if (kinds.includes("mouse")) {
    parts.push("iMouse stays at its idle value");
  }
  const media = kinds.filter((kind) => kind !== "mouse");
  if (media.length > 0) {
    const names = media.map((kind) => kind);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    parts.push(`${list} input${names.length === 1 ? " isn't" : "s aren't"} replayed on the export timeline`);
  }
  return `Render doesn't replay live input: ${parts.join("; ")}. Use Live to capture interaction.`;
}
