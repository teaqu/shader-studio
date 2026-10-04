import { nativeRasterCaptureContext } from "./NativeRasterCaptureContext";
import { captureFeedbackChannels } from "./CaptureFeedbackChannels";
import { meshUniformData } from "./MeshUniformData";
import type { RenderedCaptureState } from "./RenderedCaptureState";
import type { OrbitCamera } from "../preview3d/OrbitCamera";
import type { WebGPUMeshResources } from "./WebGPUMeshResources";
import { geometryInstanceCount } from "../types/Geometry";
import type { WebGPUGeometry } from "./WebGPUGeometry";
import type { ShaderLanguageId } from "@shader-studio/types";
import type {
  CaptureCompileContext,
  CaptureUniforms,
  IVariableCapturer
} from "../capture/VariableCapturer";
import type { PassUniforms } from "../models";
import type { StorageBindingNode } from "../types/PassGraph";
import { TimeManager } from "../util/TimeManager";
import { type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import { getSlangChannels } from "./SlangBindingPlan";
import {
  buildSlangPassGraph,
  type RenderPassNode
} from "./SlangPassGraph";
import type { WebGPUChannels } from "./WebGPUChannels";
import type { ShaderCompileSnapshot } from "./WebGPUCompilationTypes";
import type { WebGPUDeviceConstraints } from "./WebGPUDeviceConstraints";
import type { WebGPUShaderSession } from "./WebGPUShaderSession";
import type { WebGPUStorage } from "./WebGPUStorage";
import { WebGPUVariableCapturer } from "./WebGPUVariableCapturer";

interface WebGPUCaptureHost {
  session: Pick<WebGPUShaderSession, "installedCompile" | "lastCompile" | "passGraph" | "passPipelines">;
  renderedCaptureState: RenderedCaptureState;
  meshCamera: OrbitCamera;
  meshResources: WebGPUMeshResources | null;
  geometry: Pick<WebGPUGeometry, "passCameraMatrices" | "resolvePassVertexCount">;
  channels: Pick<WebGPUChannels, "getChannelResources" | "getChannelUniforms">;
  storage: Pick<WebGPUStorage, "storageBuffers" | "storageLayouts">;
  constraints: Pick<WebGPUDeviceConstraints, "resolveComputeWorkgroupLimits" | "resolveMaxOutputLayers" | "resolveMaxStorageBuffers">;
  device: GPUDevice | null;
  compiler: AsyncSlangCompiler | null;
  timeManager: TimeManager;
  disposed: boolean;
  language: ShaderLanguageId;
  canvas: HTMLCanvasElement | null;
  getUniforms(): PassUniforms;
}

/** Owns capture state and operations; dependencies stay live across compilation swaps. */
export class WebGPUCapture {
  constructor(private readonly host: WebGPUCaptureHost) {}

  capturePassName: string | null = null;

  createVariableCapturer(): IVariableCapturer {
    if (!this.host.device || !this.host.compiler) {
      throw new Error("Variable capture requires an initialized WebGPU engine");
    }
    return new WebGPUVariableCapturer(
      this.host.device,
      this.host.compiler,
      this.getVariableCaptureCompileContext(),
      (context) => {
        const pass = this.host.session.passGraph.find((candidate) => candidate.name === context.slangPassName)
          ?? this.host.session.passGraph.find((candidate) => candidate.name === "Image")
          ?? this.host.session.passGraph[0];
        // Paused capture reads the keyboard texture the frozen frame was drawn
        // with, matching the render path and the WebGL capturer.
        return pass ? this.host.channels.getChannelResources(pass, this.host.timeManager.isPaused()) : [];
      },
      () => this.host.storage.storageBuffers,
    );
  }

  getVariableCaptureCompileContext(
    code?: string,
    passName?: string,
    sourcePath?: string | null,
  ): CaptureCompileContext {
    const snapshot = this.host.session.installedCompile ?? (this.host.disposed ? null : this.host.session.lastCompile);
    const graph = this.getVariableCapturePassGraph(snapshot);
    const configuredCommonCode = snapshot?.buffers.common ?? "";
    const isCapturingCommon = passName === "common"
      || (code !== undefined && code === configuredCommonCode);
    const targetPass = (passName
      ? graph.passes.find((pass) => pass.name === passName)
      : undefined) ?? (code
      ? graph.passes.find((pass) => pass.source === code)
      : undefined) ?? graph.passes.find((pass) => pass.name === "Image") ?? graph.passes[0];
    const ownerModules = (snapshot?.slangModules ?? [])
      .filter((module) => module.ownerPass === targetPass?.name);
    const selectedModuleIndex = sourcePath
      ? ownerModules.findIndex((module) => module.path === sourcePath)
      : -1;
    const selectedModule = selectedModuleIndex >= 0 ? ownerModules[selectedModuleIndex] : undefined;
    const commonCode = this.removeSelectedModuleImport(
      isCapturingCommon ? "" : configuredCommonCode,
      selectedModule?.moduleName,
    );
    const slangModules = (selectedModuleIndex >= 0
      ? ownerModules.slice(0, selectedModuleIndex)
      : ownerModules)
      .map(({ ownerPass: _ownerPass, ...module }) => module);
    this.capturePassName = targetPass?.name ?? null;
    return {
      commonCode,
      slangPassName: targetPass?.name,
      slangChannels: getSlangChannels(targetPass?.channels ?? []),
      slangStorage: graph.storage,
      slangStorageBuffers: this.host.storage.storageBuffers,
      slangModules,
      captureChannelSnapshot: () => this.host.device && targetPass
        ? captureFeedbackChannels(this.host.device, targetPass, this.host.session.passPipelines,
          this.host.renderedCaptureState.get(targetPass.name)?.channelResources ?? this.host.channels.getChannelResources(targetPass, true),
          this.host.renderedCaptureState.get(targetPass.name)?.bufferInputs) : null,
      nativeRender: nativeRasterCaptureContext(targetPass, () => this.host.meshResources, () =>
        this.host.renderedCaptureState.get(targetPass?.name ?? "")?.meshData
          ?? meshUniformData(this.host.meshCamera, targetPass?.width ?? 1, targetPass?.height ?? 1, targetPass?.useViewerCamera),
      Boolean(targetPass && this.host.session.passPipelines.get(targetPass.name)?.getDepthView())),
      ...(sourcePath ? { slangSourcePath: sourcePath } : {}),
    };
  }

  removeSelectedModuleImport(commonCode: string, moduleName?: string): string {
    if (!moduleName) {
      return commonCode;
    }
    const escapedName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return commonCode.replace(
      new RegExp(`^\\s*(?:__exported\\s+)?import\\s+${escapedName}\\s*;\\s*$`, "gm"),
      "",
    );
  }

  getVariableCapturePassGraph(
    snapshot: ShaderCompileSnapshot | null,
  ): { passes: RenderPassNode[]; storage: StorageBindingNode[] } {
    if (this.host.session.passGraph.length > 0 || !snapshot) {
      return {
        passes: this.host.session.passGraph,
        storage: [...this.host.storage.storageLayouts.values()],
      };
    }

    const graph = buildSlangPassGraph({
      language: this.host.language,
      imageCode: snapshot.code,
      config: snapshot.config,
      buffers: snapshot.buffers,
      canvasWidth: this.host.canvas?.width ?? 1,
      canvasHeight: this.host.canvas?.height ?? 1,
      computeWorkgroupLimits: this.host.constraints.resolveComputeWorkgroupLimits(),
      maxOutputLayers: this.host.constraints.resolveMaxOutputLayers(),
      maxStorageBuffers: this.host.constraints.resolveMaxStorageBuffers(),
    });
    return { passes: graph.passes, storage: graph.storage };
  }

  getCaptureUniforms(): CaptureUniforms {
    const rendered = this.capturePassName ? this.host.renderedCaptureState.get(this.capturePassName) : undefined;
    if (rendered) {
      return rendered.uniforms;
    }
    const u = this.host.getUniforms();
    const pass = this.host.session.passGraph.find((candidate) => candidate.name === this.capturePassName)
      ?? this.host.session.passGraph.find((candidate) => candidate.name === "Image")
      ?? this.host.session.passGraph[0];
    const channelUniforms = pass
      ? this.host.channels.getChannelUniforms(pass)
      : {
        channelTime: new Array<number>(4).fill(0),
        channelLoaded: new Array<number>(4).fill(0),
        sampleRate: u.sampleRate,
        channelResolution: new Array<number>(12).fill(0),
      };
    return {
      time: u.time,
      timeDelta: u.timeDelta,
      frameRate: u.frameRate,
      frame: u.frame,
      res: pass ? [pass.width, pass.height, 1] : u.res as number[],
      mouse: u.mouse as number[],
      date: u.date as number[],
      cameraPos: u.cameraPos as number[],
      cameraDir: u.cameraDir as number[],
      ...(pass ? { vertexCount: this.host.geometry.resolvePassVertexCount(pass), instanceCount: geometryInstanceCount(pass), camera: this.host.geometry.passCameraMatrices(pass) } : {}),
      ...channelUniforms,
    };
  }
}
