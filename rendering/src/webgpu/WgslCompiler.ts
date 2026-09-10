import type { AsyncSlangCompiler } from "./AsyncSlangCompiler";
import type { SlangCompileOptions, SlangCompileResult } from "./SlangCompiler";
import { wrapWgslComputeSource, wrapWgslImageSource } from "./WgslPrelude";

/**
 * WGSL front end for the WebGPU pipeline. The pipeline already speaks WGSL,
 * so this only prepends the prelude and returns the string unchanged — no
 * worker, no WASM, no session. Wrapping never throws: real errors surface
 * from the browser compiler via getCompilationInfo().
 */
export class WgslCompiler implements AsyncSlangCompiler {
  async compile(source: string, options: SlangCompileOptions): Promise<SlangCompileResult> {
    // WGSL has no module system, so imported module sources join the common
    // code (`common` concatenation is the only multi-file mechanism).
    const commonCode = [
      ...(options.modules?.map((module) => module.source) ?? []),
      options.commonCode ?? "",
    ].filter((part) => part.trim() !== "").join("\n");
    const isCompute = options.passKind === "compute";
    const wrapped = isCompute
      ? wrapWgslComputeSource(source, {
        passName: options.passName,
        commonCode,
        channels: options.channels,
        storage: options.storage,
        workgroupSize: options.workgroupSize ?? [8, 8, 1],
        outputLayers: options.outputLayers ?? 1,
        hasOutput: options.hasOutput === true,
        customUniforms: options.customUniforms,
        outputImageFormat: options.outputImageFormat ?? "rgba16f",
        entryPoint: options.entryPoint,
      })
      : wrapWgslImageSource(source, {
        passName: options.passName,
        commonCode,
        channels: options.channels,
        storage: options.storage,
        passKind: options.passKind ?? "render",
        geometry: options.geometry,
        vertexCode: options.vertexCode,
        captureMode: options.captureMode,
        customUniforms: options.customUniforms,
      });
    return {
      success: true,
      wgsl: wrapped.source,
      sourceLineOffset: wrapped.preludeLineCount,
      sourceLineCount: wrapped.userLineCount,
      requiredFeatures: wrapped.requiredFeatures,
    };
  }

  dispose(): void {}
}
