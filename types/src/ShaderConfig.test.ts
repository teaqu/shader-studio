import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BLEND_MODES,
  CULL_MODES,
  DEFAULT_BLEND_MODE,
  DEFAULT_CLEAR_COLOR,
  DEFAULT_CULL_MODE,
  DEFAULT_DEPTH_COMPARE,
  DEFAULT_VERTEX_COUNT,
  DEFAULT_VERTEX_SPACE,
  DEFAULT_VERTEX_TOPOLOGY,
  DEPTH_COMPARE_FUNCTIONS,
  FULLSCREEN_VERTEX_COUNT,
  GEOMETRY_TYPES,
  MAX_VERTEX_COUNT,
  VERTEX_SPACES,
  VERTEX_TOPOLOGIES,
  type BufferPass,
  type CommonPass,
  type ComputePass,
  type GeometryConfig,
  type ImagePass,
  type RenderPassSettings,
} from "./ShaderConfig";

describe("ShaderConfig geometry", () => {
  it("lists vertices between fullscreen and the meshes", () => {
    expect(GEOMETRY_TYPES).toEqual(["fullscreen", "vertices", "plane", "cube", "sphere", "model"]);
  });

  it("offers only topologies WebGL and WebGPU both draw", () => {
    expect(VERTEX_TOPOLOGIES).toEqual(["triangle-list", "triangle-strip", "line-list", "line-strip", "point-list"]);
    expect(DEFAULT_VERTEX_TOPOLOGY).toBe("triangle-list");
  });

  it("defaults vertices to world space and three vertices", () => {
    expect(VERTEX_SPACES).toEqual(["world", "clip"]);
    expect(DEFAULT_VERTEX_SPACE).toBe("world");
    expect(DEFAULT_VERTEX_COUNT).toBe(3);
  });

  it("caps vertexCount at WebGL's GLsizei maximum", () => {
    expect(MAX_VERTEX_COUNT).toBe(2 ** 31 - 1);
  });

  it("draws fullscreen as one three-vertex triangle", () => {
    expect(FULLSCREEN_VERTEX_COUNT).toBe(3);
  });

  it("only accepts vertex fields on vertices geometry", () => {
    expectTypeOf<{ type: "vertices"; vertexCount: 6; topology: "line-strip"; space: "clip" }>().toMatchTypeOf<GeometryConfig>();
    // @ts-expect-error fullscreen always draws three vertices
    const fullscreen: GeometryConfig = { type: "fullscreen", vertexCount: 6 };
    // @ts-expect-error meshes have a fixed topology
    const cube: GeometryConfig = { type: "cube", topology: "line-list" };
    // @ts-expect-error models are drawn in world space
    const model: GeometryConfig = { type: "model", path: "a.glb", space: "clip" };
    expect([fullscreen, cube, model]).toHaveLength(3);
  });
});

describe("ShaderConfig render settings", () => {
  it("lists the blend modes with none as the default", () => {
    expect(BLEND_MODES).toEqual(["none", "alpha", "premultiplied", "additive"]);
    expect(DEFAULT_BLEND_MODE).toBe("none");
  });

  it("defaults pass clear colour to opaque black", () => {
    expect(DEFAULT_CLEAR_COLOR).toEqual([0, 0, 0, 1]);
  });

  it("lists every WebGPU depth compare function with less as the default", () => {
    expect(DEPTH_COMPARE_FUNCTIONS).toEqual(["never", "less", "equal", "less-equal", "greater", "not-equal", "greater-equal", "always"]);
    expect(DEFAULT_DEPTH_COMPARE).toBe("less");
  });

  it("lists the cull modes with none as the default", () => {
    expect(CULL_MODES).toEqual(["none", "back", "front"]);
    expect(DEFAULT_CULL_MODE).toBe("none");
  });

  it("puts render settings on Image and buffer passes only", () => {
    expectTypeOf<ImagePass>().toMatchTypeOf<RenderPassSettings>();
    expectTypeOf<BufferPass>().toMatchTypeOf<RenderPassSettings>();
    expectTypeOf<ComputePass["blend"]>().toEqualTypeOf<undefined>();
    expectTypeOf<ComputePass["clear"]>().toEqualTypeOf<undefined>();
    expectTypeOf<ComputePass["depth"]>().toEqualTypeOf<undefined>();
    expectTypeOf<ComputePass["cull"]>().toEqualTypeOf<undefined>();
    expectTypeOf<CommonPass["blend"]>().toEqualTypeOf<undefined>();
    expectTypeOf<CommonPass["clear"]>().toEqualTypeOf<undefined>();
    expectTypeOf<CommonPass["depth"]>().toEqualTypeOf<undefined>();
    expectTypeOf<CommonPass["cull"]>().toEqualTypeOf<undefined>();
  });
});
