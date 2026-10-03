import type { SlangCompileOptions } from "./slangTypes";
import type { DebugInstrumentationPlan } from "@shader-studio/types";
import type { CaptureCompileContext, CaptureCustomUniform } from "../capture/VariableCapturer";
import type { SlangChannelBinding } from "./SlangPrelude";
import type { StorageBindingNode } from "../types/PassGraph";

/** Resolve the instrumented workspace and authored stage pair for capture compilation. */
export function captureCompileOptions(
  context: CaptureCompileContext,
  plan: DebugInstrumentationPlan | undefined,
  commonCode: string | undefined,
  channels: SlangChannelBinding[],
  storage: StorageBindingNode[],
  uniforms: CaptureCustomUniform[],
): SlangCompileOptions {
  const common = plan?.files.find(file => file.uri !== plan.rootUri && file.moduleName === ""
    && (file.path === context.slangSourcePath || file.path.toLowerCase().endsWith(".wgsl")));
  const modules = plan
    ? plan.files.filter(file => file.uri !== plan.rootUri && file.uri !== common?.uri)
      .map(file => ({ moduleName: file.moduleName, path: file.path, source: file.source }))
    : context.slangModules;
  const sourcePath = plan ? plan.files.find(file => file.uri === plan.rootUri)?.path : context.slangSourcePath;
  const native = context.nativeRender && (plan?.nativeRender
    || (context.nativeRender.vertexEntryPoint && !context.nativeRender.fragmentEntryPoint))
    ? context.nativeRender
    : undefined;
  return {
    passName: "capture", passKind: "render", captureMode: true,
    commonCode: common?.source ?? commonCode, channels, storage,
    customUniforms: uniforms.map(({ name, type }) => ({ name, type })),
    ...(plan || modules?.length ? { modules } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(native ? { geometry: native.geometry, vertexCode: native.vertexCode, renderEntryPoints: {
      vertex: native.vertexEntryPoint,
      ...(plan?.nativeRender?.fragmentEntryPoint ? { fragment: plan.nativeRender.fragmentEntryPoint } : {}),
    } } : {}),
  };
}

/** The same vertex layout and depth state used by the authored render pass. */
export function capturePipelineDescriptor(
  layout: GPUPipelineLayout,
  module: GPUShaderModule,
  native: CaptureCompileContext["nativeRender"],
  fragment: string | undefined,
  readbackOutput = 0,
): GPURenderPipelineDescriptor {
  const raster = native !== undefined;
  const mesh = raster && native.geometry !== "fullscreen";
  const writesDepth = Boolean(raster && native.writesDepth);
  const outputCount = raster ? native.outputCount ?? 1 : 1;
  return {
    layout,
    vertex: { module, entryPoint: raster ? native.vertexEntryPoint ?? "vertexMain" : "vertexMain",
      ...(mesh ? { buffers: [{ arrayStride: 32, attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
      ] }] } : {}),
    },
    fragment: { module, entryPoint: fragment ?? "fragmentMain", targets: Array.from({ length: outputCount }, (_, output) =>
      output === readbackOutput ? { format: "rgba32float" } : null) },
    primitive: { topology: "triangle-list" },
    ...(mesh || writesDepth ? { depthStencil: {
      format: "depth24plus", depthWriteEnabled: mesh, depthCompare: mesh ? "less" : "always",
    } } : {}),
  };
}
