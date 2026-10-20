import type { DebugInstrumentationPlan, ShaderConfig, ShaderLanguageId, SlangSourceModule, StorageBufferSnapshot } from "@shader-studio/types";
import type { RenderPassNode } from "./PassGraph";
import type { CompilationResult, Pass } from "../models";
import type { TimeManager } from "../util/TimeManager";
import type { IVariableCapturer, CaptureUniforms, CaptureCustomUniform, CaptureCompileContext } from "../capture/VariableCapturer";
import type { PixelRegionResult } from "./PixelRegion";
import type { FeedbackReadback, ViewerInputEvent, ViewerInputListener, ViewerInputState } from './ViewerInteraction';
import type { VrNavigationSettings } from "../webxr/VrNavigationSettings";

export interface RenderingEngine {
  refreshScriptStreamStatus?(): void;
  receiveScriptStreamStatus?(status: import('@shader-studio/types').ScriptStreamQueueStatus): void;
  getScriptStreamStatus?(): (import('@shader-studio/types').ScriptStreamInfo & { queued: number; lastFrame: number })[];
  configureScriptStreams?(info: import('@shader-studio/types').ScriptStreamInfo[], session: number, send: (request: import('../webgpu/ScriptStreamDelivery').ScriptStreamRequest) => void): void;
  receiveScriptStreamFrame?(frame: import('@shader-studio/types').ScriptStreamFrame, request: number): boolean;
  initialize(glCanvas: HTMLCanvasElement, preserveDrawingBuffer?: boolean): void;
  handleCanvasResize(width: number, height: number): void;
  compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers?: Record<string, string>,
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
    slangModules?: SlangSourceModule[],
    slangSourcePath?: string,
    slangSourcePaths?: Record<string, string>,
  ): Promise<CompilationResult | undefined>;
  /** Compile a complete, in-place Slang debug workspace when the backend supports Slang. */
  compileDebugPlan?(plan: DebugInstrumentationPlan, config?: ShaderConfig | null): Promise<CompilationResult | undefined>;
  getCurrentConfig(): ShaderConfig | null;
  readStorageBuffer(name: string, start: number, count: number, point?: import('@shader-studio/types').StorageCapturePoint, maxBytes?: number): Promise<StorageBufferSnapshot>;
  resetStorageBuffer(name: string): Promise<void>;
  writeStorageBuffer(name: string, start: number, data: ArrayBuffer): Promise<void>;
  setInputEnabled(enabled: boolean): void;
  injectInput(events: readonly ViewerInputEvent[]): ViewerInputState;
  subscribeInput(listener: ViewerInputListener): { dispose(): void };
  readFeedback(pass: string, x: number, y: number, width: number, height: number): FeedbackReadback;
  isVrPreviewAvailable?(): boolean;
  setVrPreviewEnabled?(enabled: boolean): void;
  isImmersiveVrSupported?(): Promise<boolean>;
  enterVr?(onEnded?: (error?: string) => void): Promise<void>;
  exitVr?(): Promise<void>;
  setVrNavigationSettings?(settings: VrNavigationSettings): void;
  updateBufferAndRecompile(bufferName: string, bufferContent: string): Promise<CompilationResult | undefined>;
  getPasses(): (Pass | RenderPassNode)[];
  /** Effective colour-attachment limits of the installed WebGPU device. */
  getRenderOutputLimits?(): { maxColorAttachments: number; maxColorAttachmentBytesPerSample: number } | null;
  togglePause(): void;
  getTimeManager(): TimeManager;
  resetTime(): void;
  flagReloadOnNextApply(): void;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  render(time?: number): void;
  getCurrentFPS(): number;
  /** Mouse in shader convention: xy position, zw click. */
  getMouse(): [number, number, number, number];
  /** Per-channel clocks for the Image pass, in channel-index order. */
  getChannelTimes(): number[];
  /** Audio sample rate, or 44100 when no audio is loaded. */
  getAudioSampleRate(): number;
  getFrameTimeHistory(): number[];
  getFrameTimeCount(): number;
  /**
   * Milliseconds from submitting a frame's work to the GPU reporting it done,
   * or null where the backend cannot tell. The render loop runs on animation
   * frames and does not wait for the GPU, so this is what reveals a backend
   * queueing frames faster than the hardware retires them — the loop reports a
   * healthy rate while the picture on screen falls behind.
   */
  getGpuFrameTimeMs?(): number | null;
  /** Same indexing as getFrameTimeHistory(): entry i in each is the same frame. */
  getGpuFrameTimeHistory?(): number[];
  /**
   * Turns the GPU timing probe on or off. It is off by default so a preview
   * nobody is measuring pays nothing for it.
   */
  setGpuTimingEnabled?(enabled: boolean): void;
  setFPSLimit(limit: number): void;
  getUniforms(): import("../models").PassUniforms;
  cleanup(): void;
  requestPixelRegion(requestId: number, centerX: number, centerY: number): boolean;
  collectPixelRegionResults(): PixelRegionResult[];
  cancelPixelRegionRequests(): void;
  createVariableCapturer(): IVariableCapturer;
  getVariableCaptureCompileContext(code?: string, passName?: string, sourcePath?: string | null): CaptureCompileContext;
  /** Shader source dialect the engine renders ('glsl' for WebGL, 'slang'/'wgsl' for WebGPU). */
  getShaderLanguage(): ShaderLanguageId;
  getCaptureUniforms(): CaptureUniforms;
  resumeAudioContext(): Promise<void>;
  resumeAllAudio(): void;
  resumeAllVideos(): void;
  releaseMediaResetHold(): void;
  updateAudioLoopRegion(path: string, startTime?: number, endTime?: number): void;
  setGlobalVolume(volume: number, muted: boolean): void;
  controlVideo(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void;
  getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null;
  controlAudio(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void;
  getAudioState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null;
  seekAudio(path: string, time: number): void;
  controlAudioInput?(action: "start" | "stop", deviceId?: string): Promise<string | undefined>;
  controlSystemAudio?(action: "start" | "stop", deviceId?: string): Promise<string | undefined>;
  controlScreen?(action: "start" | "stop"): Promise<string | undefined>;
  getLiveInputPreview?(type: import("../resources/LiveInputTextureManager").LiveInputType): import("../resources/LiveInputTextureManager").LiveInputPreview | null;
  getAudioFFTData(type: string, path?: string): Uint8Array | null;
  getCustomUniformInfo(): { name: string; type: string }[];
  getCustomUniformDeclarations(): string;
  getCurrentCustomUniforms(): CaptureCustomUniform[];
  setCustomUniformValues(values: { name: string; type: string; value: number | number[] | boolean }[]): void;
  updateCustomUniformValues(changed: { name: string; type: string; value: number | number[] | boolean }[]): void;
  renderForCapture(): void;
  /** Custom uniform values of the displayed frame: frozen values while paused. */
  getDisplayedCustomUniforms(): { name: string; type: string; value: number | number[] | boolean }[];
  /** Read the currently displayed Image pass without advancing time or feedback state. */
  captureCurrentFrame(): Promise<ImageData>;
  getCanvas(): HTMLCanvasElement | null;
  dispose(): void;
}
