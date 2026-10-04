import { describe, expect, it, vi } from "vitest";
import { nativeRasterCaptureContext, nativeRasterUsesCamera } from "../../webgpu/NativeRasterCaptureContext";
import type { RenderPassNode } from "../../types/PassGraph";

function pass(overrides: Partial<RenderPassNode> = {}): RenderPassNode {
  return {
    name: "Image", source: "", language: "wgsl", geometry: "fullscreen", kind: "render", output: "canvas",
    outputLayers: 1, dispatchCount: 1, dispatchOnce: false, workgroupSize: [8, 8, 1], width: 320, height: 180,
    channels: [], entryPoints: { vertex: "vertices", fragment: "image" }, ...overrides,
  };
}

function encoder() {
  return { draw: vi.fn(), setVertexBuffer: vi.fn(), setIndexBuffer: vi.fn(), drawIndexed: vi.fn() };
}

describe("nativeRasterCaptureContext", () => {
  it.each([['fullscreen', undefined, false], ['cube', undefined, true], ['vertices', 'clip', false], ['vertices', 'world', true]] as const)(
    "resolves camera bindings for %s %s", (geometry, vertexSpace, expected) => {
      expect(nativeRasterUsesCamera({ geometry, vertexSpace, width: 1, height: 1 })).toBe(expected);
    });
  it("draws configured procedural vertices without a mesh buffer", () => {
    const resources = vi.fn();
    const context = nativeRasterCaptureContext(pass({ geometry: "vertices", vertexCount: 12, instanceCount: 2,
      topology: "point-list", space: "clip" }), resources)!;
    const draw = encoder();
    context.draw!(draw as unknown as GPURenderPassEncoder);
    expect(draw.draw).toHaveBeenCalledWith(12, 2);
    expect(resources).not.toHaveBeenCalled();
    expect(draw.setVertexBuffer).not.toHaveBeenCalled();
    expect(context).toMatchObject({ topology: "point-list", vertexSpace: "clip" });
  });
  it("returns undefined for missing and legacy hook passes", () => {
    const resources = vi.fn();
    expect(nativeRasterCaptureContext(undefined, resources as any)).toBeUndefined();
    expect(nativeRasterCaptureContext(pass({ entryPoints: undefined }), resources as any)).toBeUndefined();
    expect(resources).not.toHaveBeenCalled();
  });

  it("uses authored stages and fullscreen draw without resolving a mesh", () => {
    const resources = vi.fn();
    const context = nativeRasterCaptureContext(pass(), resources as any)!;
    const draw = encoder();
    context.draw!(draw as any);
    expect(context).toMatchObject({ vertexEntryPoint: "vertices", fragmentEntryPoint: "image", geometry: "fullscreen", width: 320, height: 180 });
    expect(draw.draw).toHaveBeenCalledWith(3);
    expect(resources).not.toHaveBeenCalled();
  });

  it("binds indexed built-in mesh buffers with their original index format", () => {
    const mesh = { vertexBuffer: {} as GPUBuffer, indexBuffer: {} as GPUBuffer, indexFormat: "uint32" as GPUIndexFormat, indexCount: 36 };
    const resources = vi.fn(() => ({ get: vi.fn(() => mesh), getModel: vi.fn() }));
    const context = nativeRasterCaptureContext(pass({ geometry: "cube" }), resources as any)!;
    const draw = encoder();
    context.draw!(draw as any);
    const resolved = resources.mock.results[0]!.value;
    expect(resolved.get).toHaveBeenCalledWith("cube");
    expect(draw.setVertexBuffer).toHaveBeenCalledWith(0, mesh.vertexBuffer);
    expect(draw.setIndexBuffer).toHaveBeenCalledWith(mesh.indexBuffer, "uint32");
    expect(draw.drawIndexed).toHaveBeenCalledWith(36);
  });

  it("propagates an explicit viewer-camera choice for native capture depth state", () => {
    expect(nativeRasterCaptureContext(pass({ geometry: "cube", useViewerCamera: false }), vi.fn() as any))
      .toMatchObject({ useViewerCamera: false });
    expect(nativeRasterCaptureContext(pass({ geometry: "cube", useViewerCamera: true }), vi.fn() as any))
      .toMatchObject({ useViewerCamera: true });
  });

  it("looks up GLB geometry by pass name and diagnoses a missing mesh", () => {
    const mesh = { vertexBuffer: {} as GPUBuffer, indexBuffer: {} as GPUBuffer, indexFormat: "uint16" as GPUIndexFormat, indexCount: 12 };
    const resources = vi.fn(() => ({ get: vi.fn(), getModel: vi.fn(() => mesh) }));
    const context = nativeRasterCaptureContext(pass({ name: "BufferA", geometry: "model", modelPath: "scene.glb" }), resources as any)!;
    const draw = encoder();
    context.draw!(draw as any);
    expect(resources.mock.results[0]!.value.getModel).toHaveBeenCalledWith("BufferA");
    expect(draw.drawIndexed).toHaveBeenCalledWith(12);

    const unavailable = nativeRasterCaptureContext(pass({ name: "BufferB", geometry: "model", modelPath: "missing.glb" }), () => ({ get: vi.fn(), getModel: vi.fn(() => undefined) }) as any)!;
    expect(() => unavailable.draw!(encoder() as any)).toThrow("Native raster geometry for 'BufferB' is unavailable.");
  });
});
