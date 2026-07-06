/// <reference types="@webgpu/types" />
import { SHADERTOY_UNIFORM_SIZE, SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from "./SlangPrelude";

export interface SlangPassPipelineDescriptor {
  name: string;
  width: number;
  height: number;
  output: "texture" | "canvas";
  channels: Array<{ slot: number; key: string }>;
}

export interface SlangChannelResource {
  slot: number;
  textureView: GPUTextureView;
}

export class SlangPassPipeline {
  private shaderModule: GPUShaderModule | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler | null = null;
  private textures: GPUTexture[] = [];
  private textureIndex = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private descriptor: SlangPassPipelineDescriptor,
  ) {}

  async rebuild(wgsl: string): Promise<string[]> {
    this.destroyTextures();
    this.destroyUniformBuffer();
    this.shaderModule = this.device.createShaderModule({ code: wgsl });
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: this.shaderModule, entryPoint: SLANG_ENTRY_VERTEX },
      fragment: { module: this.shaderModule, entryPoint: SLANG_ENTRY_FRAGMENT, targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
    this.uniformBuffer = this.device.createBuffer({
      size: SHADERTOY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    if (this.descriptor.output === "texture") {
      this.textures = [this.createOutputTexture(), this.createOutputTexture()];
    }
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

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
   * Texture passes get fresh ping-pong textures at the new size (feedback
   * state is necessarily reset); canvas passes only track the new size.
   */
  resize(width: number, height: number): void {
    if (this.descriptor.width === width && this.descriptor.height === height) {
      return;
    }
    this.descriptor = { ...this.descriptor, width, height };
    if (this.descriptor.output === "texture" && this.textures.length > 0) {
      this.destroyTextures();
      this.textures = [this.createOutputTexture(), this.createOutputTexture()];
    }
  }

  rebuildBindGroup(resources: SlangChannelResource[]): void {
    if (!this.pipeline || !this.uniformBuffer) {
      return;
    }
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }];
    const sorted = [...resources].sort((a, b) => a.slot - b.slot);
    for (let index = 0; index < sorted.length; index++) {
      const textureBinding = 1 + index * 2;
      const samplerBinding = textureBinding + 1;
      entries.push({ binding: textureBinding, resource: sorted[index].textureView });
      entries.push({ binding: samplerBinding, resource: this.sampler! });
    }
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
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

  dispose(): void {
    this.destroyTextures();
    this.destroyUniformBuffer();
  }

  private createOutputTexture(): GPUTexture {
    return this.device.createTexture({
      size: { width: this.descriptor.width, height: this.descriptor.height },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
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
