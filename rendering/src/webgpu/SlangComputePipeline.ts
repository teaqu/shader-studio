/// <reference types="@webgpu/types" />
import type { StorageBindingNode } from "../types/PassGraph";
import {
  BUFFER_TEXTURE_FORMAT,
  type SlangChannelResource,
} from "./SlangPassPipeline";
import {
  DISPATCH_UNIFORM_SIZE,
  SHADERTOY_UNIFORM_SIZE,
  SLANG_ENTRY_COMPUTE,
} from "./SlangPrelude";

export interface SlangComputePipelineDescriptor {
  name: string;
  width: number;
  height: number;
  hasOutput: boolean;
  outputLayers: number;
  workgroupSize: [number, number, number];
  dispatchCount: number;
  channels: Array<{ slot: number; key: string; kind?: string }>;
  storage: StorageBindingNode[];
}

export class SlangComputePipeline {
  private shaderModule: GPUShaderModule | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private dispatchUniformBuffers: GPUBuffer[] = [];
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroups: GPUBindGroup[] = [];
  private sampler: GPUSampler | null = null;
  private textures: GPUTexture[] = [];
  private textureIndex = 0;
  private rebuildGeneration = 0;

  constructor(
    private readonly device: GPUDevice,
    private descriptor: SlangComputePipelineDescriptor,
  ) {}

