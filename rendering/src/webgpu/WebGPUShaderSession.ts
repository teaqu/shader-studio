import type { DebugInstrumentationPlan,ShaderConfig,ShaderLanguageId,SlangSourceModule } from "@shader-studio/types";
import { CameraManager } from "../input/CameraManager";
import type { CompilationResult } from "../models";
import { ResourceManager } from "../resources/ResourceManager";
import { resolveGraphBufferFormats } from "../util/BufferFormatResolver";
import { dedupeCompilerErrors } from "../util/CompilerErrorDedupe";
import { ConfigValidator } from "../util/ConfigValidator";
import { TimeManager } from "../util/TimeManager";
import { CustomUniformManager,type CustomUniform } from "../webgl/CustomUniformManager";
import { type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import { getSlangTextureIdentity } from "./SlangBindingPlan";
import { SlangComputePipeline } from "./SlangComputePipeline";
import {
  buildSlangPassGraph,
  type RenderPassNode
} from "./SlangPassGraph";
import {
  SlangPassPipeline
} from "./SlangPassPipeline";
import type { PassTiming,PendingPipelineCandidates,PreparedStorageBuffers,ShaderCompileSnapshot } from "./WebGPUCompilationTypes";
import type { WebGPUCompileDiagnostics } from "./WebGPUCompileDiagnostics";
import * as compileKeys from "./WebGPUCompileKeys";
import type { WebGPUDeviceConstraints } from "./WebGPUDeviceConstraints";
import { WebGPUMeshResources } from "./WebGPUMeshResources";
import type { WebGPUPassFactory } from "./WebGPUPassFactory";
import { buildWebGPUPipelines } from "./WebGPUPipelineBuilder";
import type { WebGPUPipelineCandidates } from "./WebGPUPipelineCandidates";
import type { WebGPUStorage } from "./WebGPUStorage";
import { WebGPUTextureBackend,type WebGPUTextureHandle } from "./WebGPUTextureBackend";

interface WebGPUShaderSessionHost {
  storage: WebGPUStorage;
  candidates: WebGPUPipelineCandidates;
  diagnostics: WebGPUCompileDiagnostics;
  constraints: WebGPUDeviceConstraints;
  passFactory: Pick<WebGPUPassFactory, "createPassPipeline" | "reconcileCandidateResolutions">;
  resetPausedFrame(): void;
  disposed: boolean;
  ready: Promise<void> | null;
  context: GPUCanvasContext | null;
  device: GPUDevice | null;
  compiler: AsyncSlangCompiler | null;
  initError: string | null;
  describeUnavailableInitState(): string;
  canvas: HTMLCanvasElement | null;
  language: ShaderLanguageId;
  globalVolume: number;
  globalMuted: boolean;
  meshResources: Pick<WebGPUMeshResources, "loadModel"> | null;
  bufferTextureFormat: GPUTextureFormat;
  timeManager: TimeManager;
  cameraManager: CameraManager;
  retireAfterPublication(resource: string, retire: () => void, warnings: string[]): void;
  clearCanvas(): void;
  stopRenderLoop(): void;
}


interface CompilationSnapshot {
  attemptedCompile: ShaderCompileSnapshot;
  prospectiveInstalledCompile: ShaderCompileSnapshot;
  nextCustomUniformManager: CustomUniformManager;
  startedAt: number;
}

interface CompilationPreparation extends CompilationSnapshot {
  readyMs: number;
  graphMs: number;
  graph: ReturnType<typeof buildSlangPassGraph>;
}

interface CompilationPublication {
  graph: ReturnType<typeof buildSlangPassGraph>;
  preparedStorage: PreparedStorageBuffers;
  pipelineCandidates: PendingPipelineCandidates;
  candidateResourceManager: ResourceManager<WebGPUTextureHandle> | null;
  nextPipelines: Map<string, SlangPassPipeline>;
  nextKeys: Map<string, string>;
  nextComputePipelines: Map<string, SlangComputePipeline>;
  nextComputeKeys: Map<string, string>;
  nextCustomUniformManager: CustomUniformManager;
  prospectiveInstalledCompile: ShaderCompileSnapshot;
  resourceKey: string;
  path: string;
  config: ShaderConfig | null;
  sessionChanged: boolean;
  appliesReset: boolean;
  resetGeneration: number | null;
}

/** Owns session state and operations; dependencies stay live across compilation swaps. */
export class WebGPUShaderSession {
  constructor(private readonly host: WebGPUShaderSessionHost) {}

  resourceManager: ResourceManager<WebGPUTextureHandle> | null = null;

  passGraph: RenderPassNode[] = [];

  passPipelines = new Map<string, SlangPassPipeline>();

  passKeys = new Map<string, string>();

  computePipelines = new Map<string, SlangComputePipeline>();

  computeKeys = new Map<string, string>();

  dispatchOnceRan = new Set<string>();

  hasSubmittedFrameForInstalledGeneration = false;

  shaderPath = "";

  installedResourceKey: string | null = null;

  lastCompile: ShaderCompileSnapshot | null = null;

  installedCompile: ShaderCompileSnapshot | null = null;

  customUniformManager = new CustomUniformManager();

  pendingCustomUniformValues: CustomUniform[] | null = null;

  compileGeneration = 0;

  reloadOnNextApply = false;

  currentConfig: ShaderConfig | null = null;

  async compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string> = {},
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
    slangModules: SlangSourceModule[] = [],
    slangSourcePath?: string,
    slangSourcePaths?: Record<string, string>,
  ): Promise<CompilationResult | undefined> {
    if (this.host.disposed) {
      return { success: false, errors: ["Engine disposed"], superseded: true };
    }
    // Captured synchronously (before any await) so concurrent calls made in
    // the same tick still get distinct, call-order-correct generations.
    const generation = ++this.compileGeneration;
    const resetGeneration = this.host.storage.pendingReset?.generation ?? null;
    const appliesReset = resetGeneration !== null;
    for (const prepared of [...this.host.storage.pendingStoragePreparations]) {
      if (prepared.generation < generation) {
        this.host.storage.discardPreparedStorage(prepared);
      }
    }
    for (const candidates of [...this.host.candidates.pendingPipelineCandidates]) {
      if (candidates.generation < generation) {
        this.host.candidates.discardPipelineCandidates(candidates);
      }
    }
    const sessionChanged = this.shaderPath !== "" && this.shaderPath !== path;
    if (config) {
      const validation = ConfigValidator.validateConfig(config);
      if (!validation.isValid) {
        return this.failedCompilation(path, generation, {
          success: false,
          errors: [`Invalid shader configuration: ${validation.errors.join(", ")}`],
        });
      }
    }
    const snapshot = this.snapshotCompilation({ code, config, path, buffers, customUniformDeclarations, customUniformInfo, slangModules, slangSourcePath, slangSourcePaths }, generation);
    if ("success" in snapshot) {
      return snapshot;
    }
    let readyMs = 0;
    if (this.host.ready) {
      const readyStartedAt = this.host.diagnostics.now();
      this.host.diagnostics.logSlangPerf("compile waiting for init", { path, generation });
      await this.host.ready;
      readyMs = this.host.diagnostics.now() - readyStartedAt;
      this.host.diagnostics.logSlangPerf("compile init ready", { path, generation, readyMs: this.host.diagnostics.ms(readyMs) });
    }
    const preparation = this.prepareGraph(snapshot, readyMs, generation);
    if ("success" in preparation) {
      return preparation;
    }
    const { prospectiveInstalledCompile, nextCustomUniformManager, startedAt, graphMs, graph } = preparation;
    let preparedStorage: PreparedStorageBuffers | undefined;
    let candidateResourceManager: ResourceManager<WebGPUTextureHandle> | null = null;
    let pipelineCandidates: PendingPipelineCandidates | undefined;
    const passTimings: PassTiming[] = [];
    const errors: string[] = [];
    let published = false;
    try {
      try {
        preparedStorage = this.host.storage.prepareStorageBuffers(
          graph.storage,
          generation,
          sessionChanged || appliesReset,
          appliesReset ? this.host.storage.pendingReset : null,
        );
      } catch (error) {
        return this.failedCompilation(path, generation, {
          success: false,
          errors: [`Storage allocation failed: ${error instanceof Error ? error.message : String(error)}`],
          warnings: graph.warnings,
        });
      }
      const resourceKey = compileKeys.resourceLayoutKey(graph.passes);
      const hasFileResources = compileKeys.hasFileResources(graph.passes);
      const requiresResourceCandidate = Boolean(this.resourceManager) && (
        sessionChanged ||
        this.reloadOnNextApply ||
        hasFileResources && resourceKey !== this.installedResourceKey ||
        this.installedResourceKey !== null && resourceKey !== this.installedResourceKey
      );
      candidateResourceManager = requiresResourceCandidate
        ? this.resourceManager?.createIsolated?.() ?? (
          sessionChanged ? new ResourceManager(new WebGPUTextureBackend(this.host.device!)) : null
        )
        : null;
      candidateResourceManager?.setGlobalAudioState(this.host.globalVolume, this.host.globalMuted);
      const compileResourceManager = candidateResourceManager ?? this.resourceManager;
      pipelineCandidates = this.host.candidates.preparePipelineCandidates(generation, candidateResourceManager);

      if (compileResourceManager && !await this.loadFileResources(compileResourceManager, pipelineCandidates, graph.passes, graph.warnings, generation)) {
        return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
      }

      if (generation !== this.compileGeneration || this.host.disposed) {
        return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
      }

      for (const pass of graph.passes) {
        if (pass.modelPath) {
          try {
            await this.host.meshResources?.loadModel(pass.name, pass.modelPath, pass.modelMesh);
          } catch (error) {
            errors.push(compileKeys.prefixPassError(pass.name, error instanceof Error ? error.message : String(error)));
          }
        }
      }
      if (errors.length > 0) {
        return this.failedCompilation(path, generation, { success: false, errors, warnings: graph.warnings });
      }

      const { nextPipelines, nextKeys, nextComputePipelines, nextComputeKeys } = await buildWebGPUPipelines(
        this.host, this, graph, generation, sessionChanged, appliesReset,
        nextCustomUniformManager, pipelineCandidates, slangModules,
        slangSourcePath, slangSourcePaths, errors, passTimings,
      );

      if (errors.length > 0) {
        this.host.diagnostics.logCompileTiming("failed", {
          path,
          generation,
          startedAt,
          readyMs,
          graphMs,
          passTimings,
          graph,
          errors,
        });
        return this.failedCompilation(path, generation, {
          success: false,
          errors,
          warnings: graph.warnings,
        });
      }

      if (generation !== this.compileGeneration || this.host.disposed) {
        // A newer compileShaderPipeline call (or dispose()) already landed
        // while this attempt was awaiting the compiler/worker. Installing now
        // would clobber the newer, already-live pipelines with stale ones, so
        // drop this attempt; its transaction owns only pipelines allocated by
        // this generation, never reused installed predecessors.
        this.host.diagnostics.logCompileTiming("superseded", {
          path,
          generation,
          startedAt,
          readyMs,
          graphMs,
          passTimings,
          graph,
          errors: ["Superseded by a newer compile"],
        });
        return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
      }

      const resolutionErrors = await this.host.passFactory.reconcileCandidateResolutions(
        graph,
        config,
        nextPipelines,
        nextKeys,
        nextComputePipelines,
        nextComputeKeys,
        pipelineCandidates,
        generation,
        nextCustomUniformManager.getUniformInfo(),
        slangModules,
      );
      if (generation !== this.compileGeneration || this.host.disposed) {
        this.host.diagnostics.logCompileTiming("superseded", {
          path,
          generation,
          startedAt,
          readyMs,
          graphMs,
          passTimings,
          graph,
          errors: ["Superseded by a newer compile"],
        });
        return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
      }
      if (resolutionErrors.length > 0) {
        errors.push(...resolutionErrors);
        this.host.diagnostics.logCompileTiming("failed", {
          path,
          generation,
          startedAt,
          readyMs,
          graphMs,
          passTimings,
          graph,
          errors,
        });
        return this.failedCompilation(path, generation, {
          success: false,
          errors,
          warnings: graph.warnings,
        });
      }

      // setGlobalVolume() and pause state may change while resource loading or
      // Slang compilation awaits. Apply their latest values to the prospective
      // manager before publication; any media failure is still transactional.
      if (candidateResourceManager) {
        try {
          candidateResourceManager?.setGlobalAudioState(this.host.globalVolume, this.host.globalMuted);
          // A path switch or reset restarts shader time at publication. Stage
          // media against that prospective time, not the retiring clock.
          const shaderTime = (sessionChanged || appliesReset) && (
            this.passPipelines.size > 0 || this.computePipelines.size > 0
          )
            ? 0
            : this.host.timeManager.getCurrentTime(performance.now());
          candidateResourceManager.syncAllVideosToTime?.(shaderTime);
          if (this.host.timeManager.isPaused()) {
            candidateResourceManager.pauseAllVideos?.();
          } else {
            candidateResourceManager.resumeAllVideos?.();
          }
        } catch (error) {
          errors.push(`Media synchronization failed: ${
            error instanceof Error ? error.message : String(error)
          }`);
          this.host.diagnostics.logCompileTiming("failed", {
            path,
            generation,
            startedAt,
            readyMs,
            graphMs,
            passTimings,
            graph,
            errors,
          });
          return this.failedCompilation(path, generation, {
            success: false,
            errors,
            warnings: graph.warnings,
          });
        }
      }

      this.publishCompilation({
        graph, preparedStorage, pipelineCandidates, candidateResourceManager,
        nextPipelines, nextKeys, nextComputePipelines, nextComputeKeys,
        nextCustomUniformManager, prospectiveInstalledCompile, resourceKey,
        path, config, sessionChanged, appliesReset, resetGeneration,
      }, () => {
        published = true;
      });

      this.host.diagnostics.logCompileTiming("success", {
        path,
        generation,
        startedAt,
        readyMs,
        graphMs,
        passTimings,
        graph,
        errors,
      });
      return { success: true, warnings: graph.warnings.length > 0 ? graph.warnings : undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (published) {
        graph.warnings.push(`Post-publication cleanup failed: ${message}`);
        return { success: true, warnings: graph.warnings };
      }
      errors.push(message);
      this.host.diagnostics.logCompileTiming("failed", {
        path,
        generation,
        startedAt,
        readyMs,
        graphMs,
        passTimings,
        graph,
        errors,
      });
      return this.failedCompilation(path, generation, {
        success: false,
        errors,
        warnings: graph.warnings,
      });
    } finally {
      if (preparedStorage) {
        this.host.storage.discardPreparedStorage(preparedStorage);
      }
      if (pipelineCandidates) {
        this.host.candidates.discardPipelineCandidates(pipelineCandidates);
      } else {
        try {
          candidateResourceManager?.dispose();
        } catch {
          // Candidate construction/setup already failed; cleanup is best
          // effort and must not replace the structured compilation result.
        }
      }
    }
  }

  private snapshotCompilation(input: ShaderCompileSnapshot, generation: number): CompilationSnapshot | CompilationResult {
    const { code, config, path, buffers, customUniformDeclarations, customUniformInfo, slangModules, slangSourcePath, slangSourcePaths } = input;
    const startedAt = this.host.diagnostics.now();
    this.host.diagnostics.logSlangPerf("compile requested", {
      path,
      generation,
      hasReady: Boolean(this.host.ready),
      hasContext: Boolean(this.host.context),
      hasDevice: Boolean(this.host.device),
      hasCompiler: Boolean(this.host.compiler),
    });
    let attemptedCompile: ShaderCompileSnapshot;
    let prospectiveInstalledCompile: ShaderCompileSnapshot;
    try {
      // Read caller-owned/proxy-backed input exactly once, before any live
      // ownership transfer. The second snapshot clones only this plain object.
      const bufferSnapshot = { ...buffers };
      const snapshotMetadata = {
        customUniformDeclarations,
        customUniformInfo: customUniformInfo?.map((uniform) => ({ ...uniform })),
        slangModules: slangModules.map((module) => ({ ...module })),
        slangSourcePath,
        slangSourcePaths: slangSourcePaths ? { ...slangSourcePaths } : undefined,
      };
      attemptedCompile = { code, config, path, buffers: bufferSnapshot, ...snapshotMetadata };
      prospectiveInstalledCompile = {
        code,
        config,
        path,
        buffers: { ...bufferSnapshot },
        ...snapshotMetadata,
      };
    } catch (error) {
      return this.failedCompilation(path, generation, {
        success: false,
        errors: [`Failed to snapshot shader buffers: ${
          error instanceof Error ? error.message : String(error)
        }`],
      });
    }
    // Remember the inputs so updateBufferAndRecompile can re-run this compile
    // with a single buffer's content patched.
    this.lastCompile = attemptedCompile;
    const nextCustomUniformManager = new CustomUniformManager();
    if (customUniformDeclarations && customUniformInfo) {
      nextCustomUniformManager.loadDeclarations(customUniformDeclarations, customUniformInfo);
      if (this.pendingCustomUniformValues) {
        nextCustomUniformManager.updateValues(this.pendingCustomUniformValues);
      }
    }
    return { attemptedCompile, prospectiveInstalledCompile, nextCustomUniformManager, startedAt };
  }

  private prepareGraph(snapshot: CompilationSnapshot, readyMs: number, generation: number): CompilationPreparation | CompilationResult {
    const { attemptedCompile, prospectiveInstalledCompile, nextCustomUniformManager, startedAt } = snapshot;
    const { code, config, path } = attemptedCompile;
    if (generation !== this.compileGeneration || this.host.disposed) {
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
    }

    if (this.host.initError || !this.host.device || !this.host.compiler) {
      const reason = this.host.initError ?? this.host.describeUnavailableInitState();
      this.host.diagnostics.logSlangPerf("compile unavailable", { path, generation, reason });
      return this.failedCompilation(path, generation, {
        success: false,
        errors: [`WebGPU init failed: ${reason}`],
      });
    }

    this.host.constraints.clampCanvasToTextureLimit();
    const graphStartedAt = this.host.diagnostics.now();
    const graph = buildSlangPassGraph({
      imageCode: code,
      config,
      buffers: attemptedCompile.buffers,
      canvasWidth: this.host.canvas?.width ?? 1,
      canvasHeight: this.host.canvas?.height ?? 1,
      language: this.host.language,
      computeWorkgroupLimits: this.host.constraints.resolveComputeWorkgroupLimits(),
      maxOutputLayers: this.host.constraints.resolveMaxOutputLayers(),
      maxStorageBuffers: this.host.constraints.resolveMaxStorageBuffers(),
    });
    resolveGraphBufferFormats(graph, {
      rgba16floatRenderable: true,
      rgba32floatRenderable: true,
      float32Filterable: this.host.device.features?.has?.("float32-filterable") === true,
      float32Blendable: this.host.device.features?.has?.("float32-blendable") === true,
    });
    const graphMs = this.host.diagnostics.now() - graphStartedAt;

    if (graph.errors.length > 0) {
      this.host.diagnostics.logCompileTiming("failed", {
        path,
        generation,
        startedAt,
        readyMs,
        graphMs,
        passTimings: [],
        graph,
        errors: graph.errors,
      });
      return this.failedCompilation(path, generation, {
        success: false,
        errors: graph.errors,
        warnings: graph.warnings,
      });
    }
    for (const pass of graph.passes) {
      const resolution = this.host.constraints.clampResolutionToTextureLimit(pass);
      pass.width = resolution.width;
      pass.height = resolution.height;
    }
    const storageErrors = this.host.constraints.validateStorageLimits(graph.storage);
    if (storageErrors.length > 0) {
      return this.failedCompilation(path, generation, {
        success: false,
        errors: storageErrors,
        warnings: graph.warnings,
      });
    }
    const dispatchErrors = this.host.constraints.validateStaticComputeDispatchLimits(graph.passes, graph.storage);
    if (dispatchErrors.length > 0) {
      return this.failedCompilation(path, generation, {
        success: false,
        errors: dispatchErrors,
        warnings: graph.warnings,
      });
    }
    if (generation !== this.compileGeneration || this.host.disposed) {
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
    }
    return { attemptedCompile, prospectiveInstalledCompile, nextCustomUniformManager, startedAt, readyMs, graphMs, graph };
  }

  private async loadFileResources(compileResourceManager: ResourceManager<WebGPUTextureHandle>, pipelineCandidates: PendingPipelineCandidates, passes: RenderPassNode[], warnings: string[], generation: number): Promise<boolean> {
    for (const pass of passes) {
      for (const channel of pass.channels) {
        if (channel.kind === "texture") {
          await this.host.candidates.trackCandidateResourceLoad(pipelineCandidates, () =>
            compileResourceManager.loadImageTexture(channel.path, {
              filter: channel.filter,
              wrap: channel.wrap,
              vflip: channel.vflip,
              grayscale: channel.grayscale,
            }, getSlangTextureIdentity(channel)), compileResourceManager);
        } else if (channel.kind === "video") {
          const result = await this.host.candidates.trackCandidateResourceLoad(pipelineCandidates, () =>
            compileResourceManager.loadVideoTexture(channel.path, {
              filter: channel.filter,
              wrap: channel.wrap,
              vflip: channel.vflip,
              muted: channel.muted,
            }), compileResourceManager);
          if (result.warning) {
            warnings.push(result.warning);
          }
        } else if (channel.kind === "cubemap") {
          await this.host.candidates.trackCandidateResourceLoad(pipelineCandidates, () =>
            compileResourceManager.loadCubemapTexture(channel.path, {
              filter: channel.filter,
              wrap: channel.wrap,
              vflip: channel.vflip,
            }), compileResourceManager);
        } else if (channel.kind === "audio") {
          try {
            await this.host.candidates.trackCandidateResourceLoad(pipelineCandidates, () =>
              compileResourceManager.loadAudioSource(channel.path, {
                muted: channel.muted,
                startTime: channel.startTime,
                endTime: channel.endTime,
              }), compileResourceManager);
            compileResourceManager.updateAudioLoopRegion(
              channel.path,
              channel.startTime,
              channel.endTime,
            );
          } catch {
            warnings.push(`Audio loading failed: ${channel.path}`);
          }
        }
        if (generation !== this.compileGeneration || this.host.disposed) {
          return false;
        }
      }
    }
    return true;
  }

  private publishCompilation(input: CompilationPublication, markPublished: () => void): void {
    const { graph, preparedStorage, pipelineCandidates, candidateResourceManager, nextPipelines, nextKeys, nextComputePipelines, nextComputeKeys, nextCustomUniformManager, prospectiveInstalledCompile, resourceKey, path, config, sessionChanged, appliesReset, resetGeneration } = input;
    // Enumerating the retiring map can invoke user-modified iterators and
    // allocate. Finish that work while the installed generation is still
    // untouched; publication below then contains ownership assignments only.
    const retiredStorageBuffers = this.host.storage.collectRetiredStorageBuffers(preparedStorage);

    // All resolution-sensitive work above was staged in candidate-owned
    // pipelines. Publication below is therefore a synchronous map swap: a
    // failure can never leave a subset of the installed graph resized.
    const previousPipelines = this.passPipelines;
    const previousComputePipelines = this.computePipelines;
    const previousResourceManager = this.resourceManager;
    const hadInstalledPipeline = previousPipelines.size > 0 || previousComputePipelines.size > 0;
    this.passGraph = graph.passes;
    this.passPipelines = nextPipelines;
    this.passKeys = nextKeys;
    this.computePipelines = nextComputePipelines;
    this.computeKeys = nextComputeKeys;
    if (sessionChanged || appliesReset) {
      this.dispatchOnceRan.clear();
    }
    this.hasSubmittedFrameForInstalledGeneration = false;
    if (candidateResourceManager) {
      this.resourceManager = candidateResourceManager;
    }
    this.host.storage.publishPreparedStorage(preparedStorage);
    this.host.candidates.installPipelineCandidates(pipelineCandidates);
    this.shaderPath = path;
    this.installedResourceKey = resourceKey;
    this.reloadOnNextApply = false;
    this.currentConfig = config;
    this.installedCompile = prospectiveInstalledCompile;
    if (this.pendingCustomUniformValues) {
      nextCustomUniformManager.updateValues(this.pendingCustomUniformValues);
    }
    this.customUniformManager = nextCustomUniformManager;
    if (appliesReset) {
      this.host.timeManager.cleanup();
      this.host.resetPausedFrame();
      this.host.cameraManager.reset();
      this.host.storage.consumePendingReset(resetGeneration!, preparedStorage, graph.warnings);
    }
    markPublished();

    // Publication has completed. Every remaining operation retires the old
    // generation best-effort; failures are warnings and never roll back or
    // invalidate the newly installed generation.
    for (const [name, pipeline] of previousPipelines) {
      if (nextPipelines.get(name) !== pipeline) {
        this.host.retireAfterPublication(`render pipeline ${name}`, () => pipeline.dispose(), graph.warnings);
      }
    }
    for (const [name, pipeline] of previousComputePipelines) {
      if (nextComputePipelines.get(name) !== pipeline) {
        this.host.retireAfterPublication(`compute pipeline ${name}`, () => pipeline.dispose(), graph.warnings);
      }
    }
    if (candidateResourceManager && previousResourceManager !== candidateResourceManager) {
      this.host.retireAfterPublication(
        "resource manager",
        () => previousResourceManager?.dispose(),
        graph.warnings,
      );
    }
    for (const [name, buffer] of retiredStorageBuffers) {
      this.host.retireAfterPublication(`storage buffer ${name}`, () => buffer.destroy(), graph.warnings);
    }
    if (sessionChanged && !appliesReset) {
      if (hadInstalledPipeline) {
        this.host.retireAfterPublication(
          "previous shader time state",
          () => this.host.timeManager.cleanup(),
          graph.warnings,
        );
      }
      this.host.retireAfterPublication("previous canvas contents", () => this.host.clearCanvas(), graph.warnings);
    }
    if (!candidateResourceManager && this.resourceManager) {
      const shaderTime = this.host.timeManager.getCurrentTime(performance.now());
      this.host.retireAfterPublication(
        "installed video synchronization",
        () => this.resourceManager?.syncAllVideosToTime?.(shaderTime),
        graph.warnings,
      );
      if (this.host.timeManager.isPaused()) {
        this.host.retireAfterPublication(
          "installed video pause state",
          () => this.resourceManager?.pauseAllVideos?.(),
          graph.warnings,
        );
      } else {
        this.host.retireAfterPublication(
          "installed video playback state",
          () => this.resourceManager?.resumeAllVideos?.(),
          graph.warnings,
        );
      }
    }

  }

  failedCompilation(
    path: string,
    generation: number,
    result: CompilationResult,
  ): CompilationResult {
    if (generation !== this.compileGeneration || this.host.disposed) {
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
    }

    if (!this.host.storage.pendingReset && this.shaderPath !== "" && this.shaderPath !== path) {
      this.discardInstalledGeneration();
      this.host.stopRenderLoop();
      this.host.clearCanvas();
    }

    // Every failing pass reports a shared module's error, so collapse them
    // before the result leaves the engine.
    return { ...result, errors: dedupeCompilerErrors(result.errors) };
  }

  discardInstalledGeneration(): void {
    const passPipelines = [...this.passPipelines.values()];
    const computePipelines = [...this.computePipelines.values()];
    const resourceManager = this.resourceManager;

    this.passPipelines.clear();
    this.passKeys.clear();
    this.computePipelines.clear();
    this.computeKeys.clear();
    this.passGraph = [];
    this.dispatchOnceRan.clear();
    this.hasSubmittedFrameForInstalledGeneration = false;
    this.installedCompile = null;
    this.installedResourceKey = null;
    this.currentConfig = null;
    this.shaderPath = "";
    this.customUniformManager = new CustomUniformManager();

    for (const buffer of this.host.storage.storageBuffers.values()) {
      try {
        buffer.destroy();
      } catch {
        // The failed switch must preserve its compilation error even when
        // best-effort GPU cleanup is unavailable.
      }
    }
    this.host.storage.storageBuffers.clear();
    this.host.storage.storageKeys.clear();
    this.host.storage.storageLayouts.clear();
    this.host.storage.resetStorageOnNextSync = false;

    for (const pipeline of [...passPipelines, ...computePipelines]) {
      try {
        pipeline.dispose();
      } catch {
        // See storage cleanup above.
      }
    }

    this.resourceManager = this.host.device
      ? new ResourceManager(new WebGPUTextureBackend(this.host.device))
      : null;
    this.resourceManager?.setGlobalAudioState(this.host.globalVolume, this.host.globalMuted);
    try {
      resourceManager?.dispose?.();
    } catch {
      // See storage cleanup above.
    }
    this.host.timeManager.cleanup();
  }

  async compileDebugPlan(
    plan: DebugInstrumentationPlan,
    config?: ShaderConfig | null,
  ): Promise<CompilationResult | undefined> {
    const root = plan.files.find((file) => file.uri === plan.rootUri);
    if (!root) {
      return { success: false, errors: ["Debug plan root is missing"] };
    }
    const previous = this.lastCompile;
    const selectedSource = plan.files.find((file) => file.uri === plan.selectedSourceUri);
    const commonSource = plan.files.find(file => file.uri !== root.uri && (
      previous?.slangSourcePaths?.common === file.path
      || (root.path.toLowerCase().endsWith(".wgsl") && file.moduleName === "")
    ));
    const planModules: SlangSourceModule[] = plan.files
      .filter(file => file.uri !== root.uri && file.uri !== commonSource?.uri)
      // Debug wrappers render as Image, including compute replay.
      .map(file => ({ ...file, ownerPass: "Image" }));
    const planModulePaths = new Set(planModules.map((module) => module.path));
    const modules = [
      ...(previous?.slangModules.filter((module) => !planModulePaths.has(module.path)) ?? []),
      ...planModules,
    ];
    const result = await this.compileShaderPipeline(
      root.source,
      config ?? previous?.config ?? this.currentConfig,
      previous?.path ?? root.path,
      commonSource
        ? { ...(previous?.buffers ?? {}), common: commonSource.source }
        : previous?.buffers ?? {},
      previous?.customUniformDeclarations ?? this.customUniformManager.getDeclarations(),
      previous?.customUniformInfo ?? this.customUniformManager.getUniformInfo(),
      modules,
      previous?.slangSourcePath ?? root.path,
      previous?.slangSourcePaths,
    );
    if (!result || result.success || result.superseded) {
      return result;
    }

    const selectedLabel = selectedSource?.path ?? plan.selectedSourceUri;
    return {
      ...result,
      errors: (result.errors?.length ? result.errors : ["Unknown debug plan compilation error"])
        .map((error) => error.includes(selectedLabel) || error.includes(plan.selectedSourceUri)
          ? error
          : `${selectedLabel}: ${error}`),
    };
  }

  async updateBufferAndRecompile(
    bufferName: string,
    bufferContent: string,
  ): Promise<CompilationResult | undefined> {
    if (!this.lastCompile) {
      return { success: false, errors: ["Cannot update a buffer before a shader has been compiled"] };
    }
    this.lastCompile.buffers = { ...this.lastCompile.buffers, [bufferName]: bufferContent };
    return this.compileShaderPipeline(
      this.lastCompile.code,
      this.lastCompile.config,
      this.lastCompile.path,
      this.lastCompile.buffers,
      this.lastCompile.customUniformDeclarations,
      this.lastCompile.customUniformInfo,
      this.lastCompile.slangModules,
      this.lastCompile.slangSourcePath,
      this.lastCompile.slangSourcePaths,
    );
  }

  visibleCustomUniformManager(): CustomUniformManager {
    const pending = this.installedCompile || this.host.disposed ? null : this.lastCompile;
    if (!pending?.customUniformDeclarations || !pending.customUniformInfo) {
      return this.customUniformManager;
    }
    const manager = new CustomUniformManager();
    manager.loadDeclarations(pending.customUniformDeclarations, pending.customUniformInfo);
    if (this.pendingCustomUniformValues) {
      manager.updateValues(this.pendingCustomUniformValues);
    }
    return manager;
  }

  setCustomUniformValues(values: CustomUniform[]): void {
    this.pendingCustomUniformValues = values.map((value) => this.copyCustomUniform(value));
    this.customUniformManager.setValues(values);
  }

  updateCustomUniformValues(changed: CustomUniform[]): void {
    const pending = new Map((this.pendingCustomUniformValues ?? []).map((value) => [value.name, value]));
    for (const value of changed) {
      pending.set(value.name, this.copyCustomUniform(value));
    }
    this.pendingCustomUniformValues = [...pending.values()];
    this.customUniformManager.updateValues(changed);
  }

  copyCustomUniform(value: CustomUniform): CustomUniform {
    return {
      ...value,
      value: Array.isArray(value.value) ? [...value.value] : value.value,
    };
  }
  /** Detach live state before retiring resources; storage retires before pipelines. */
  detachPipelines(): (attempt: (cleanup: () => void) => void) => void {
    const passPipelines = [...this.passPipelines.values()];
    const computePipelines = [...this.computePipelines.values()];
    this.passPipelines.clear();
    this.passKeys.clear();
    this.computePipelines.clear();
    this.computeKeys.clear();
    this.dispatchOnceRan.clear();
    this.hasSubmittedFrameForInstalledGeneration = false;
    this.passGraph = [];
    this.installedCompile = null;
    this.installedResourceKey = null;
    return (attempt) => {
      for (const pipeline of passPipelines) {
        attempt(() => pipeline.dispose());
      }
      for (const pipeline of computePipelines) {
        attempt(() => pipeline.dispose());
      }
    };
  }

  disposeResources(): void {
    const manager = this.resourceManager;
    this.resourceManager = null;
    const dispose = manager?.dispose?.bind(manager) ?? manager?.cleanup?.bind(manager);
    dispose?.();
  }

}
