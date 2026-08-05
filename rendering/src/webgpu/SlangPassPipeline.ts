/// <reference types="@webgpu/types" />
import { SHADERTOY_UNIFORM_SIZE, SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from "./SlangPrelude";

export interface SlangPassPipelineDescriptor {
  name: string;
  width: number;
  height: number;
  output: "texture" | "canvas";
  channels: Array<{ slot: number; key: string; kind?: string }>;
  uniformBufferSize?: number;
}

export interface SlangChannelResource {
  slot: number;
  textureView: GPUTextureView;
  /** Channel-specific sampler (texture/keyboard inputs); shared linear when absent (buffer inputs). */
  sampler?: GPUSampler;
}

// Buffer (texture-output) passes render to float textures so feedback state
// is not clamped to [0,1] or quantized to 8 bits by the canvas format. The
// engine prefers rgba32float for WebGL parity when float32 filtering is
// available; rgba16float remains the portable fallback.
export const BUFFER_TEXTURE_FORMAT: GPUTextureFormat = "rgba16float";
export const HIGH_PRECISION_BUFFER_TEXTURE_FORMAT: GPUTextureFormat = "rgba32float";

export class SlangPassPipeline {
  private shaderModule: GPUShaderModule | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;
  private textures: GPUTexture[] = [];
  private textureIndex = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private descriptor: SlangPassPipelineDescriptor,
    private readonly bufferTextureFormat: GPUTextureFormat = BUFFER_TEXTURE_FORMAT,
  ) {}

  async rebuild(wgsl: string): Promise<string[]> {
    this.destroyTextures();
    this.destroyUniformBuffer();
    this.shaderModule = this.device.createShaderModule({ code: wgsl });
    // An explicit layout (instead of layout:"auto") covers every DECLARED
    // channel binding. With "auto", a shader that declares a channel but
    // never statically uses it gets a layout without those bindings, and the
    // bind group we build (which always supplies them) fails validation,
    // silently dropping every draw.
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: this.buildBindGroupLayoutEntries(),
    });
    const pipelineDescriptor: GPURenderPipelineDescriptor = {
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module: this.shaderModule, entryPoint: SLANG_ENTRY_VERTEX },
      fragment: {
        module: this.shaderModule,
        entryPoint: SLANG_ENTRY_FRAGMENT,
        targets: [{ format: this.targetFormat() }],
      },
      primitive: { topology: "triangle-list" },
    };
    if (this.device.createRenderPipelineAsync) {
      // WebGPU's off-thread pipeline compile (the KHR_parallel_shader_compile
      // analogue). A rejection is a validation failure — report it as a
      // compile error rather than letting it reject the whole compile.
      try {
        this.pipeline = await this.device.createRenderPipelineAsync(pipelineDescriptor);
      } catch (error) {
        this.pipeline = null;
        return [`${this.descriptor.name}: ${error instanceof Error ? error.message : String(error)}`];
      }
    } else {
      this.pipeline = this.device.createRenderPipeline(pipelineDescriptor);
    }
    this.uniformBuffer = this.device.createBuffer({
      size: this.descriptor.uniformBufferSize ?? SHADERTOY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    if (this.descriptor.output === "texture") {
      this.textures = [this.createOutputTexture(), this.createOutputTexture()];
    }
    if (this.descriptor.channels.length === 0) {
      // Channel passes cannot build a valid bind group yet (the explicit
      // layout requires their texture/sampler entries); rebuildBindGroup
      // creates it each frame once channel views are resolved.
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
    }

    const info = await this.shaderModule.getCompilationInfo?.();
    return (info?.messages ?? [])
      .filter((message) => message.type === "error")
      .map((message) => `${this.descriptor.name}: WGSL L${message.lineNum}:${message.linePos} ${message.message}`);
  }

  updateDescriptor(descriptor: SlangPassPipelineDescriptor): void {
    this.descriptor = descriptor;
  }

  /**
   * Change the pass's output size without recompiling the shader module.
   * Texture passes copy both ping-pong states into the overlapping region of
   * the new targets so feedback survives a preview resize.
   */
  resize(width: number, height: number): void {
    if (this.descriptor.width === width && this.descriptor.height === height) {
      return;
    }
    if (this.descriptor.output !== "texture" || this.textures.length === 0) {
      this.descriptor = { ...this.descriptor, width, height };
      return;
    }
    const encoder = this.device.createCommandEncoder();
    const finishResize = this.encodeResize(width, height, encoder);
    if (finishResize) {
      this.device.queue.submit([encoder.finish()]);
      finishResize();
    }
  }

  /**
   * Record a texture resize into a caller-owned encoder. The returned callback
   * releases the old textures and must run only after the commands are
   * submitted, allowing an engine resize to batch several pass migrations.
   */
  encodeResize(width: number, height: number, encoder: GPUCommandEncoder): (() => void) | null {
    if (this.descriptor.width === width && this.descriptor.height === height) {
      return null;
    }
    const oldWidth = this.descriptor.width;
    const oldHeight = this.descriptor.height;
    this.descriptor = { ...this.descriptor, width, height };
    if (this.descriptor.output === "texture" && this.textures.length > 0) {
      const oldTextures = this.textures;
      const oldTextureIndex = this.textureIndex;
      const newTextures = [this.createOutputTexture(), this.createOutputTexture()];
      const copySize = {
        width: Math.min(oldWidth, width),
        height: Math.min(oldHeight, height),
        depthOrArrayLayers: 1,
      };
      // WebGPU copy origins are top-left, while ShaderToy feedback content is
      // authored in bottom-left coordinates. Offset the taller side so the
      // overlapping logical bottom-left region stays anchored across resize.
      const sourceOrigin = { x: 0, y: Math.max(0, oldHeight - height) };
      const destinationOrigin = { x: 0, y: Math.max(0, height - oldHeight) };
      for (let index = 0; index < oldTextures.length; index++) {
        encoder.copyTextureToTexture(
          { texture: oldTextures[index], origin: sourceOrigin },
          { texture: newTextures[index], origin: destinationOrigin },
          copySize,
        );
      }
      this.textures = newTextures;
      this.textureIndex = oldTextureIndex;
      return () => {
        for (const texture of oldTextures) {
          texture.destroy?.();
        }
      };
    }
    return null;
  }

  rebuildBindGroup(resources: SlangChannelResource[]): void {
    if (!this.pipeline || !this.uniformBuffer || !this.bindGroupLayout) {
      return;
    }
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }];
    const sorted = [...resources].sort((a, b) => a.slot - b.slot);
    for (let index = 0; index < sorted.length; index++) {
      const textureBinding = 1 + index * 2;
      const samplerBinding = textureBinding + 1;
      entries.push({ binding: textureBinding, resource: sorted[index].textureView });
      entries.push({ binding: samplerBinding, resource: sorted[index].sampler ?? this.sampler! });
    }
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries,
    });
  }

  getPipeline(): GPURenderPipeline | null {
    return this.pipeline;
  }

  getBindGroup(): GPUBindGroup | null {
    return this.bindGroup;
  }

  getUniformBuffer(): GPUBuffer | null {
    return this.uniformBuffer;
  }

  getCurrentOutputView(): GPUTextureView | null {
    return this.textures[this.textureIndex]?.createView() ?? null;
  }

  getPreviousOutputView(): GPUTextureView | null {
    if (this.textures.length === 0) {
      return null;
    }
    return this.textures[1 - this.textureIndex]?.createView() ?? null;
  }

  swap(): void {
    if (this.textures.length > 0) {
      this.textureIndex = 1 - this.textureIndex;
    }
  }

  /** Replace both ping-pong targets, clearing all accumulated feedback state. */
  resetOutputTextures(): void {
    if (this.descriptor.output !== "texture" || this.textures.length === 0) {
      return;
    }
    this.destroyTextures();
    this.textures = [this.createOutputTexture(), this.createOutputTexture()];
    this.textureIndex = 0;
  }

  dispose(): void {
    this.destroyTextures();
    this.destroyUniformBuffer();
  }

  /**
   * Bind group layout entries matching the prelude's binding contract:
   * binding 0 = uniforms; then, over the slot-sorted channel array, texture
   * at 1+index*2 and sampler at 2+index*2.
   */
  private buildBindGroupLayoutEntries(): GPUBindGroupLayoutEntry[] {
    const entries: GPUBindGroupLayoutEntry[] = [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    }];
    const sorted = [...this.descriptor.channels].sort((a, b) => a.slot - b.slot);
    for (let index = 0; index < sorted.length; index++) {
      const textureEntry: GPUTextureBindingLayout = { sampleType: "float" };
      if (sorted[index].kind === "cubemap") {
        textureEntry.viewDimension = "cube";
      }
      entries.push({
        binding: 1 + index * 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: textureEntry,
      });
      entries.push({
        binding: 2 + index * 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      });
    }
    return entries;
  }

  /** Render target format: float for buffer feedback, canvas format otherwise. */
  private targetFormat(): GPUTextureFormat {
    return this.descriptor.output === "texture" ? this.bufferTextureFormat : this.format;
  }

  private createOutputTexture(): GPUTexture {
    return this.device.createTexture({
      size: { width: this.descriptor.width, height: this.descriptor.height },
      format: this.targetFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
  }

  private destroyUniformBuffer(): void {
    this.uniformBuffer?.destroy?.();
    this.uniformBuffer = null;
  }

  private destroyTextures(): void {
    for (const texture of this.textures) {
      texture.destroy?.();
    }
    this.textures = [];
    this.textureIndex = 0;
  }
}
