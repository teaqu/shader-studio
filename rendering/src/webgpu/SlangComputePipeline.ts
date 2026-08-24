/// <reference types="@webgpu/types" />
import type { StorageBindingNode } from "../types/PassGraph";
import {
  type SlangChannelResource,
} from "./SlangPassPipeline";
import { DISPATCH_UNIFORM_SIZE, SHADERTOY_UNIFORM_SIZE } from "./SlangPrelude";

export interface SlangComputePipelineDescriptor {
  name: string;
  width: number;
  height: number;
  hasOutput: boolean;
  outputLayers: number;
  workgroupSize: [number, number, number];
  entryPoint: string;
  dispatchCount: number;
  channels: Array<{ slot: number; key: string; kind?: string }>;
  storage: StorageBindingNode[];
  uniformBufferSize?: number;
  /** Output texture format for compute texture writes. Prefer rgba32float
   *  when float32-filterable is available; rgba16float is the fallback. */
  bufferTextureFormat?: GPUTextureFormat;
}

async function shaderModuleErrors(shaderModule: GPUShaderModule, passName: string): Promise<string[]> {
  const info = await shaderModule.getCompilationInfo?.();
  return (info?.messages ?? [])
    .filter((message) => message.type === "error")
    .map((message) => `${passName}: WGSL L${message.lineNum}:${message.linePos} ${message.message}`);
}

