import type { ShaderConfig,SlangSourceModule } from "@shader-studio/types";
import type { StorageBindingNode } from "../types/PassGraph";
import { meshTopology,resolveRenderState,verticesSpace,verticesTopology } from "../types/Geometry";
import { buildSlangBindingPlan,getSlangChannels,validateSlangBindingBudget } from "./SlangBindingPlan";
import { SlangComputePipeline } from "./SlangComputePipeline";
import {
  buildSlangPassGraph,
  resolvePassResolution,
  type RenderPassNode
} from "./SlangPassGraph";
import {
  SlangPassPipeline
} from "./SlangPassPipeline";
import { getShaderToyChannelCount } from "./SlangPrelude";
import { sharedSlangWgslCache } from "./SlangWgslCache";
import type { PendingPipelineCandidates } from "./WebGPUCompilationTypes";
import * as compileKeys from "./WebGPUCompileKeys";
import type { WebGPUDeviceConstraints } from "./WebGPUDeviceConstraints";
import type { WebGPUPipelineCandidates } from "./WebGPUPipelineCandidates";
import type { WebGPUShaderSession } from "./WebGPUShaderSession";
import {
  createSlangCustomUniformLayout
} from "./uniforms";

type PassFactorySession = Pick<WebGPUShaderSession,
  "compileGeneration" | "passGraph" | "currentConfig" | "computePipelines" |
  "dispatchOnceRan" | "passPipelines">;

interface WebGPUPassFactoryHost {
  session: PassFactorySession;
  candidates: Pick<WebGPUPipelineCandidates, "registerPipelineCandidate">;
  constraints: Pick<WebGPUDeviceConstraints, "clampResolutionToTextureLimit">;
  device: GPUDevice | null;
  bufferTextureFormat: GPUTextureFormat;
  format: GPUTextureFormat;
  disposed: boolean;
  canvas: HTMLCanvasElement | null;
}

/** Owns passFactory state and operations; dependencies stay live across compilation swaps. */
export class WebGPUPassFactory {
  constructor(private readonly host: WebGPUPassFactoryHost) {}

  createPassPipeline(
    pass: RenderPassNode,
    storage: StorageBindingNode[],
    uniformBufferSize = createSlangCustomUniformLayout([], getShaderToyChannelCount(pass.channels)).size,
    compilation?: Extract<import("./SlangCompiler").SlangCompileResult, { success: true }>,
  ): SlangPassPipeline | SlangComputePipeline {
    if (!this.host.device) {
      throw new Error("WebGPU device unavailable while creating pass pipeline");
    }
    const channels = getSlangChannels(pass.channels);
    const plan = buildSlangBindingPlan(channels);
    const extraBindings = storage.length + (pass.kind === "compute"
      ? 1 + Number(pass.output === "texture")
      : Number(pass.geometry !== "fullscreen"));
    validateSlangBindingBudget(pass.name, plan, this.host.device.limits, extraBindings, uniformBufferSize);
    return pass.kind === "compute"
      ? new SlangComputePipeline(this.host.device, {
        name: pass.name,
        width: pass.width,
        height: pass.height,
        hasOutput: pass.output === "texture",
        outputLayers: pass.outputLayers,
        workgroupSize: pass.workgroupSize,
        entryPoint: pass.entryPoint!,
        dispatchCount: pass.dispatchCount,
        channels,
        storage,
        uniformBufferSize,
        bufferTextureFormat: pass.resolvedOutputFormat ?? this.host.bufferTextureFormat,
        sourceLineOffset: compilation?.sourceLineOffset,
        sourceLineCount: compilation?.sourceLineCount,
        commonRange: compilation?.commonRange,
        directiveRanges: compilation?.directiveRanges,
      })
      : new SlangPassPipeline(this.host.device, this.host.format, {
        name: pass.name,
        width: pass.width,
        height: pass.height,
        output: pass.output === "canvas" ? "canvas" : "texture",
        geometry: pass.geometry,
        ...(pass.geometry === "vertices"
          ? { topology: verticesTopology(pass), vertexSpace: verticesSpace(pass) }
          : pass.geometry && pass.geometry !== "fullscreen" ? { topology: meshTopology(pass) } : {}),
        renderState: resolveRenderState(pass),
        channels,
        vertexChannels: Boolean(pass.vertexSrc),
        vertexRange: compilation?.vertexRange,
        storage,
        uniformBufferSize,
        sourceLineOffset: compilation?.sourceLineOffset,
        sourceLineCount: compilation?.sourceLineCount,
        commonRange: compilation?.commonRange,
        directiveRanges: compilation?.directiveRanges,
      }, pass.resolvedOutputFormat ?? this.host.bufferTextureFormat);
  }

