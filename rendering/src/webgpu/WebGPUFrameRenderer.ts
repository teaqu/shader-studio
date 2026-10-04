import { FULLSCREEN_VERTEX_COUNT } from "@shader-studio/types";
import { depthClearValue, geometryInstanceCount, meshTopology, resolveRenderState, verticesVertexCount } from "../types/Geometry";
import type { WebGPUGeometry } from "./WebGPUGeometry";
import type {
  CaptureCustomUniform
} from "../capture/VariableCapturer";
import { CameraManager } from "../input/CameraManager";
import { KeyboardManager } from "../input/KeyboardManager";
import { MouseManager } from "../input/MouseManager";
import { OrbitCamera } from "../preview3d/OrbitCamera";
import { createModelMatrix,createNormalMatrix3 } from "../preview3d/math";
import { FPSCalculator } from "../util/FPSCalculator";
import { TimeManager } from "../util/TimeManager";
import { getShaderToyChannelCount } from "./SlangPrelude";
import type { WebGPUChannels } from "./WebGPUChannels";
import type { WebGPUDeviceConstraints } from "./WebGPUDeviceConstraints";
import { resolveWorkgroupCounts,validateWorkgroupCounts } from "./WebGPUDispatch";
import type { WebGPUFrameTiming } from "./WebGPUFrameTiming";
import { WebGPUPixelRegionCapturer } from "./WebGPUPixelRegionCapturer";
import type { WebGPUShaderSession } from "./WebGPUShaderSession";
import type { WebGPUStorage } from "./WebGPUStorage";
import {
  packShaderToyUniforms,
  type ShaderToyUniformInput
} from "./uniforms";

interface WebGPUFrameRendererHost {
  timing: Pick<WebGPUFrameTiming, "probeGpuFrameTime" | "recordFrameTime" | "shouldRenderFrame" | "trackFrameInFlight">;
  session: Pick<WebGPUShaderSession, "computePipelines" | "customUniformManager" | "dispatchOnceRan" | "hasSubmittedFrameForInstalledGeneration" | "passGraph" | "passPipelines" | "resourceManager" | "shaderPath">;
  channels: Pick<WebGPUChannels, "getChannelResources" | "getChannelUniforms">;
  storage: Pick<WebGPUStorage, "storageBuffers" | "storageLayouts">;
  constraints: Pick<WebGPUDeviceConstraints, "resolveComputeWorkgroupLimit">;
  device: GPUDevice | null;
  context: GPUCanvasContext | null;
  clearCanvas(): void;
  timeManager: TimeManager;
  fps: FPSCalculator;
  cameraManager: CameraManager;
  mouseManager: MouseManager;
  meshCamera: OrbitCamera;
  geometry: Pick<WebGPUGeometry, "passCameraMatrices" | "resolvePassMesh" | "resolvePassVertexCount">;
  canvas: HTMLCanvasElement | null;
  pixelRegionCapturer: WebGPUPixelRegionCapturer | null;
  keyboardManager: KeyboardManager;
}

type FrameUniformInput = Pick<
  ShaderToyUniformInput,
  "time" | "timeDelta" | "frameRate" | "frame" | "mouse" | "date" | "cameraPos" | "cameraDir"
>;

/** Owns frameRenderer state and operations; dependencies stay live across compilation swaps. */
export class WebGPUFrameRenderer {
  constructor(private readonly host: WebGPUFrameRendererHost) {}

  pausedUniformInput: Pick<
    ShaderToyUniformInput,
    "time" | "timeDelta" | "frameRate" | "frame" | "mouse" | "date" | "cameraPos" | "cameraDir"
  > | null = null;

  pausedCustomUniformValues: CaptureCustomUniform[] | null = null;

  lastCameraTimestamp: number | null = null;

  resetPausedFrame(): void {
    this.pausedUniformInput = null;
    this.pausedCustomUniformValues = null;
  }

  pendingScreenshotCopies: Array<(encoder: GPUCommandEncoder, texture: GPUTexture) => void> = [];
  private completedComputePasses: ReadonlySet<string> = new Set();

