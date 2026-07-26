/// <reference types="@webgpu/types" />
import { OrbitCamera } from "../preview3d/OrbitCamera";
import { createModelMatrix, createNormalMatrix3, multiplyMatrices } from "../preview3d/math";
import { createAxesMesh, createGridMesh, createPreviewMesh, getPreviewMeshGroundOffset } from "../preview3d/meshes";
import type { PreviewSettings } from "../preview3d/types";
import type { SlangPassPipeline } from "./SlangPassPipeline";

const LINE_SHADER = `
struct SceneUniforms { viewProjection: mat4x4f; };
@group(0) @binding(0) var<uniform> scene: SceneUniforms;
struct VertexIn { @location(0) position: vec3f, @location(1) color: vec3f };
struct VertexOut { @builtin(position) position: vec4f, @location(0) color: vec3f };
@vertex fn vs(input: VertexIn) -> VertexOut {
  var output: VertexOut;
  output.position = scene.viewProjection * vec4f(input.position, 1.0);
  output.color = input.color;
  return output;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f { return vec4f(input.color, 1.0); }
`;

interface GpuMesh { vertex: GPUBuffer; index: GPUBuffer; count: number; }
interface LineResources { pipeline: GPURenderPipeline; uniform: GPUBuffer; bindGroup: GPUBindGroup; }

/** WebGPU resources which are independent of a user's generated Slang module. */
export class WebGPUPreviewScene {
  private readonly camera = new OrbitCamera();
  private settings: PreviewSettings | null = null;
  private meshKind: PreviewSettings["mesh"] | null = null;
  private mesh: GpuMesh | null = null;
  private grid: GpuMesh | null = null;
  private axes: GpuMesh | null = null;
  private depthTexture: GPUTexture | null = null;
  private depthWidth = 0;
  private depthHeight = 0;
  private linePipeline: GPURenderPipeline | null = null;
  private lineUniform: GPUBuffer | null = null;
  private lineBindGroup: GPUBindGroup | null = null;