  async reconcileCandidateResolutions(
    graph: ReturnType<typeof buildSlangPassGraph>,
    config: ShaderConfig | null,
    nextPipelines: Map<string, SlangPassPipeline>,
    nextKeys: Map<string, string>,
    nextComputePipelines: Map<string, SlangComputePipeline>,
    nextComputeKeys: Map<string, string>,
    candidates: PendingPipelineCandidates,
    generation: number,
    customUniforms: { name: string; type: string }[],
    slangModules: SlangSourceModule[],
  ): Promise<string[]> {
    const errors: string[] = [];
    while (generation === this.host.session.compileGeneration && !this.host.disposed) {
      this.updatePassGraphResolutions(graph.passes, config);
      for (const pass of graph.passes) {
        const passModules = slangModules
          .filter((module) => module.ownerPass === pass.name)
          .map(({ ownerPass: _ownerPass, ...module }) => module);
        const isCompute = pass.kind === "compute";
        const pipelines = isCompute ? nextComputePipelines : nextPipelines;
        const keys = isCompute ? nextComputeKeys : nextKeys;
        const pipeline = pipelines.get(pass.name);
        const finalKey = compileKeys.pipelineCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          customUniforms,
          passModules,
        );
        if (!pipeline || keys.get(pass.name) === finalKey) {
          continue;
        }

        const candidateOwned = isCompute
          ? candidates.compute.has(pipeline as SlangComputePipeline)
          : candidates.render.has(pipeline as SlangPassPipeline);
        if (candidateOwned) {
          try {
            pipeline.resize(pass.width, pass.height);
            keys.set(pass.name, finalKey);
          } catch (error) {
            errors.push(compileKeys.prefixPassError(
              pass.name,
              error instanceof Error ? error.message : String(error),
            ));
          }
          continue;
        }

        const wgslKey = compileKeys.wgslCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          customUniforms,
          passModules,
        );
        const compilation = sharedSlangWgslCache.get(wgslKey);
        const wgsl = compilation?.wgsl;
        if (!wgsl) {
          errors.push(`${pass.name}: compiled WGSL unavailable during resolution reconciliation`);
          continue;
        }

        let replacement: SlangPassPipeline | SlangComputePipeline | undefined;
        try {
          replacement = this.createPassPipeline(
            pass,
            graph.storage,
            createSlangCustomUniformLayout(customUniforms, getShaderToyChannelCount(pass.channels)).size,
            compilation ?? undefined,
          );
          if (!this.host.candidates.registerPipelineCandidate(candidates, replacement)) {
            return errors;
          }
          const wgslErrors = await replacement.rebuild(wgsl);
          errors.push(...wgslErrors.map((error) =>
            compileKeys.prefixPassError(pass.name, error)));
          if (wgslErrors.length === 0 &&
            generation === this.host.session.compileGeneration && !this.host.disposed) {
            if (isCompute) {
              nextComputePipelines.set(pass.name, replacement as SlangComputePipeline);
              nextComputeKeys.set(pass.name, finalKey);
            } else {
              nextPipelines.set(pass.name, replacement as SlangPassPipeline);
              nextKeys.set(pass.name, finalKey);
            }
          }
        } catch (error) {
          errors.push(compileKeys.prefixPassError(
            pass.name,
            error instanceof Error ? error.message : String(error),
          ));
        }
      }

