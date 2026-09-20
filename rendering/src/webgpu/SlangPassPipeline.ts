/// <reference types="@webgpu/types" />
import type { SlangBindingChannel } from "./SlangBindingPlan";
import { buildSlangBindingPlan } from "./SlangBindingPlan";
import { slangChannelLayoutEntries, slangChannelResourceEntries } from "./SlangBindingResources";
import type { StorageBindingNode } from "../types/PassGraph";
import { allowNonUniformDerivatives, type WgslVertexRange, type WgslDirectiveRange } from "./wgslDiagnostics";
import type { GeometryType } from "@shader-studio/types";
import { createShaderToyUniformLayout, getShaderToyChannelCount, SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX } from "./SlangPrelude";

export interface SlangPassPipelineDescriptor {
  name: string;
  width: number;
  height: number;
  output: "texture" | "canvas";
  channels: SlangBindingChannel[];
  vertexChannels?: boolean;
  storage?: StorageBindingNode[];
  geometry: GeometryType;
  uniformBufferSize?: number;
  /** Generated prelude lines before user line 1; remaps diagnostics onto user lines. */
  sourceLineOffset?: number;
  /** User-source lines after the prelude; clamps generated-code errors. */
  sourceLineCount?: number;
  /** Assembled-module range of the user vertex hook, when the pass has one. */
  vertexRange?: WgslVertexAttribution["range"];
  commonRange?: WgslVertexRange;
  directiveRanges?: WgslDirectiveRange[];
  /** Vertex file name for diagnostics, when the caller knows it. */
  vertexLabel?: string;
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
export const MESH_UNIFORM_SIZE = 256;

/** An assembled-module line mapped onto user lines. */
export interface RemappedWgslDiagnosticLine {
  /** 1-based line to report. */
  line: number;
  /** True when the error sits in generated code (prelude or entry points). */
  internal: boolean;
  /** True when the error sits in the user's vertex hook. Never set with internal. */
  vertex?: boolean;
}

/** Vertex-hook placement in assembled-module lines, reported by the prelude builders. */
export interface WgslVertexAttribution {
  /** Assembled-module range of the user hook (1-based start, length in lines). */
  range: WgslVertexRange;
  /** Vertex file name for the message, when the caller knows it. */
  label?: string;
}

/** Maps assembled-module diagnostics onto user lines for this pass's language. */
export function remapWgslDiagnosticLine(
  lineNum: number,
  sourceLineOffset: number | undefined,
  userLineCount?: number,
  vertexRange?: WgslVertexAttribution["range"],
): RemappedWgslDiagnosticLine {
  if (sourceLineOffset === undefined) {
    return { line: lineNum, internal: false };
  }
  if (
    vertexRange !== undefined
    && lineNum >= vertexRange.startLine
    && lineNum < vertexRange.startLine + vertexRange.lineCount
  ) {
    // Inside the user's vertex hook: hook-relative line, never internal.
    return { line: lineNum - vertexRange.startLine + 1, internal: false, vertex: true };
  }
  if (lineNum <= sourceLineOffset) {
    // Inside the generated prelude — a shader-studio bug, never remapped.
    return { line: lineNum, internal: true };
  }
  if (userLineCount !== undefined && lineNum > sourceLineOffset + userLineCount) {
    // Past the end of user source (generated entry points): clamp to the
    // last user line and mark it.
    return { line: Math.max(1, sourceLineOffset + userLineCount), internal: true };
  }
  return { line: lineNum - sourceLineOffset, internal: false };
}

/** Formats one browser-compiler error, marking generated-code errors `internal:`. */
export function formatWgslDiagnostic(
  passName: string,
  lineNum: number,
  linePos: number,
  message: string,
  sourceLineOffset: number | undefined,
  userLineCount?: number,
  vertex?: WgslVertexAttribution,
  commonRange?: WgslVertexRange,
  directiveRanges?: WgslDirectiveRange[],
): string {
  const directive = directiveRanges?.find(range => lineNum >= range.startLine && lineNum < range.startLine + range.lineCount);
  if (directive) {
    const line = lineNum - directive.startLine + directive.sourceStartLine;
    return directive.owner === "vertex"
      ? `${passName} (vertex): L${line}:${linePos} ${message}`
      : `${directive.owner === "Common" ? "Common" : passName}: WGSL L${line}:${linePos} ${message}`;
  }
  if (commonRange && lineNum >= commonRange.startLine && lineNum < commonRange.startLine + commonRange.lineCount) {
    return `Common: WGSL L${lineNum - commonRange.startLine + 1}:${linePos} ${message}`;
  }
  const remapped = remapWgslDiagnosticLine(lineNum, sourceLineOffset, userLineCount, vertex?.range);
  if (remapped.vertex === true) {
    return `${passName} (vertex${vertex?.label !== undefined ? ` ${vertex.label}` : ""}): L${remapped.line}:${linePos} ${message}`;
  }
  return `${passName}: WGSL ${remapped.internal ? "internal: " : ""}L${remapped.line}:${linePos} ${message}`;
}

export class SlangPassPipeline {
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private meshUniformBuffer: GPUBuffer | null = null;
  private depthTexture: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private bindGroupResourceIdentities: unknown[] | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;
  private textures: GPUTexture[] = [];
  private outputViews: GPUTextureView[] = [];
  private textureIndex = 0;
  private rebuildGeneration = 0;
  private pendingTextureRetirements = new Set<GPUTexture>();

