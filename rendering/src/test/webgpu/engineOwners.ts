import type { WebGPUDeviceConstraints } from "../../webgpu/WebGPUDeviceConstraints";
import type { WebGPUStorage } from "../../webgpu/WebGPUStorage";
import type { WebGPUPipelineCandidates } from "../../webgpu/WebGPUPipelineCandidates";
import type { WebGPUCompilerLoader } from "../../webgpu/WebGPUCompilerLoader";
import type { WebGPUFrameTiming } from "../../webgpu/WebGPUFrameTiming";
import type { WebGPUCapture } from "../../webgpu/WebGPUCapture";
import type { WebGPUShaderSession } from "../../webgpu/WebGPUShaderSession";
import type { WebGPUFrameRenderer } from "../../webgpu/WebGPUFrameRenderer";
import type { WebGPUChannels } from "../../webgpu/WebGPUChannels";

interface EngineOwners {
  constraints: WebGPUDeviceConstraints;
  storage: WebGPUStorage;
  candidates: WebGPUPipelineCandidates;
  compilerLoader: WebGPUCompilerLoader;
  timing: WebGPUFrameTiming;
  capture: WebGPUCapture;
  session: WebGPUShaderSession;
  frameRenderer: WebGPUFrameRenderer;
  channels: WebGPUChannels;
}

/** White-box fixtures target the component that owns state, without expanding the production API. */
export function engineOwners(engine: unknown): EngineOwners {
  return engine as EngineOwners;
}