  constructor(private readonly device: GPUDevice, private readonly format: GPUTextureFormat) {
    let grid: GpuMesh | null = null;
    let axes: GpuMesh | null = null;
    let lines: LineResources | null = null;
    try {
      grid = this.uploadLines(createGridMesh());
      axes = this.uploadLines(createAxesMesh());
      lines = this.createLineResources();
      this.grid = grid;
      this.axes = axes;
      this.linePipeline = lines.pipeline;
      this.lineUniform = lines.uniform;
      this.lineBindGroup = lines.bindGroup;
    } catch (error) {
      destroyMesh(grid); destroyMesh(axes); lines?.uniform.destroy?.();
      throw new Error(`Unable to create 3D preview scene: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  attach(canvas: HTMLCanvasElement): void {
    this.camera.attach(canvas);
  }
  setInputEnabled(enabled: boolean): void {
    this.camera.setInputEnabled(enabled);
  }
  resetCamera(): void {
    this.camera.reset();
  }

  setSettings(settings: PreviewSettings): void {
    if (settings.mesh !== this.meshKind) {
      const nextMesh = this.uploadMesh(settings.mesh);
      destroyMesh(this.mesh);
      this.mesh = nextMesh;
      this.meshKind = settings.mesh;
    }
    this.settings = settings;
  }

  getDepthView(width: number, height: number): GPUTextureView | null {
    if (width <= 0 || height <= 0) {
      return null;
    }
    if (!this.depthTexture || width !== this.depthWidth || height !== this.depthHeight) {
      const next = this.device.createTexture({
        size: { width, height }, format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      try {
        const view = next.createView();
        const previous = this.depthTexture;
        this.depthTexture = next;
        this.depthWidth = width; this.depthHeight = height;
        previous?.destroy?.();
        return view;
      } catch (error) {
        next.destroy?.();
        throw error;
      }
    }
    return this.depthTexture.createView();
  }

  writePreviewUniforms(pipeline: SlangPassPipeline, width: number, height: number): void {
    const settings = this.settings;
    const buffer = pipeline.getPreviewUniformBuffer();
    if (!settings || !buffer) {
      return;
    }
    const position = [...settings.object.position] as [number, number, number];
    position[1] += getPreviewMeshGroundOffset(settings.mesh) * settings.object.scale[1];
    const model = createModelMatrix({ ...settings.object, position });
    const normal3 = createNormalMatrix3(model);
    const normal = new Float32Array(16);
    normal[0] = normal3[0]; normal[1] = normal3[1]; normal[2] = normal3[2];
    normal[4] = normal3[3]; normal[5] = normal3[4]; normal[6] = normal3[5];
    normal[8] = normal3[6]; normal[9] = normal3[7]; normal[10] = normal3[8]; normal[15] = 1;
    const viewProjection = multiplyMatrices(this.camera.getProjectionMatrix(width / Math.max(height, 1), "webgpu"), this.camera.getViewMatrix());
    const values = new Float32Array(64);
    values.set(model, 0); values.set(viewProjection, 16); values.set(normal, 32);
    values.set([settings.mapping.scale[0], settings.mapping.scale[1], settings.mapping.offset[0], settings.mapping.offset[1]], 48);
    values.set([wrapValue(settings.mapping.wrap), settings.lighting === "lit" ? 1 : 0, settings.mapping.rotation, 0], 52);
    this.device.queue.writeBuffer(buffer, 0, values);
  }

  encodeGrid(pass: GPURenderPassEncoder, width: number, height: number): void {
    if (!this.settings?.scene.grid) {
      return;
    }
    this.encodeLines(pass, this.grid, width, height);
  }
  encodeAxes(pass: GPURenderPassEncoder, width: number, height: number): void {
    if (!this.settings?.scene.axes) {
      return;
    }
    this.encodeLines(pass, this.axes, width, height);
  }
  encodeMesh(pass: GPURenderPassEncoder): void {
    if (!this.mesh) {
      return;
    }
    pass.setVertexBuffer(0, this.mesh.vertex);
    pass.setIndexBuffer(this.mesh.index, "uint16");
    pass.drawIndexed(this.mesh.count);
  }

  dispose(): void {
    this.camera.detach();
    for (const resource of [this.mesh, this.grid, this.axes]) {
      destroyMesh(resource);
    }
    this.depthTexture?.destroy?.(); this.lineUniform?.destroy?.();
    this.mesh = this.grid = this.axes = null; this.depthTexture = null; this.lineUniform = null; this.lineBindGroup = null; this.linePipeline = null;
  }

  private uploadMesh(kind: PreviewSettings["mesh"]): GpuMesh {
    const mesh = createPreviewMesh(kind); const values = new Float32Array(mesh.positions.length / 3 * 8);
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      values.set(mesh.positions.subarray(vertex * 3, vertex * 3 + 3), vertex * 8);
      values.set(mesh.normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 8 + 3);
      values.set(mesh.uvs.subarray(vertex * 2, vertex * 2 + 2), vertex * 8 + 6);
    }
    return this.upload(values, mesh.indices);
  }
  private uploadLines(lines: ReturnType<typeof createGridMesh>): GpuMesh {
    const values = new Float32Array(lines.positions.length / 3 * 6);
    for (let vertex = 0; vertex < lines.positions.length / 3; vertex += 1) {
      values.set(lines.positions.subarray(vertex * 3, vertex * 3 + 3), vertex * 6);
      values.set(lines.colors.subarray(vertex * 3, vertex * 3 + 3), vertex * 6 + 3);
    }
    return this.upload(values, lines.indices);
  }
  private upload(values: Float32Array, indices: Uint16Array): GpuMesh {
    const VERTEX = globalThis.GPUBufferUsage?.VERTEX ?? 0x20; const INDEX = globalThis.GPUBufferUsage?.INDEX ?? 0x10; const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x08;
    const vertex = this.device.createBuffer({ size: values.byteLength, usage: VERTEX | COPY_DST });
    let index: GPUBuffer | null = null;
    try {
      index = this.device.createBuffer({ size: indices.byteLength, usage: INDEX | COPY_DST });
      this.device.queue.writeBuffer(vertex, 0, values); this.device.queue.writeBuffer(index, 0, indices);
      return { vertex, index, count: indices.length };
    } catch (error) {
      vertex.destroy?.();
      index?.destroy?.();
      throw error;
    }
  }
  private createLineResources(): LineResources {
    const module = this.device.createShaderModule({ code: LINE_SHADER });
    const layout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }] });
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: "vs", buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] }] },
      fragment: { module, entryPoint: "fs", targets: [{ format: this.format }] }, primitive: { topology: "line-list" }, depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
    });
    const UNIFORM = globalThis.GPUBufferUsage?.UNIFORM ?? 0x40; const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x08;
    const uniform = this.device.createBuffer({ size: 64, usage: UNIFORM | COPY_DST });
    try {
      const bindGroup = this.device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniform } }] });
      return { pipeline, uniform, bindGroup };
    } catch (error) {
      uniform.destroy?.();
      throw error;
    }
  }
  private encodeLines(pass: GPURenderPassEncoder, lines: GpuMesh | null, width: number, height: number): void {
    if (!lines || !this.linePipeline || !this.lineUniform || !this.lineBindGroup) {
      return;
    }
    this.device.queue.writeBuffer(this.lineUniform, 0, multiplyMatrices(this.camera.getProjectionMatrix(width / Math.max(height, 1), "webgpu"), this.camera.getViewMatrix()));
    pass.setPipeline(this.linePipeline); pass.setBindGroup(0, this.lineBindGroup); pass.setVertexBuffer(0, lines.vertex); pass.setIndexBuffer(lines.index, "uint16"); pass.drawIndexed(lines.count);
  }
}

function wrapValue(value: PreviewSettings["mapping"]["wrap"]): number {
  return value === "repeat" ? 0 : value === "mirror" ? 1 : 2;
}

function destroyMesh(mesh: GpuMesh | null): void {
  mesh?.vertex.destroy?.();
  mesh?.index.destroy?.();
}
