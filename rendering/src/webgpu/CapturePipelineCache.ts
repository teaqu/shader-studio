import { nativeRasterUsesCamera } from "./NativeRasterCaptureContext";
/// <reference types="@webgpu/types" />
import type { DebugInstrumentationPlan } from "@shader-studio/types";
import type { CaptureCompileContext, CaptureCustomUniform } from "../capture/VariableCapturer";
import type { StorageBindingNode } from "../types/PassGraph";
import type { AsyncSlangCompiler } from "./AsyncSlangCompiler";
import type { SlangChannelBinding } from "./SlangPrelude";
import { allowNonUniformDerivatives } from "./wgslDiagnostics";
import { captureCompileOptions, capturePipelineDescriptor } from "./NativeCapturePipeline";
import { captureBindGroupLayoutEntries } from "./CaptureBindGroup";

export interface CachedCapturePipeline {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  lastUsed: number;
}

export async function compileCapturePipeline(
  device: GPUDevice, compiler: AsyncSlangCompiler, context: CaptureCompileContext, customUniforms: CaptureCustomUniform[],
  captureShader: string, commonCode: string | undefined, channels: SlangChannelBinding[], storage: StorageBindingNode[],
  debugPlan: DebugInstrumentationPlan | undefined, isCurrent: () => boolean,
): Promise<{ cached: CachedCapturePipeline | null; error?: string }> {
  const result = await compiler.compile(captureShader, captureCompileOptions(context, debugPlan, commonCode, channels, storage, customUniforms));
  if (!isCurrent()) {
    return { cached: null };
  }
  if (!result.success) {
    return { cached: null, error: formatCaptureCompileError(result.errors, debugPlan) };
  }
  try {
    const native = context.nativeRender && (debugPlan?.nativeRender || (context.nativeRender.vertexEntryPoint && !context.nativeRender.fragmentEntryPoint)) ? context.nativeRender : undefined;
    const module = device.createShaderModule({ code: allowNonUniformDerivatives(result.wgsl) });
    const bindGroupLayout = device.createBindGroupLayout({ entries: captureBindGroupLayoutEntries(channels, storage, Boolean(native), nativeRasterUsesCamera(native)) });
    const descriptor = capturePipelineDescriptor(device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }), module, native, debugPlan?.nativeRender?.fragmentEntryPoint, debugPlan?.nativeRender?.output ?? 0);
    const pipeline = device.createRenderPipelineAsync ? await device.createRenderPipelineAsync(descriptor) : device.createRenderPipeline(descriptor);
    return { cached: { pipeline, bindGroupLayout, lastUsed: performance.now() } };
  } catch (error) {
    return { cached: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function formatCaptureCompileError(errors: string[], debugPlan?: DebugInstrumentationPlan): string {
  const selected = debugPlan?.files.find((file) => file.uri === debugPlan.selectedSourceUri);
  const label = selected?.path ?? debugPlan?.selectedSourceUri;
  return errors.map((error) => label && !error.includes(label) && !error.includes(debugPlan!.selectedSourceUri) ? `${label}: ${error}` : error).join("\n");
}