  async rebuild(wgsl: string): Promise<string[]> {
    const generation = ++this.rebuildGeneration;
    this.resetResources();
    const shaderModule = this.device.createShaderModule({ code: wgsl });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: this.buildBindGroupLayoutEntries(),
    });
    const pipelineDescriptor: GPUComputePipelineDescriptor = {
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      compute: {
        module: shaderModule,
        entryPoint: SLANG_ENTRY_COMPUTE,
      },
    };

    let pipeline: GPUComputePipeline;
    if (this.device.createComputePipelineAsync) {
      try {
        pipeline = await this.device.createComputePipelineAsync(pipelineDescriptor);
      } catch (error) {
        if (generation !== this.rebuildGeneration) {
          return [];
        }
        return [`${this.descriptor.name}: ${error instanceof Error ? error.message : String(error)}`];
      }
    } else {
      pipeline = this.device.createComputePipeline(pipelineDescriptor);
    }
    if (generation !== this.rebuildGeneration) {
      return [];
    }

    this.shaderModule = shaderModule;
    this.bindGroupLayout = bindGroupLayout;
    this.pipeline = pipeline;
    this.uniformBuffer = this.device.createBuffer({
      size: SHADERTOY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    for (let index = 0; index < this.descriptor.dispatchCount; index++) {
      const buffer = this.device.createBuffer({
        size: DISPATCH_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buffer, 0, new Int32Array([index, 0, 0, 0]));
      this.dispatchUniformBuffers.push(buffer);
    }
    this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    if (this.descriptor.hasOutput) {
      this.textures = [this.createOutputTexture(), this.createOutputTexture()];
    }

    const info = await shaderModule.getCompilationInfo?.();
    if (generation !== this.rebuildGeneration) {
      return [];
    }
    return (info?.messages ?? [])
      .filter((message) => message.type === "error")
      .map((message) => `${this.descriptor.name}: WGSL L${message.lineNum}:${message.linePos} ${message.message}`);
  }

  resize(width: number, height: number): void {
    if (this.descriptor.width === width && this.descriptor.height === height) {
      return;
    }
    const nextDescriptor = { ...this.descriptor, width, height };
    if (this.descriptor.hasOutput && this.textures.length > 0) {
      const nextTextures: GPUTexture[] = [];
      try {
        nextTextures.push(this.createOutputTexture(width, height));
        nextTextures.push(this.createOutputTexture(width, height));
      } catch (error) {
        SlangComputePipeline.destroyTextureList(nextTextures);
        throw error;
      }
      const previousTextures = this.textures;
      this.descriptor = nextDescriptor;
      this.bindGroups = [];
      this.textures = nextTextures;
      this.textureIndex = 0;
      SlangComputePipeline.destroyTextureList(previousTextures);
      return;
    }
    this.descriptor = nextDescriptor;
    this.bindGroups = [];
  }

  rebuildBindGroups(
    channels: SlangChannelResource[],
    storageBuffers: Map<string, GPUBuffer>,
  ): void {
    this.bindGroups = [];
    if (
      !this.pipeline ||
      !this.uniformBuffer ||
      !this.bindGroupLayout ||
      this.dispatchUniformBuffers.length !== this.descriptor.dispatchCount
    ) {
      return;
    }

    const sortedChannels = [...channels].sort((a, b) => a.slot - b.slot);
    const expectedChannels = [...this.descriptor.channels].sort((a, b) => a.slot - b.slot);
    if (
      sortedChannels.length !== expectedChannels.length ||
      sortedChannels.some((channel, index) => channel.slot !== expectedChannels[index].slot) ||
      (sortedChannels.length > 0 && !this.sampler)
    ) {
      return;
    }
    if (this.descriptor.storage.some((node) => !storageBuffers.has(node.name))) {
      return;
    }

    const outputView = this.descriptor.hasOutput ? this.getCurrentOutputView() : null;
    if (this.descriptor.hasOutput && !outputView) {
      return;
    }

    const commonEntries: GPUBindGroupEntry[] = [{
      binding: 0,
      resource: { buffer: this.uniformBuffer },
    }];
    for (let index = 0; index < sortedChannels.length; index++) {
      const textureBinding = 1 + index * 2;
      commonEntries.push({
        binding: textureBinding,
        resource: sortedChannels[index].textureView,
      });
      commonEntries.push({
        binding: textureBinding + 1,
        resource: sortedChannels[index].sampler ?? this.sampler!,
      });
    }

    const storageBase = 1 + sortedChannels.length * 2;
    for (const node of this.descriptor.storage) {
      commonEntries.push({
        binding: storageBase + node.binding,
        resource: { buffer: storageBuffers.get(node.name)! },
      });
    }

    const outputBinding = storageBase + this.descriptor.storage.length;
    if (outputView) {
      commonEntries.push({ binding: outputBinding, resource: outputView });
    }
    const dispatchBinding = outputBinding + (this.descriptor.hasOutput ? 1 : 0);
    this.bindGroups = this.dispatchUniformBuffers.map((buffer) => this.device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        ...commonEntries,
        { binding: dispatchBinding, resource: { buffer } },
      ],
    }));
  }

  getPipeline(): GPUComputePipeline | null {
    return this.pipeline;
  }

  getBindGroup(subDispatch: number): GPUBindGroup | null {
    return this.bindGroups[subDispatch] ?? null;
  }

  getUniformBuffer(): GPUBuffer | null {
    return this.uniformBuffer;
  }

  getCurrentOutputView(): GPUTextureView | null {
    return this.createFullOutputView(this.textureIndex);
  }

  getLayerOutputView(layer: number): GPUTextureView | null {
    return this.createLayerOutputView(this.textureIndex, layer);
  }

  getPreviousLayerOutputView(layer: number): GPUTextureView | null {
    if (this.textures.length === 0) {
      return null;
    }
    return this.createLayerOutputView(1 - this.textureIndex, layer);
  }

  swap(): void {
    if (this.textures.length > 0) {
      this.textureIndex = 1 - this.textureIndex;
      this.bindGroups = [];
    }
  }

  dispose(): void {
    this.rebuildGeneration++;
    this.resetResources();
  }

  private buildBindGroupLayoutEntries(): GPUBindGroupLayoutEntry[] {
    const entries: GPUBindGroupLayoutEntry[] = [{
      binding: 0,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "uniform" },
    }];
    const sortedChannels = [...this.descriptor.channels].sort((a, b) => a.slot - b.slot);
    for (let index = 0; index < sortedChannels.length; index++) {
      const texture: GPUTextureBindingLayout = {
        sampleType: "float",
        viewDimension: "2d",
      };
      if (sortedChannels[index].kind === "cubemap") {
        texture.viewDimension = "cube";
      }
      entries.push({
        binding: 1 + index * 2,
        visibility: GPUShaderStage.COMPUTE,
        texture,
      });
      entries.push({
        binding: 2 + index * 2,
        visibility: GPUShaderStage.COMPUTE,
        sampler: { type: "filtering" },
      });
    }

    const storageBase = 1 + sortedChannels.length * 2;
    for (const node of this.descriptor.storage) {
      entries.push({
        binding: storageBase + node.binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      });
    }

    const outputBinding = storageBase + this.descriptor.storage.length;
    if (this.descriptor.hasOutput) {
      entries.push({
        binding: outputBinding,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: "write-only",
          format: BUFFER_TEXTURE_FORMAT,
          viewDimension: this.descriptor.outputLayers > 1 ? "2d-array" : "2d",
        },
      });
    }
    entries.push({
      binding: outputBinding + (this.descriptor.hasOutput ? 1 : 0),
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "uniform" },
    });
    return entries;
  }

  private createOutputTexture(
    width = this.descriptor.width,
    height = this.descriptor.height,
  ): GPUTexture {
    return this.device.createTexture({
      size: {
        width,
        height,
        depthOrArrayLayers: this.descriptor.outputLayers,
      },
      format: BUFFER_TEXTURE_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createFullOutputView(textureIndex: number): GPUTextureView | null {
    const texture = this.textures[textureIndex];
    if (!texture) {
      return null;
    }
    if (this.descriptor.outputLayers > 1) {
      return texture.createView({
        dimension: "2d-array",
        baseArrayLayer: 0,
        arrayLayerCount: this.descriptor.outputLayers,
      });
    }
    return texture.createView({ dimension: "2d" });
  }

  private createLayerOutputView(textureIndex: number, layer: number): GPUTextureView | null {
    if (
      !Number.isInteger(layer) ||
      layer < 0 ||
      layer >= this.descriptor.outputLayers
    ) {
      return null;
    }
    return this.textures[textureIndex]?.createView({
      dimension: "2d",
      baseArrayLayer: layer,
      arrayLayerCount: 1,
    }) ?? null;
  }

  private resetResources(): void {
    this.destroyUniformBuffer();
    this.destroyDispatchUniformBuffers();
    this.destroyTextures();
    this.shaderModule = null;
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.bindGroups = [];
    this.sampler = null;
  }

  private destroyUniformBuffer(): void {
    this.uniformBuffer?.destroy?.();
    this.uniformBuffer = null;
  }

  private destroyDispatchUniformBuffers(): void {
    for (const buffer of this.dispatchUniformBuffers) {
      buffer.destroy?.();
    }
    this.dispatchUniformBuffers = [];
  }

  private destroyTextures(): void {
    SlangComputePipeline.destroyTextureList(this.textures);
    this.textures = [];
    this.textureIndex = 0;
  }

  private static destroyTextureList(textures: GPUTexture[]): void {
    for (const texture of textures) {
      texture.destroy?.();
    }
  }
}
