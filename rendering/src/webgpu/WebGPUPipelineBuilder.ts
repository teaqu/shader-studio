import type { SlangSourceModule } from "@shader-studio/types";
import { CustomUniformManager } from "../webgl/CustomUniformManager";
import { verticesSpace } from "../types/Geometry";
import { type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import { getSlangChannels } from "./SlangBindingPlan";
import { SlangComputePipeline } from "./SlangComputePipeline";
import {
  buildSlangPassGraph
} from "./SlangPassGraph";
import {
  SlangPassPipeline
} from "./SlangPassPipeline";
import { getShaderToyChannelCount } from "./SlangPrelude";
import { sharedSlangWgslCache } from "./SlangWgslCache";
import type { PassTiming,PendingPipelineCandidates } from "./WebGPUCompilationTypes";
import type { WebGPUCompileDiagnostics } from "./WebGPUCompileDiagnostics";
import * as compileKeys from "./WebGPUCompileKeys";
import type { WebGPUDeviceConstraints } from "./WebGPUDeviceConstraints";
import type { WebGPUPassFactory } from "./WebGPUPassFactory";
import type { WebGPUPipelineCandidates } from "./WebGPUPipelineCandidates";
import { wgslUnsupportedFeatureMessage } from "./WgslPrelude";
import {
  createSlangCustomUniformLayout
} from "./uniforms";
import { extractStructSizes } from "./wgslStructSize";


import type { WebGPUShaderSession } from "./WebGPUShaderSession";

interface PipelineBuildDependencies {
  diagnostics: Pick<WebGPUCompileDiagnostics, "now" | "ms">;
  constraints: Pick<WebGPUDeviceConstraints, "wgslImageFormat">;
  passFactory: Pick<WebGPUPassFactory, "createPassPipeline">;
  candidates: Pick<WebGPUPipelineCandidates, "registerPipelineCandidate">;
  readonly disposed: boolean;
  readonly compiler: Pick<AsyncSlangCompiler, "compile"> | null;
  readonly device: GPUDevice | null;
  readonly bufferTextureFormat: GPUTextureFormat;
}

type InstalledPipelineState = Pick<WebGPUShaderSession,
  "compileGeneration" | "computePipelines" | "passPipelines" | "computeKeys" | "passKeys">;

/** Build candidates without touching installed pipelines. Caller publishes only after all passes succeed. */
export async function buildWebGPUPipelines(
  dependencies: PipelineBuildDependencies,
  installed: InstalledPipelineState,
  graph: ReturnType<typeof buildSlangPassGraph>,
  generation: number,
  sessionChanged: boolean,
  appliesReset: boolean,
  nextCustomUniformManager: CustomUniformManager,
  pipelineCandidates: PendingPipelineCandidates,
  slangModules: SlangSourceModule[],
  slangSourcePath: string | undefined,
  slangSourcePaths: Record<string, string> | undefined,
  errors: string[],
  passTimings: PassTiming[],
) {
  let storageStridesValidated: boolean | null = null;
  const nextPipelines = new Map<string, SlangPassPipeline>();
  const nextKeys = new Map<string, string>();
  const nextComputePipelines = new Map<string, SlangComputePipeline>();
  const nextComputeKeys = new Map<string, string>();
  for (const pass of graph.passes) {
    if (generation !== installed.compileGeneration || dependencies.disposed) {
      break;
    }
    const passStartedAt = dependencies.diagnostics.now();
    const passModules = slangModules
      .filter((module) => module.ownerPass === pass.name)
      .map(({ ownerPass: _ownerPass, ...module }) => module);
    const uniformInfo = nextCustomUniformManager.getUniformInfo();
    const wgslKey = compileKeys.wgslCacheKey(
      pass,
      graph.commonCode,
      graph.storage,
      uniformInfo,
      passModules,
    );
    const pipelineKey = compileKeys.pipelineCacheKey(
      pass,
      graph.commonCode,
      graph.storage,
      uniformInfo,
      passModules,
    );
    const isCompute = pass.kind === "compute";
    const existing = sessionChanged || appliesReset
      ? undefined
      : isCompute
        ? installed.computePipelines.get(pass.name)
        : installed.passPipelines.get(pass.name);
    const existingKey = sessionChanged
      ? undefined
      : isCompute
        ? installed.computeKeys.get(pass.name)
        : installed.passKeys.get(pass.name);
    if (existing && existingKey === pipelineKey) {
      // Unchanged pass: carry the live pipeline into the next generation.
      // Resize (if the canvas changed) is deferred to the success block so
      // this loop stays mutation-free while a later pass can still fail.
      if (isCompute) {
        nextComputePipelines.set(pass.name, existing as SlangComputePipeline);
        nextComputeKeys.set(pass.name, pipelineKey);
      } else {
        nextPipelines.set(pass.name, existing as SlangPassPipeline);
        nextKeys.set(pass.name, pipelineKey);
      }
      passTimings.push({
        name: pass.name,
        cacheHit: true,
        totalMs: dependencies.diagnostics.ms(dependencies.diagnostics.now() - passStartedAt),
      });
      continue;
    }
    let pipeline: SlangPassPipeline | SlangComputePipeline | undefined;
    try {
      let compilation = sharedSlangWgslCache.get(wgslKey);
      let wgsl = compilation?.wgsl;
      const wgslCacheHit = compilation !== null;
      let slangMs = 0;
      const channels = getSlangChannels(pass.channels);
      if (!wgsl) {
        const slangStartedAt = dependencies.diagnostics.now();
        const compiled = await dependencies.compiler!.compile(pass.source, {
          passName: pass.name,
          commonCode: graph.commonCode,
          channels,
          storage: graph.storage,
          passKind: pass.kind,
          ...(pass.geometry !== "fullscreen" ? { geometry: pass.geometry } : {}),
          ...(pass.vertexSrc ? { vertexCode: pass.vertexSrc } : {}),
          ...(pass.geometry === "vertices" ? { vertexSpace: verticesSpace(pass) } : {}),
          workgroupSize: pass.workgroupSize,
          outputLayers: pass.outputLayers,
          hasOutput: pass.output === "texture",
          ...(pass.kind === "compute"
            ? { outputImageFormat: dependencies.constraints.wgslImageFormat(pass.resolvedOutputFormat ?? dependencies.bufferTextureFormat) }
            : {}),
          ...(pass.kind === "compute" ? { entryPoint: pass.entryPoint } : {}),
          ...(passModules.length > 0 ? { modules: passModules } : {}),
          ...(slangSourcePaths?.[pass.name]
            ? { sourcePath: slangSourcePaths[pass.name] }
            : slangSourcePath ? { sourcePath: slangSourcePath } : {}),
          ...(nextCustomUniformManager.hasUniforms()
            ? { customUniforms: uniformInfo }
            : {}),
        });
        slangMs = dependencies.diagnostics.now() - slangStartedAt;
        if (generation !== installed.compileGeneration || dependencies.disposed) {
          break;
        }
        if (!compiled.success) {
          errors.push(...compiled.errors.map((error) =>
            compileKeys.prefixPassError(pass.name, error)));
          passTimings.push({
            name: pass.name,
            cacheHit: false,
            wgslCacheHit: false,
            slangMs: dependencies.diagnostics.ms(slangMs),
            totalMs: dependencies.diagnostics.ms(dependencies.diagnostics.now() - passStartedAt),
            errorCount: compiled.errors.length,
          });
          continue;
        }
        wgsl = compiled.wgsl;
        compilation = compiled;
        sharedSlangWgslCache.set(wgslKey, compiled);
      }
      // A shader whose hoisted `enable` needs a feature the device lacks
      // gets a clear error here instead of a raw Tint parse failure.
      const unsupportedFeature = wgslUnsupportedFeatureMessage(
        compilation?.requiredFeatures ?? [],
        (feature) => dependencies.device?.features?.has?.(feature as GPUFeatureName) === true,
      );
      if (unsupportedFeature !== undefined) {
        errors.push(compileKeys.prefixPassError(pass.name, unsupportedFeature));
        passTimings.push({
          name: pass.name,
          cacheHit: false,
          wgslCacheHit,
          slangMs: dependencies.diagnostics.ms(slangMs),
          totalMs: dependencies.diagnostics.ms(dependencies.diagnostics.now() - passStartedAt),
          errorCount: 1,
        });
        continue;
      }
      // After the first successful compile, validate custom struct strides
      // against the actual WGSL layout that Slang generated.
      if (wgsl && storageStridesValidated === null) {
        storageStridesValidated = false;
        const structSizes = extractStructSizes(wgsl);
        for (const storageNode of graph.storage) {
          if (storageNode.builtin) {
            continue;
          }
          const actualSize = structSizes.get(storageNode.elementType);
          if (actualSize !== undefined && actualSize.size !== storageNode.stride) {
            graph.warnings.push(
              `Storage "${storageNode.name}": stride ${storageNode.stride} does not match ` +
                  `the compiled size of ${storageNode.elementType} (${actualSize.size} bytes from WGSL layout)`,
            );
          }
        }
      }
      pipeline = dependencies.passFactory.createPassPipeline(
        pass,
        graph.storage,
        createSlangCustomUniformLayout(uniformInfo, getShaderToyChannelCount(pass.channels)).size,
        compilation ?? undefined,
      );
      if (!dependencies.candidates.registerPipelineCandidate(pipelineCandidates, pipeline)) {
        break;
      }
      const pipelineStartedAt = dependencies.diagnostics.now();
      const wgslErrors = await pipeline.rebuild(wgsl);
      const pipelineMs = dependencies.diagnostics.now() - pipelineStartedAt;
      errors.push(...wgslErrors);
      passTimings.push({
        name: pass.name,
        cacheHit: false,
        wgslCacheHit,
        slangMs: dependencies.diagnostics.ms(slangMs),
        pipelineMs: dependencies.diagnostics.ms(pipelineMs),
        totalMs: dependencies.diagnostics.ms(dependencies.diagnostics.now() - passStartedAt),
        errorCount: wgslErrors.length,
      });
      if (isCompute) {
        nextComputePipelines.set(pass.name, pipeline as SlangComputePipeline);
        nextComputeKeys.set(pass.name, pipelineKey);
      } else {
        nextPipelines.set(pass.name, pipeline as SlangPassPipeline);
        nextKeys.set(pass.name, pipelineKey);
      }
    } catch (error) {
      errors.push(compileKeys.prefixPassError(
        pass.name,
        error instanceof Error ? error.message : String(error),
      ));
      passTimings.push({
        name: pass.name,
        cacheHit: false,
        totalMs: dependencies.diagnostics.ms(dependencies.diagnostics.now() - passStartedAt),
        errorCount: 1,
      });
    }

  }

  return { nextPipelines, nextKeys, nextComputePipelines, nextComputeKeys };
}
