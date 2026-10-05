/// <reference types="@webgpu/types" />
import type { CaptureUniforms } from "../capture/VariableCapturer";

export interface RenderedCaptureChannel {
  slot: number;
  textureView: GPUTextureView;
  sampler?: GPUSampler;
}

export interface RenderedCaptureBufferInput {
  texture: GPUTexture;
  layer?: number;
}

export interface RenderedCaptureFrame {
  uniforms: CaptureUniforms;
  meshData?: Float32Array;
  channelResources?: RenderedCaptureChannel[];
  bufferInputs?: Map<number, RenderedCaptureBufferInput>;
}

function copyUniforms(uniforms: CaptureUniforms): CaptureUniforms {
  return {
    ...uniforms,
    res: [...uniforms.res], mouse: [...uniforms.mouse], date: [...uniforms.date],
    cameraPos: [...uniforms.cameraPos], cameraDir: [...uniforms.cameraDir],
    ...(uniforms.channelTime ? { channelTime: [...uniforms.channelTime] } : {}),
    ...(uniforms.channelLoaded ? { channelLoaded: [...uniforms.channelLoaded] } : {}),
    ...(uniforms.channelResolution ? { channelResolution: [...uniforms.channelResolution] } : {}),
  };
}

/** Immutable frame inputs retained for a later debug capture without advancing the renderer. */
export class RenderedCaptureState {
  private readonly frames = new Map<string, RenderedCaptureFrame>();

  record(
    passName: string,
    uniforms: CaptureUniforms,
    meshData?: Float32Array,
    channelResources?: RenderedCaptureChannel[],
    bufferInputs?: Map<number, RenderedCaptureBufferInput>,
  ): void {
    this.frames.set(passName, {
      uniforms: copyUniforms(uniforms),
      ...(meshData ? { meshData: new Float32Array(meshData) } : {}),
      ...(channelResources ? { channelResources: channelResources.map(resource => ({ ...resource })) } : {}),
      ...(bufferInputs ? { bufferInputs: new Map(bufferInputs) } : {}),
    });
  }

  get(passName: string): RenderedCaptureFrame | undefined {
    return this.frames.get(passName);
  }

  clear(): void {
    this.frames.clear();
  }
}