  constructor(
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private descriptor: SlangPassPipelineDescriptor,
    private readonly bufferTextureFormat: GPUTextureFormat = BUFFER_TEXTURE_FORMAT,
  ) {}

  async rebuild(wgsl: string): Promise<string[]> {
    const generation = ++this.rebuildGeneration;
    this.resetResources();
    const moduleSource = allowNonUniformDerivatives(wgsl);
    // The diagnostic filter adds a generated line only when no filter exists.
    const sourceLineOffset = this.descriptor.sourceLineOffset === undefined
      ? undefined
      : this.descriptor.sourceLineOffset + (moduleSource === wgsl ? 0 : 1);
    const shaderModule = this.device.createShaderModule({ code: moduleSource });
    // An explicit layout (instead of layout:"auto") covers every DECLARED
    // channel binding. With "auto", a shader that declares a channel but
    // never statically uses it gets a layout without those bindings, and the
    // bind group we build (which always supplies them) fails validation,
    // silently dropping every draw.
    this.device.pushErrorScope("validation");
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: this.buildBindGroupLayoutEntries(),
    });
    const layoutError = await this.device.popErrorScope();
    if (layoutError) {
      return [`${this.descriptor.name}: ${layoutError.message}`];
    }
    const pipelineDescriptor: GPURenderPipelineDescriptor = {
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: SLANG_ENTRY_VERTEX,
        ...(this.isMesh() ? { buffers: [{ arrayStride: 32, attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32x2" },
        ] }] } : {}),
      },
      fragment: {
        module: shaderModule,
        entryPoint: SLANG_ENTRY_FRAGMENT,
        targets: [{ format: this.targetFormat() }],
      },
      primitive: { topology: "triangle-list" },
      ...(this.isMesh() ? { depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" } } : {}),
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
        const diagnostics = await this.moduleErrors(shaderModule, sourceLineOffset);
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
      size: this.descriptor.uniformBufferSize ?? createShaderToyUniformLayout(getShaderToyChannelCount(this.descriptor.channels)).size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    if (this.isMesh()) {
      this.meshUniformBuffer = this.device.createBuffer({ size: MESH_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.depthTexture = this.device.createTexture({ size: { width: this.descriptor.width, height: this.descriptor.height }, format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
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
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniformBuffer } }];
      if (this.isMesh() && this.meshUniformBuffer) {
        entries.push({ binding: 1, resource: { buffer: this.meshUniformBuffer } });
      }
      this.bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries,
      });
    }

    const diagnostics = await this.moduleErrors(shaderModule, sourceLineOffset);
    if (generation !== this.rebuildGeneration) {
      return [];
    }
    return diagnostics;
  }

  /** Browser-compiler errors, remapped from assembled-module lines onto user lines. */
  private async moduleErrors(shaderModule: GPUShaderModule, sourceLineOffset?: number): Promise<string[]> {
    const info = await shaderModule.getCompilationInfo?.();
    const addedLines = (sourceLineOffset ?? 0) - (this.descriptor.sourceLineOffset ?? 0);
    const shift = (range: WgslVertexRange) => ({ ...range, startLine: range.startLine + addedLines });
    const vertex = this.descriptor.vertexRange === undefined
      ? undefined
      : { range: shift(this.descriptor.vertexRange), label: this.descriptor.vertexLabel };
    return (info?.messages ?? [])
      .filter((message) => message.type === "error")
      .map((message) => formatWgslDiagnostic(
        this.descriptor.name,
        message.lineNum,
        message.linePos,
        message.message,
        sourceLineOffset,
        this.descriptor.sourceLineCount,
        vertex,
        this.descriptor.commonRange && shift(this.descriptor.commonRange),
        this.descriptor.directiveRanges?.map(range => ({ ...range, startLine: range.startLine + addedLines })),
      ));
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
      this.resizeDepthTexture(width, height);
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
   * retires the old textures and must run only after the commands are
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
      this.resizeDepthTexture(width, height);
      return () => {
        this.retireTexturesAfterSubmittedWork(oldTextures);
      };
    }
    this.descriptor = { ...this.descriptor, width, height };
    this.resizeDepthTexture(width, height);
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
    const plan = buildSlangBindingPlan(this.descriptor.channels);
    const channelEntries = slangChannelResourceEntries(plan, sorted, this.sampler);
    if (!channelEntries) {
      this.invalidateBindGroup(); return;
    }
    entries.push(...channelEntries);
    const storageBaseBinding = plan.nextBinding;
    for (const { node, buffer } of resolvedStorage) {
      entries.push({
        binding: storageBaseBinding + node.binding,
        resource: { buffer: buffer! },
      });
    }
    if (this.isMesh() && this.meshUniformBuffer) {
      entries.push({
        binding: storageBaseBinding + (this.descriptor.storage?.length ?? 0),
        resource: { buffer: this.meshUniformBuffer },
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

  getMeshUniformBuffer(): GPUBuffer | null {
    return this.meshUniformBuffer;
  }

  getDepthView(): GPUTextureView | null {
    return this.depthTexture?.createView() ?? null;
  }

  isMesh(): boolean {
    return this.descriptor.geometry !== undefined && this.descriptor.geometry !== "fullscreen";
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

  /** Uniforms, unique channel resources, then pass-specific buffers. */
  private buildBindGroupLayoutEntries(): GPUBindGroupLayoutEntry[] {
    const entries: GPUBindGroupLayoutEntry[] = [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    }];
    const plan = buildSlangBindingPlan(this.descriptor.channels);
    entries.push(...slangChannelLayoutEntries(plan, this.descriptor.vertexChannels ? GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT : GPUShaderStage.FRAGMENT));
    const storageBaseBinding = plan.nextBinding;
    for (const node of this.descriptor.storage ?? []) {
      const writable = node.containsAtomic === true;
      entries.push({
        binding: storageBaseBinding + node.binding,
        visibility: writable ? GPUShaderStage.FRAGMENT : GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: writable ? "storage" : "read-only-storage" },
      });
    }
    if (this.isMesh()) {
      entries.push({ binding: storageBaseBinding + (this.descriptor.storage?.length ?? 0), visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
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
      label: `${this.descriptor.name} output`,
      size: { width, height },
      format: this.targetFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
  }

  private resizeDepthTexture(width: number, height: number): void {
    if (!this.isMesh()) {
      return;
    }
    const nextDepthTexture = this.device.createTexture({
      label: `${this.descriptor.name} depth`,
      size: { width, height },
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTexture?.destroy?.();
    this.depthTexture = nextDepthTexture;
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
    this.meshUniformBuffer?.destroy?.();
    this.meshUniformBuffer = null;
    this.depthTexture?.destroy?.();
    this.depthTexture = null;
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
    // Rebuild, feedback reset and dispose all replace the live ping-pong
    // targets. A frame encoded before this call may still be in flight, so the
    // textures only die once the queue reports its submitted work complete.
    this.retireTexturesAfterSubmittedWork(this.textures);
    this.textures = [];
    this.outputViews = [];
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

  private static destroyTextureList(textures: GPUTexture[]): void {
    for (const texture of textures) {
      texture.destroy?.();
    }
  }
}