      if (errors.length > 0 || generation !== this.host.session.compileGeneration || this.host.disposed) {
        return errors;
      }

      // A replacement rebuild awaited GPU work. If another resize landed in
      // that interval, loop once more and reconcile the candidate to it.
      this.updatePassGraphResolutions(graph.passes, config);
      const stable = graph.passes.every((pass) => {
        const keys = pass.kind === "compute" ? nextComputeKeys : nextKeys;
        return keys.get(pass.name) === compileKeys.pipelineCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          customUniforms,
          slangModules
            .filter((module) => module.ownerPass === pass.name)
            .map(({ ownerPass: _ownerPass, ...module }) => module),
        );
      });
      if (stable) {
        return errors;
      }
    }
    return errors;
  }

  applyPassResolutions(): void {
    if (!this.host.canvas || this.host.session.passGraph.length === 0) {
      return;
    }
    const resizedPasses = this.host.session.passGraph.map((pass) => ({ ...pass }));
    this.updatePassGraphResolutions(resizedPasses, this.host.session.currentConfig);
    let resizeEncoder: GPUCommandEncoder | null = null;
    const finishResizes: Array<() => void> = [];
    for (let index = 0; index < this.host.session.passGraph.length; index += 1) {
      const pass = this.host.session.passGraph[index];
      const resizedPass = resizedPasses[index];
      const sizeChanged = pass.width !== resizedPass.width || pass.height !== resizedPass.height;
      if (pass.kind === "compute") {
        const pipeline = this.host.session.computePipelines.get(pass.name);
        if (!pipeline) {
          pass.width = resizedPass.width;
          pass.height = resizedPass.height;
          continue;
        }
        pipeline.resize(resizedPass.width, resizedPass.height);
        pass.width = resizedPass.width;
        pass.height = resizedPass.height;
        const dispatchMode = pass.dispatch?.mode ?? "texel";
        if (
          pass.dispatchOnce &&
          sizeChanged &&
          (dispatchMode === "texel" || pass.output === "texture")
        ) {
          this.host.session.dispatchOnceRan.delete(pass.name);
        }
      } else {
        const pipeline = this.host.session.passPipelines.get(pass.name);
        if (sizeChanged && pass.output === "texture" && pipeline && this.host.device) {
          resizeEncoder ??= this.host.device.createCommandEncoder();
          const finishResize = pipeline.encodeResize(
            resizedPass.width,
            resizedPass.height,
            resizeEncoder,
          );
          if (finishResize) {
            finishResizes.push(finishResize);
          }
        } else {
          pipeline?.resize(resizedPass.width, resizedPass.height);
        }
        pass.width = resizedPass.width;
        pass.height = resizedPass.height;
      }
    }
    if (resizeEncoder && finishResizes.length > 0 && this.host.device) {
      this.host.device.queue.submit([resizeEncoder.finish()]);
      for (const finishResize of finishResizes) {
        finishResize();
      }
    }
  }

  updatePassGraphResolutions(
    passes: RenderPassNode[],
    config: ShaderConfig | null,
  ): void {
    if (!this.host.canvas) {
      return;
    }
    const canvasWidth = Math.max(1, this.host.canvas.width);
    const canvasHeight = Math.max(1, this.host.canvas.height);
    for (const pass of passes) {
      const unclampedResolution = pass.output === "canvas"
        ? { width: canvasWidth, height: canvasHeight }
        : resolvePassResolution({
          passName: pass.name,
          passConfig: config?.passes?.[pass.name],
          canvasWidth,
          canvasHeight,
          // Resolution settings were already validated at compile time; a
          // resize cannot introduce new config errors.
          errors: [],
        });
      const resolution = this.host.constraints.clampResolutionToTextureLimit(unclampedResolution);
      pass.width = resolution.width;
      pass.height = resolution.height;
    }
  }
}
