import { getShaderEntryPoints, type BufferPass, type DebugInstrumentationPlan, type ShaderConfig, type ShaderLanguageId } from "@shader-studio/types";

/** Undefined selects ShaderToy hooks; null means native selection cannot be resolved. */
export function nativeFragmentEntryPoint(source: string, pass: ShaderConfig["passes"][string], language: ShaderLanguageId): string | null | undefined {
  if (!pass || !("entryPoints" in pass) || pass.entryPoints === undefined) {
    return undefined;
  }
  if (!pass.entryPoints || typeof pass.entryPoints !== "object" || ("type" in pass && pass.type === "compute")) {
    return null;
  }
  const configured = "fragment" in pass.entryPoints ? pass.entryPoints.fragment : undefined;
  if (configured) {
    return configured;
  }
  const fragments = getShaderEntryPoints(source, language).filter(entry => entry.stage === "fragment");
  return fragments.length === 1 ? fragments[0]!.name : null;
}

/** Instrumented debug plans use hooks for Image while all other passes retain their stages. */
export function hookConfigForDebugPlan(
  config: ShaderConfig | null,
  plan?: Pick<DebugInstrumentationPlan, "nativeRender">,
): ShaderConfig | null {
  if (plan?.nativeRender) {
    return config;
  }
  const image = config?.passes.Image;
  if (!config || !image || image.entryPoints === undefined) {
    return config;
  }
  const { entryPoints: _entryPoints, vertex: _vertex, geometry: _geometry, ...hookImage } = image;
  // Instrumented plans render the generated hook fragment over the pixel grid;
  // inherited mesh geometry or a separate vertex file would not invoke it.
  return { ...config, passes: { ...config.passes, Image: { ...hookImage, geometry: { type: "fullscreen" } } } };
}

/**
 * Debugging a render Buffer compiles its source through the temporary Image
 * slot. Move render-selection fields there so the renderer invokes that
 * Buffer's stages, while intentionally retaining Image resolution behavior.
 */
export function imageConfigForActiveRenderPass(config: ShaderConfig | null, passName: string): ShaderConfig | null {
  if (!config || passName === "Image" || passName === "common") {
    return config;
  }
  const activePass = config.passes[passName];
  const image = config.passes.Image;
  if (!activePass || !image || !isRenderBufferPass(activePass)) {
    return config;
  }
  const {
    inputs: _imageInputs,
    entryPoints: _imageEntryPoints,
    vertex: _imageVertex,
    geometry: _imageGeometry,
    ...imageWithResolution
  } = image;
  const remappedImage = {
    ...imageWithResolution,
    ...(activePass.inputs ? { inputs: activePass.inputs } : {}),
    ...(activePass.entryPoints !== undefined ? { entryPoints: activePass.entryPoints } : {}),
    ...(activePass.vertex ? { vertex: activePass.vertex } : {}),
    ...(activePass.geometry ? { geometry: activePass.geometry } : {}),
  };
  return { ...config, passes: { ...config.passes, Image: remappedImage } };
}

function isRenderBufferPass(pass: ShaderConfig["passes"][string] | undefined): pass is BufferPass {
  return !!pass && "path" in pass && !("type" in pass && pass.type === "compute");
}