  renderFrame(time: number, capture: boolean, imageOnly = false, captureCanvas?: (encoder: GPUCommandEncoder, texture: GPUTexture) => void): void {
    if (!this.host.device || !this.host.context) {
      return;
    }
    if (!capture && !this.host.timing.shouldRenderFrame(time)) {
      return;
    }
    if (this.host.session.passGraph.length === 0) {
      // WebGL clears on every rendered frame without an Image pass. Repeating
      // the clear matters for WebGPU canvas presentation: a single submitted
      // clear during an async failed switch can otherwise leave an older
      // swap-chain image visible even though its pipeline has been removed.
      if (this.host.session.shaderPath !== "") {
        this.host.clearCanvas();
      }
      return;
    }

    const isPaused = this.host.timeManager.isPaused();

    if (!capture && !this.advanceLiveFrame(time, isPaused)) {
      return;
    }

    // WebGL pause parity: freeze the per-frame uniform inputs at the values
    // captured when the pause began, so e.g. mouse movement can't keep
    // driving a "paused" shader.
    const { frameInput, frameCustomUniformValues } = this.resolveFrameUniforms(time, isPaused);

    // A shader installed while paused still submits one complete initial
    // frame. TimeManager's frame stays at zero while paused, so the engine
    // owns this submission state instead of inferring it from iFrame.
    const skipBufferPasses = isPaused && this.host.session.hasSubmittedFrameForInstalledGeneration;

    const encoder = this.host.device.createCommandEncoder();
    let canvasTexture: GPUTexture | null = null;
    const encodedComputePasses = new Set<string>();
    const pendingDispatchOnce = new Set<string>();

    for (const pass of this.host.session.passGraph) {
      if (imageOnly || pass.kind !== "compute" || skipBufferPasses) {
        continue;
      }
      if (pass.dispatchOnce && this.host.session.dispatchOnceRan.has(pass.name)) {
        continue;
      }
      const pipeline = this.host.session.computePipelines.get(pass.name);
      const gpuPipeline = pipeline?.getPipeline();
      const uniformBuffer = pipeline?.getUniformBuffer();
      if (!pipeline || !gpuPipeline || !uniformBuffer) {
        continue;
      }

      const channelResources = this.host.channels.getChannelResources(pass, isPaused, encodedComputePasses);
      const workgroupCounts = resolveWorkgroupCounts(
        pass,
        this.host.storage.storageLayouts,
        channelResources ?? [],
      );
      if (channelResources === null || workgroupCounts === null) {
        continue;
      }
      if (validateWorkgroupCounts(
        pass.name,
        workgroupCounts,
        this.host.constraints.resolveComputeWorkgroupLimit(),
      )) {
        continue;
      }
      pipeline.rebuildBindGroups(channelResources, this.host.storage.storageBuffers);
      const bindGroups = Array.from({ length: pass.dispatchCount }, (_, index) =>
        pipeline.getBindGroup(index));
      if (bindGroups.some((bindGroup) => bindGroup === null)) {
        continue;
      }

      const data = packShaderToyUniforms({
        channelCount: getShaderToyChannelCount(pass.channels),
        width: pass.width,
        height: pass.height,
        ...frameInput,
        ...this.host.channels.getChannelUniforms(pass),
      }, this.host.session.customUniformManager.getUniformInfo(), frameCustomUniformValues);
      this.host.device.queue.writeBuffer(uniformBuffer, 0, data);

      const computePass = encoder.beginComputePass();
      let operationFailed = false;
      try {
        computePass.setPipeline(gpuPipeline);
        for (const bindGroup of bindGroups) {
          computePass.setBindGroup(0, bindGroup!);
          computePass.dispatchWorkgroups(...workgroupCounts);
        }
      } catch (error) {
        operationFailed = true;
        throw error;
      } finally {
        try {
          computePass.end();
        } catch (endError) {
          if (!operationFailed) {
            throw endError;
          }
        }
      }
      if (pass.dispatchOnce) {
        pendingDispatchOnce.add(pass.name);
      }
      encodedComputePasses.add(pass.name);
    }

    for (const pass of this.host.session.passGraph) {
      if (pass.kind === "compute" || (imageOnly && pass.output !== "canvas")) {
        continue;
      }
      if (skipBufferPasses && pass.output === "texture") {
        continue;
      }
      const pipeline = this.host.session.passPipelines.get(pass.name);
      if (!pipeline?.getPipeline() || !pipeline.getUniformBuffer()) {
        continue;
      }

      // All-or-nothing: the pass's WGSL was compiled against its full channel
      // list, so if any channel source is unresolvable this frame, binding the
      // survivors positionally would mis-bind them. Skip the pass entirely.
      const channelResources = this.host.channels.getChannelResources(
        pass, isPaused, imageOnly ? this.completedComputePasses : encodedComputePasses, imageOnly,
      );
      if (channelResources === null) {
        continue;
      }

      // Passes with channels or storage have no eager bind group: their
      // explicit layout requires live resources, so it must be (re)built
      // before the bind-group presence check.
      if (channelResources.length > 0 || this.host.storage.storageLayouts.size > 0) {
        pipeline.rebuildBindGroup(channelResources, this.host.storage.storageBuffers);
      }
      const bindGroup = pipeline.getBindGroup();
      if (!bindGroup) {
        continue;
      }

      const fullscreen = !pass.geometry || pass.geometry === "fullscreen";
      const mesh = this.host.geometry.resolvePassMesh(pass);
      const camera = this.host.geometry.passCameraMatrices(pass);
      const data = packShaderToyUniforms({
        channelCount: getShaderToyChannelCount(pass.channels),
        width: pass.width,
        height: pass.height,
        vertexCount: this.host.geometry.resolvePassVertexCount(pass),
        instanceCount: geometryInstanceCount(pass),
        viewMatrix: camera.view,
        projectionMatrix: camera.projection,
        viewProjection: camera.viewProjection,
        ...frameInput,
        ...this.host.channels.getChannelUniforms(pass),
      }, this.host.session.customUniformManager.getUniformInfo(), frameCustomUniformValues);
      this.host.device.queue.writeBuffer(pipeline.getUniformBuffer()!, 0, data);
      if (pass.geometry && pass.geometry !== "fullscreen" && pipeline.getMeshUniformBuffer?.()) {
        const model = createModelMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
        const viewProjection = camera.viewProjection;
        const normal = createNormalMatrix3(model);
        const meshData = new Float32Array(64);
        meshData.set(model, 0);
        meshData.set(viewProjection, 16);
        meshData.set([normal[0], normal[1], normal[2], 0, normal[3], normal[4], normal[5], 0, normal[6], normal[7], normal[8], 0, 0, 0, 0, 1], 32);
        meshData.set([...this.host.meshCamera.getPosition(), 1], 48);
        this.host.device.queue.writeBuffer(pipeline.getMeshUniformBuffer()!, 0, meshData);
      }

      const targetView = pass.output === "canvas"
        ? (canvasTexture = this.host.context.getCurrentTexture()).createView()
        : pipeline.getCurrentOutputView();
      if (!targetView) {
        continue;
      }

      const renderState = resolveRenderState(pass);
      const [clearR, clearG, clearB, clearA] = renderState.clear;
      // With MSAA the pass draws into the multisampled texture and resolves into
      // its output; the samples themselves are not needed after the pass.
      const msaaView = pipeline.getMsaaView?.() ?? null;
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          ...(msaaView ? { view: msaaView, resolveTarget: targetView, storeOp: "discard" as const } : { view: targetView, storeOp: "store" as const }),
          clearValue: { r: clearR, g: clearG, b: clearB, a: clearA },
          loadOp: "clear",
        }],
        ...(pass.geometry && pass.geometry !== "fullscreen" && pipeline.getDepthView?.() ? {
          depthStencilAttachment: { view: pipeline.getDepthView()!, depthClearValue: depthClearValue(renderState), depthLoadOp: "clear", depthStoreOp: "store" },
        } : {}),
      });
      renderPass.setPipeline(pipeline.getPipeline()!);
      renderPass.setBindGroup(0, bindGroup);
      if (fullscreen) {
        renderPass.draw(FULLSCREEN_VERTEX_COUNT);
      } else if (pass.geometry === "vertices") {
        // Non-indexed with no vertex buffers; mainVertex places every vertex.
        renderPass.draw(verticesVertexCount(pass), geometryInstanceCount(pass));
      } else if (mesh) {
        renderPass.setVertexBuffer(0, mesh.vertexBuffer);
        const topology = meshTopology(pass);
        if (topology === "point-list") {
          // Each unique vertex once, without the index buffer.
          renderPass.draw(mesh.vertexCount, geometryInstanceCount(pass));
        } else if (topology === "line-list") {
          renderPass.setIndexBuffer(mesh.edgeIndexBuffer, mesh.indexFormat);
          renderPass.drawIndexed(mesh.edgeIndexCount, geometryInstanceCount(pass));
        } else {
          renderPass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
          renderPass.drawIndexed(mesh.indexCount, geometryInstanceCount(pass));
        }
      }
      renderPass.end();
    }

    if (canvasTexture && this.host.canvas) {
      captureCanvas?.(encoder, canvasTexture);
      if (!capture && this.pendingScreenshotCopies.length > 0) {
        const captures = this.pendingScreenshotCopies;
        this.pendingScreenshotCopies = [];
        for (const copy of captures) {
          copy(encoder, canvasTexture);
        }
      }
      this.host.pixelRegionCapturer?.encodeAfterRender(encoder, canvasTexture, this.host.canvas.width, this.host.canvas.height);
    }
    this.host.device.queue.submit([encoder.finish()]);
    this.host.session.hasSubmittedFrameForInstalledGeneration = true;
    this.host.timing.probeGpuFrameTime();
    this.host.timing.trackFrameInFlight();
    this.host.pixelRegionCapturer?.beginMappings();

    for (const passName of pendingDispatchOnce) {
      this.host.session.dispatchOnceRan.add(passName);
    }
    for (const passName of encodedComputePasses) {
      this.host.session.computePipelines.get(passName)?.swap();
    }
    if (!imageOnly) {
      this.completedComputePasses = encodedComputePasses;
    }

    if (!skipBufferPasses && !imageOnly) {
      for (const pass of this.host.session.passGraph) {
        if (pass.output === "texture") {
          this.host.session.passPipelines.get(pass.name)?.swap();
        }
      }
    }

    if (!capture) {
      this.host.timing.recordFrameTime(time);
      this.host.keyboardManager.clearPressed();
      this.host.mouseManager.endFrame();
      if (!isPaused) {
        this.host.timeManager.incrementFrame();
      }
    }
  }

  /** Advances non-capture state before any GPU commands are encoded. */
  private advanceLiveFrame(time: number, isPaused: boolean): boolean {
    this.host.timeManager.updateFrame(time);
    // Preserve WebGL's duplicate-panel guard before touching resources or
    // camera state, exactly as the former inline phase did.
    if (this.host.timeManager.getDeltaTime() === 0 && this.host.timeManager.getFrame() !== 0) {
      return false;
    }
    if (!isPaused) {
      this.host.fps.updateFrame(time);
    }
    this.host.session.resourceManager?.updateAudioTextures?.();
    this.host.session.resourceManager?.updateVideoTextures?.();
    const cameraDelta = this.lastCameraTimestamp === null
      ? 0
      : (time - this.lastCameraTimestamp) / 1000;
    this.lastCameraTimestamp = time;
    this.host.cameraManager.update(cameraDelta);
    return true;
  }

  /** Freezes paused values once, then supplies the exact input used by every pass. */
  private resolveFrameUniforms(
    time: number,
    isPaused: boolean,
  ): { frameInput: FrameUniformInput; frameCustomUniformValues: CaptureCustomUniform[] } {
    if (isPaused && this.pausedUniformInput === null) {
      this.pausedCustomUniformValues = this.host.session.customUniformManager.getCurrentValues();
      this.pausedUniformInput = {
        time: this.host.timeManager.getCurrentTime(time),
        timeDelta: this.host.timeManager.getDeltaTime(),
        frameRate: this.host.fps.getRawFPS(),
        frame: this.host.timeManager.getFrame(),
        mouse: Array.from(this.host.mouseManager.getMouse()),
        date: Array.from(this.host.timeManager.getCurrentDate()),
        cameraPos: Array.from(this.host.cameraManager.getCameraPos()),
        cameraDir: Array.from(this.host.cameraManager.getCameraDir()),
      };
    } else if (!isPaused) {
      this.pausedUniformInput = null;
      this.pausedCustomUniformValues = null;
    }
    const frameInput = this.pausedUniformInput ?? {
      time: this.host.timeManager.getCurrentTime(time),
      timeDelta: this.host.timeManager.getDeltaTime(),
      frameRate: this.host.fps.getRawFPS(),
      frame: this.host.timeManager.getFrame(),
      mouse: this.host.mouseManager.getMouse(),
      date: this.host.timeManager.getCurrentDate(),
      cameraPos: this.host.cameraManager.getCameraPos(),
      cameraDir: this.host.cameraManager.getCameraDir(),
    };
    return {
      frameInput,
      frameCustomUniformValues: this.pausedCustomUniformValues
        ?? this.host.session.customUniformManager.getCurrentValues(),
    };
  }
}