export class SlangComputePipeline {
  private pipeline: GPUComputePipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private dispatchUniformBuffers: GPUBuffer[] = [];
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private bindGroups: GPUBindGroup[] = [];
  private bindGroupResourceIdentities: unknown[] | null = null;
  private sampler: GPUSampler | null = null;
  private textures: GPUTexture[] = [];
  private fullOutputViews: GPUTextureView[] = [];
  private layerOutputViews: GPUTextureView[][] = [];
  private textureIndex = 0;
  private rebuildGeneration = 0;
  private pendingTextureRetirements = new Set<GPUTexture>();

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
        entryPoint: this.descriptor.entryPoint,
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
        const diagnostics = await shaderModuleErrors(shaderModule, this.descriptor.name);
        if (diagnostics.length > 0) {
          return diagnostics;
        }
        return [`${this.descriptor.name}: ${error instanceof Error ? error.message : String(error)}`];
      }
    } else {
      pipeline = this.device.createComputePipeline(pipelineDescriptor);
    }
    if (generation !== this.rebuildGeneration) {
      return [];
    }

    this.bindGroupLayout = bindGroupLayout;
    this.pipeline = pipeline;
    this.uniformBuffer = this.device.createBuffer({
      size: this.descriptor.uniformBufferSize ?? SHADERTOY_UNIFORM_SIZE,
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
      const textures: GPUTexture[] = [];
      try {
        textures.push(this.createOutputTexture());
        textures.push(this.createOutputTexture());
        const views = this.createOutputViews(textures);
        this.textures = textures;
        this.fullOutputViews = views.full;
        this.layerOutputViews = views.layers;
      } catch (error) {
        SlangComputePipeline.destroyTextureList(textures);
        throw error;
      }
    }

    const diagnostics = await shaderModuleErrors(shaderModule, this.descriptor.name);
    if (generation !== this.rebuildGeneration) {
      return [];
    }
    return diagnostics;
  }

  resize(width: number, height: number): void {
    if (this.descriptor.width === width && this.descriptor.height === height) {
      return;
    }
    const nextDescriptor = { ...this.descriptor, width, height };
    if (this.descriptor.hasOutput && this.textures.length > 0) {
      const nextTextures: GPUTexture[] = [];
      let nextViews: ReturnType<SlangComputePipeline["createOutputViews"]>;
      try {
        nextTextures.push(this.createOutputTexture(width, height));
        nextTextures.push(this.createOutputTexture(width, height));
        nextViews = this.createOutputViews(nextTextures);
      } catch (error) {
        SlangComputePipeline.destroyTextureList(nextTextures);
        throw error;
      }
      const previousTextures = this.textures;
      this.descriptor = nextDescriptor;
      this.invalidateBindGroups();
      this.textures = nextTextures;
      this.fullOutputViews = nextViews.full;
      this.layerOutputViews = nextViews.layers;
      this.textureIndex = 0;
      this.retireTexturesAfterSubmittedWork(previousTextures);
      return;
    }
    this.descriptor = nextDescriptor;
    this.invalidateBindGroups();
  }

  rebuildBindGroups(
    channels: SlangChannelResource[],
    storageBuffers: Map<string, GPUBuffer>,
  ): void {
    if (
      !this.pipeline ||
      !this.uniformBuffer ||
      !this.bindGroupLayout ||
      this.dispatchUniformBuffers.length !== this.descriptor.dispatchCount
    ) {
      this.invalidateBindGroups();
      return;
    }

    const sortedChannels = [...channels].sort((a, b) => a.slot - b.slot);
    const expectedChannels = [...this.descriptor.channels].sort((a, b) => a.slot - b.slot);
    if (
      sortedChannels.length !== expectedChannels.length ||
      sortedChannels.some((channel, index) => channel.slot !== expectedChannels[index].slot) ||
      (sortedChannels.length > 0 && !this.sampler)
    ) {
      this.invalidateBindGroups();
      return;
    }
    if (this.descriptor.storage.some((node) => !storageBuffers.has(node.name))) {
      this.invalidateBindGroups();
      return;
    }

    const outputView = this.descriptor.hasOutput ? this.getCurrentOutputView() : null;
    if (this.descriptor.hasOutput && !outputView) {
      this.invalidateBindGroups();
      return;
    }

    const resourceIdentities: unknown[] = [
      this.pipeline,
      this.uniformBuffer,
      this.bindGroupLayout,
      ...this.dispatchUniformBuffers,
    ];
    for (const channel of sortedChannels) {
      resourceIdentities.push(
        channel.slot,
        channel.textureView,
        channel.sampler ?? this.sampler,
      );
    }
    for (const node of this.descriptor.storage) {
      resourceIdentities.push(node.name, storageBuffers.get(node.name));
    }
    resourceIdentities.push(outputView);
    if (
      this.bindGroups.length === this.descriptor.dispatchCount &&
      this.sameResourceIdentities(resourceIdentities)
    ) {
      return;
    }
    this.invalidateBindGroups();

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
    this.bindGroupResourceIdentities = resourceIdentities;
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

  getOutputSize(): { width: number; height: number } {
    return { width: this.descriptor.width, height: this.descriptor.height };
  }

  getCurrentOutputView(): GPUTextureView | null {
    return this.fullOutputViews[this.textureIndex] ?? null;
  }

  getLayerOutputView(layer: number): GPUTextureView | null {
    if (!Number.isInteger(layer) || layer < 0 || layer >= this.descriptor.outputLayers) {
      return null;
    }
    return this.layerOutputViews[this.textureIndex]?.[layer] ?? null;
  }

  getPreviousLayerOutputView(layer: number): GPUTextureView | null {
    if (this.textures.length === 0) {
      return null;
    }
    return this.layerOutputViews[1 - this.textureIndex]?.[layer] ?? null;
  }

  swap(): void {
    if (this.textures.length > 0) {
      this.textureIndex = 1 - this.textureIndex;
      this.invalidateBindGroups();
    }
  }

  /** Replace both ping-pong targets, clearing all accumulated compute output state. */
  resetOutputTextures(): void {
    if (!this.descriptor.hasOutput || this.textures.length === 0) {
      return;
    }
    const nextTextures: GPUTexture[] = [];
    let nextViews: { full: GPUTextureView[]; layers: GPUTextureView[][] };
    try {
      nextTextures.push(this.createOutputTexture(), this.createOutputTexture());
      nextViews = this.createOutputViews(nextTextures);
    } catch (error) {
      SlangComputePipeline.destroyTextureList(nextTextures);
      throw error;
    }
    const previousTextures = this.textures;
    this.textures = nextTextures;
    this.fullOutputViews = nextViews.full;
    this.layerOutputViews = nextViews.layers;
    this.textureIndex = 0;
    this.invalidateBindGroups();
    this.retireTexturesAfterSubmittedWork(previousTextures);
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
          format: this.descriptor.bufferTextureFormat || "rgba16float",
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
      label: `${this.descriptor.name} compute output`,
      size: {
        width,
        height,
        depthOrArrayLayers: this.descriptor.outputLayers,
      },
      format: this.descriptor.bufferTextureFormat || "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createOutputViews(textures: GPUTexture[]): {
    full: GPUTextureView[];
    layers: GPUTextureView[][];
  } {
    const full = textures.map((texture) => this.descriptor.outputLayers > 1
      ? texture.createView({
        dimension: "2d-array",
        baseArrayLayer: 0,
        arrayLayerCount: this.descriptor.outputLayers,
      })
      : texture.createView({ dimension: "2d" }));
    const layers = textures.map((texture) => Array.from(
      { length: this.descriptor.outputLayers },
      (_, layer) => texture.createView({
        dimension: "2d",
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      }),
    ));
    return { full, layers };
  }

  private resetResources(): void {
    this.destroyUniformBuffer();
    this.destroyDispatchUniformBuffers();
    this.destroyTextures();
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.invalidateBindGroups();
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
    // Rebuild, feedback reset and dispose all replace the live ping-pong
    // targets. A frame encoded before this call may still be in flight, so the
    // textures only die once the queue reports its submitted work complete.
    this.retireTexturesAfterSubmittedWork(this.textures);
    this.textures = [];
    this.fullOutputViews = [];
    this.layerOutputViews = [];
    this.textureIndex = 0;
  }

  private retireTexturesAfterSubmittedWork(textures: GPUTexture[]): void {
    const pending = textures.filter((texture) => !this.pendingTextureRetirements.has(texture));
    if (pending.length === 0) {
      return;
    }
    for (const texture of pending) {
      this.pendingTextureRetirements.add(texture);
    }
    const onSubmittedWorkDone = this.device.queue.onSubmittedWorkDone;
    if (!onSubmittedWorkDone) {
      this.destroyRetiredTextures(pending);
      return;
    }
    let completion: Promise<void>;
    try {
      completion = onSubmittedWorkDone.call(this.device.queue);
    } catch {
      this.destroyRetiredTextures(pending);
      return;
    }
    void completion.then(
      () => this.destroyRetiredTextures(pending),
      () => this.destroyRetiredTextures(pending),
    );
  }

  private destroyRetiredTextures(textures: GPUTexture[]): void {
    for (const texture of textures) {
      if (this.pendingTextureRetirements.delete(texture)) {
        texture.destroy?.();
      }
    }
  }

  private invalidateBindGroups(): void {
    this.bindGroups = [];
    this.bindGroupResourceIdentities = null;
  }

  private sameResourceIdentities(next: unknown[]): boolean {
    return this.bindGroupResourceIdentities?.length === next.length &&
      next.every((resource, index) => resource === this.bindGroupResourceIdentities?.[index]);
  }

  private static destroyTextureList(textures: GPUTexture[]): void {
    for (const texture of textures) {
      texture.destroy?.();
    }
  }
}
