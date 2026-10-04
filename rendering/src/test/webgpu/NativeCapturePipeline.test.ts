import { describe, expect, it } from "vitest";
import { capturePipelineDescriptor } from "../../webgpu/NativeCapturePipeline";

function descriptor(useViewerCamera?: boolean, geometry: "cube" | "fullscreen" = "cube") {
  return capturePipelineDescriptor({} as GPUPipelineLayout, {} as GPUShaderModule, {
    geometry,
    width: 8,
    height: 8,
    useViewerCamera,
  }, "fragment");
}

describe("capturePipelineDescriptor", () => {
  it("captures procedural vertices using their topology without mesh attributes", () => {
    const pipeline = capturePipelineDescriptor({} as GPUPipelineLayout, {} as GPUShaderModule, {
      geometry: "vertices", width: 8, height: 8, topology: "point-list", vertexSpace: "clip",
    }, "fragment");
    expect(pipeline.vertex.buffers).toBeUndefined();
    expect(pipeline.primitive?.topology).toBe("point-list");
    expect(pipeline.depthStencil).toMatchObject({ depthWriteEnabled: true });
  });
  it.each([[undefined, "less"], [true, "less"], [false, "less-equal"]] as const)(
    "uses %s viewer camera depth comparison", (useViewerCamera, depthCompare) => {
      expect(descriptor(useViewerCamera).depthStencil).toMatchObject({ depthCompare });
    },
  );

  it("keeps fullscreen fragment depth comparison unchanged", () => {
    expect(descriptor(false, "fullscreen").depthStencil).toBeUndefined();
    const depthWriting = capturePipelineDescriptor({} as GPUPipelineLayout, {} as GPUShaderModule, {
      geometry: "fullscreen", width: 8, height: 8, writesDepth: true, useViewerCamera: false,
    }, "fragment");
    expect(depthWriting.depthStencil).toMatchObject({ depthCompare: "always" });
  });
});
