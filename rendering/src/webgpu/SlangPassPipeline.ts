/// <reference types="@webgpu/types" />
import type { StorageBindingNode } from "../types/PassGraph";
import { SHADERTOY_UNIFORM_SIZE, SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from "./SlangPrelude";

export interface SlangPassPipelineDescriptor {
  name: string;
  width: number;
  height: number;
  output: "texture" | "canvas";
  channels: Array<{ slot: number; key: string; kind?: string }>;
  storage?: StorageBindingNode[];
  uniformBufferSize?: number;
}

export interface SlangChannelResource {
  slot: number;
  textureView: GPUTextureView;
  /** Channel-specific sampler (texture/keyboard inputs); shared linear when absent (buffer inputs). */
  sampler?: GPUSampler;
  /** Current source texture dimensions, used by dynamic cover-channel compute dispatch. */
  width?: number;
  height?: number;
}

// Buffer (texture-output) passes render to float textures so feedback state
// is not clamped to [0,1] or quantized to 8 bits by the canvas format. The
// engine prefers rgba32float for WebGL parity when float32 filtering is
// available; rgba16float remains the portable fallback.
export const BUFFER_TEXTURE_FORMAT: GPUTextureFormat = "rgba16float";
export const HIGH_PRECISION_BUFFER_TEXTURE_FORMAT: GPUTextureFormat = "rgba32float";

async function shaderModuleErrors(shaderModule: GPUShaderModule, passName: string): Promise<string[]> {
  const info = await shaderModule.getCompilationInfo?.();
  return (info?.messages ?? [])
    .filter((message) => message.type === "error")
    .map((message) => `${passName}: WGSL L${message.lineNum}:${message.linePos} ${message.message}`);
}

export class SlangPassPipeline {
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupResourceIdentities: unknown[] | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;
  private textures: GPUTexture[] = [];
  private outputViews: GPUTextureView[] = [];
  private textureIndex = 0;
  private rebuildGeneration = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private descriptor: SlangPassPipelineDescriptor,
    private readonly bufferTextureFormat: GPUTextureFormat = BUFFER_TEXTURE_FORMAT,
  ) {}

  async rebuild(wgsl: string): Promise<string[]> {
    const generation = ++this.rebuildGeneration;
    this.resetResources();
    const shaderModule = this.device.createShaderModule({ code: wgsl });
    // An explicit layout (instead of layout:"auto") covers every DECLARED
    // channel binding. With "auto", a shader that declares a channel but
    // never statically uses it gets a layout without those bindings, and the
    // bind group we build (which always supplies them) fails validation,
    // silently dropping every draw.
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: this.buildBindGroupLayoutEntries(),
    });
    const pipelineDescriptor: GPURenderPipelineDescriptor = {
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: SLANG_ENTRY_VERTEX },
      fragment: {
        module: shaderModule,
        entryPoint: SLANG_ENTRY_FRAGMENT,
        targets: [{ format: this.targetFormat() }],
      },
      primitive: { topology: "triangle-list" },
    };
    let pipeline: GPURenderPipeline;
    if (this.device.createRenderPipelineAsync) {
      // WebGPU's off-thread pipeline compile (the KHR_parallel_shader_compile
      // analogue). A rejection is a validation failure — report it as a
      // compile error rather than letting it reject the whole compile.
      try {
        pipeline = await this.device.createRenderPipelineAsync(pipelineDescriptor);
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
      pipeline = this.device.createRenderPipeline(pipelineDescriptor);
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
    this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    if (this.descriptor.output === "texture") {
      const textures: GPUTexture[] = [];
      try {
        textures.push(this.createOutputTexture());
        textures.push(this.createOutputTexture());
        this.outputViews = textures.map((texture) => texture.createView());
        this.textures = textures;
      } catch (error) {
        SlangPassPipeline.destroyTextureList(textures);
        throw error;
      }
    }
    if (this.descriptor.channels.length === 0 && (this.descriptor.storage?.length ?? 0) === 0) {
      // Passes with channels or storage cannot build a valid bind group yet
      // (the explicit layout requires those resources); rebuildBindGroup
      // creates it each frame once live resources are resolved.
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
    }

    const diagnostics = await shaderModuleErrors(shaderModule, this.descriptor.name);
    if (generation !== this.rebuildGeneration) {
      return [];
    }
    return diagnostics;
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
    if (this.descriptor.output === "texture" && this.textures.length > 0) {
      const oldTextures = this.textures;
      const oldTextureIndex = this.textureIndex;
      const newTextures: GPUTexture[] = [];
      let newViews: GPUTextureView[];
      try {
        newTextures.push(this.createOutputTexture(width, height));
        newTextures.push(this.createOutputTexture(width, height));
        newViews = newTextures.map((texture) => texture.createView());
      } catch (error) {
        SlangPassPipeline.destroyTextureList(newTextures);
        throw error;
      }
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
      try {
        for (let index = 0; index < oldTextures.length; index++) {
          encoder.copyTextureToTexture(
            { texture: oldTextures[index], origin: sourceOrigin },
            { texture: newTextures[index], origin: destinationOrigin },
            copySize,
          );
        }
      } catch (error) {
        SlangPassPipeline.destroyTextureList(newTextures);
        throw error;
      }
      this.descriptor = { ...this.descriptor, width, height };
      this.textures = newTextures;
      this.outputViews = newViews;
      this.textureIndex = oldTextureIndex;
      return () => {
        for (const texture of oldTextures) {
          texture.destroy?.();
        }
      };
    }
    this.descriptor = { ...this.descriptor, width, height };
    return null;
  }

  rebuildBindGroup(
    resources: SlangChannelResource[],
    storageBuffers?: Map<string, GPUBuffer>,
  ): void {
    if (!this.pipeline || !this.uniformBuffer || !this.bindGroupLayout) {
      return;
    }
    const resolvedStorage = (this.descriptor.storage ?? []).map((node) => ({
      node,
      buffer: storageBuffers?.get(node.name),
    }));
    if (resolvedStorage.some(({ buffer }) => !buffer)) {
      this.invalidateBindGroup();
      return;
    }
    const sorted = [...resources].sort((a, b) => a.slot - b.slot);
    const resourceIdentities: unknown[] = [
      this.pipeline,
      this.uniformBuffer,
      this.bindGroupLayout,
    ];
    for (const channel of sorted) {
      resourceIdentities.push(
        channel.slot,
        channel.textureView,
        channel.sampler ?? this.sampler,
      );
    }
    for (const { node, buffer } of resolvedStorage) {
      resourceIdentities.push(node.name, buffer);
    }
    if (this.bindGroup && this.sameResourceIdentities(resourceIdentities)) {
      return;
    }
    this.invalidateBindGroup();

    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }];
    for (let index = 0; index < sorted.length; index++) {
      const textureBinding = 1 + index * 2;
      const samplerBinding = textureBinding + 1;
      entries.push({ binding: textureBinding, resource: sorted[index].textureView });
      entries.push({ binding: samplerBinding, resource: sorted[index].sampler ?? this.sampler! });
    }
    const storageBaseBinding = 1 + this.descriptor.channels.length * 2;
    for (const { node, buffer } of resolvedStorage) {
      entries.push({
        binding: storageBaseBinding + node.binding,
        resource: { buffer: buffer! },
      });
    }
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries,
    });
    this.bindGroupResourceIdentities = resourceIdentities;
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

  getOutputSize(): { width: number; height: number } {
    return { width: this.descriptor.width, height: this.descriptor.height };
  }

  getCurrentOutputView(): GPUTextureView | null {
    return this.outputViews[this.textureIndex] ?? null;
  }

  getPreviousOutputView(): GPUTextureView | null {
    if (this.textures.length === 0) {
      return null;
    }
    return this.outputViews[1 - this.textureIndex] ?? null;
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
    this.outputViews = this.textures.map((texture) => texture.createView());
    this.textureIndex = 0;
  }

  dispose(): void {
    this.rebuildGeneration++;
    this.resetResources();
  }

  /**
   * Bind group layout entries matching the prelude's binding contract:
   * binding 0 = uniforms; then, over the slot-sorted channel array, texture
   * at 1+index*2 and sampler at 2+index*2; storage follows channel
   * pairs at 1+channelCount*2+node.binding.
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
    const storageBaseBinding = 1 + sorted.length * 2;
    for (const node of this.descriptor.storage ?? []) {
      entries.push({
        binding: storageBaseBinding + node.binding,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      });
    }
    return entries;
  }

  /** Render target format: float for buffer feedback, canvas format otherwise. */
  private targetFormat(): GPUTextureFormat {
    return this.descriptor.output === "texture" ? this.bufferTextureFormat : this.format;
  }

  private createOutputTexture(
    width = this.descriptor.width,
    height = this.descriptor.height,
  ): GPUTexture {
    return this.device.createTexture({
      size: { width, height },
      format: this.targetFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
  }

  private resetResources(): void {
    this.destroyTextures();
    this.destroyUniformBuffer();
    this.pipeline = null;
    this.invalidateBindGroup();
    this.bindGroupLayout = null;
    this.sampler = null;
  }

  private destroyUniformBuffer(): void {
    this.uniformBuffer?.destroy?.();
    this.uniformBuffer = null;
  }

  private invalidateBindGroup(): void {
    this.bindGroup = null;
    this.bindGroupResourceIdentities = null;
  }

  private sameResourceIdentities(next: unknown[]): boolean {
    return this.bindGroupResourceIdentities?.length === next.length &&
      next.every((resource, index) => resource === this.bindGroupResourceIdentities?.[index]);
  }

  private destroyTextures(): void {
    SlangPassPipeline.destroyTextureList(this.textures);
    this.textures = [];
    this.outputViews = [];
    this.textureIndex = 0;
  }

  private static destroyTextureList(textures: GPUTexture[]): void {
    for (const texture of textures) {
      texture.destroy?.();
    }
  }
}
