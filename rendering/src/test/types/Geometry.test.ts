import { describe, expect, it } from "vitest";
import {
  depthClearValue,
  isClipSpaceVertices,
  renderPipelineStateKey,
  resolvePassGeometry,
  resolvePassRenderSettings,
  resolveRenderState,
  resolveVerticesDraw,
  verticesSpace,
  verticesTopology,
  verticesVertexCount,
} from "../../types/Geometry";
import { hasDepthAttachment, isMeshGeometry } from "../../preview3d/MeshFragmentContext";

describe("resolvePassGeometry", () => {
  it("defaults omitted geometry to fullscreen", () => {
    expect(resolvePassGeometry(undefined)).toBe("fullscreen");
    expect(resolvePassGeometry({})).toBe("fullscreen");
    expect(resolvePassGeometry({ geometry: { type: "vertices" } })).toBe("vertices");
  });
});

describe("resolveVerticesDraw", () => {
  it("copies only the configured fields of vertices geometry", () => {
    expect(resolveVerticesDraw({ geometry: { type: "vertices" } })).toEqual({});
    expect(resolveVerticesDraw({ geometry: { type: "vertices", vertexCount: 6 } })).toEqual({ vertexCount: 6 });
    expect(resolveVerticesDraw({ geometry: { type: "vertices", vertexCount: 6, topology: "line-strip", space: "clip" } }))
      .toEqual({ vertexCount: 6, topology: "line-strip", space: "clip" });
  });

  it("ignores every other geometry and an omitted geometry", () => {
    expect(resolveVerticesDraw(undefined)).toEqual({});
    expect(resolveVerticesDraw({})).toEqual({});
    for (const type of ["fullscreen", "plane", "cube", "sphere", "model"] as const) {
      expect(resolveVerticesDraw({ geometry: { type, vertexCount: 6, topology: "point-list", space: "clip" } })).toEqual({});
    }
  });

  it("defaults count, topology and space", () => {
    expect(verticesVertexCount({})).toBe(3);
    expect(verticesTopology({})).toBe("triangle-list");
    expect(verticesSpace({})).toBe("world");
    expect(verticesVertexCount({ vertexCount: 12 })).toBe(12);
    expect(verticesTopology({ topology: "line-list" })).toBe("line-list");
    expect(verticesSpace({ space: "clip" })).toBe("clip");
  });

  it("recognises clip-space vertices only", () => {
    expect(isClipSpaceVertices({ geometry: "vertices", space: "clip" })).toBe(true);
    expect(isClipSpaceVertices({ geometry: "vertices" })).toBe(false);
    expect(isClipSpaceVertices({ geometry: "cube", space: "clip" })).toBe(false);
    expect(isClipSpaceVertices({})).toBe(false);
  });
});

describe("resolvePassRenderSettings", () => {
  it("copies configured blend, depth and cull and leaves absent fields absent", () => {
    expect(resolvePassRenderSettings(undefined)).toEqual({});
    expect(resolvePassRenderSettings({})).toEqual({});
    const depth = { write: false };
    const resolved = resolvePassRenderSettings({ blend: "additive", depth, cull: "back" });
    expect(resolved).toEqual({ blend: "additive", depth: { write: false }, cull: "back" });
    expect(resolved.depth).not.toBe(depth);
  });
});

describe("resolveRenderState", () => {
  it("gives fullscreen no depth state and no culling, keeping its blend", () => {
    expect(resolveRenderState({ geometry: "fullscreen" })).toEqual({ blend: "none", depth: null, cull: "none" });
    expect(resolveRenderState({})).toEqual({ blend: "none", depth: null, cull: "none" });
    expect(resolveRenderState({ geometry: "fullscreen", blend: "alpha" })).toEqual({ blend: "alpha", depth: null, cull: "none" });
  });

  it.each(["plane", "cube", "sphere", "model", "vertices"] as const)("reproduces today's depth for %s when omitted", (geometry) => {
    expect(resolveRenderState({ geometry })).toEqual({
      blend: "none",
      depth: { test: true, write: true, compare: "less" },
      cull: "none",
    });
  });

  it("turns the test off by default for clip-space vertices only", () => {
    expect(resolveRenderState({ geometry: "vertices", space: "clip" }).depth).toEqual({ test: false, write: true, compare: "less" });
    expect(resolveRenderState({ geometry: "vertices", space: "world" }).depth).toEqual({ test: true, write: true, compare: "less" });
    expect(resolveRenderState({ geometry: "vertices", space: "clip", depth: { test: true } }).depth?.test).toBe(true);
  });

  it("applies every configured field over the defaults", () => {
    expect(resolveRenderState({
      geometry: "cube",
      blend: "premultiplied",
      depth: { test: false, write: false, compare: "greater-equal" },
      cull: "front",
    })).toEqual({
      blend: "premultiplied",
      depth: { test: false, write: false, compare: "greater-equal" },
      cull: "front",
    });
  });
});

describe("renderPipelineStateKey", () => {
  const base = { geometry: "vertices" as const };

  it("changes with topology, space, blend, each depth field and cull", () => {
    const keys = [
      renderPipelineStateKey(base),
      renderPipelineStateKey({ ...base, topology: "line-list" }),
      renderPipelineStateKey({ ...base, space: "clip" }),
      renderPipelineStateKey({ ...base, blend: "additive" }),
      renderPipelineStateKey({ ...base, depth: { test: false } }),
      renderPipelineStateKey({ ...base, depth: { write: false } }),
      renderPipelineStateKey({ ...base, depth: { compare: "greater" } }),
      renderPipelineStateKey({ ...base, cull: "back" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores vertexCount, which is only a draw argument", () => {
    expect(renderPipelineStateKey({ ...base, vertexCount: 6 })).toBe(renderPipelineStateKey({ ...base, vertexCount: 600 }));
  });

  it("treats explicit defaults as the omitted state", () => {
    expect(renderPipelineStateKey({ ...base, topology: "triangle-list", space: "world", blend: "none", depth: { test: true, write: true, compare: "less" }, cull: "none" }))
      .toBe(renderPipelineStateKey(base));
    expect(renderPipelineStateKey({ geometry: "cube" })).not.toBe(renderPipelineStateKey({ geometry: "fullscreen" }));
  });
});

describe("mesh geometry predicates", () => {
  it("treats only indexed meshes as mesh geometry", () => {
    expect(isMeshGeometry(undefined)).toBe(false);
    expect(isMeshGeometry("fullscreen")).toBe(false);
    expect(isMeshGeometry("vertices")).toBe(false);
    for (const geometry of ["plane", "cube", "sphere", "model"] as const) {
      expect(isMeshGeometry(geometry)).toBe(true);
    }
  });

  it("gives every geometry but fullscreen a depth attachment", () => {
    expect(hasDepthAttachment(undefined)).toBe(false);
    expect(hasDepthAttachment("fullscreen")).toBe(false);
    for (const geometry of ["vertices", "plane", "cube", "sphere", "model"] as const) {
      expect(hasDepthAttachment(geometry)).toBe(true);
    }
  });
});

describe("depthClearValue", () => {
  it("clears to 0 for greater compares with the test on, so they can pass", () => {
    expect(depthClearValue(resolveRenderState({ geometry: "cube", depth: { compare: "greater" } }))).toBe(0);
    expect(depthClearValue(resolveRenderState({ geometry: "vertices", depth: { compare: "greater-equal" } }))).toBe(0);
  });

  it("clears to 1 otherwise, including greater with the test off and fullscreen", () => {
    for (const compare of ["never", "less", "equal", "less-equal", "not-equal", "always"] as const) {
      expect(depthClearValue(resolveRenderState({ geometry: "cube", depth: { compare } }))).toBe(1);
    }
    expect(depthClearValue(resolveRenderState({ geometry: "cube", depth: { test: false, compare: "greater" } }))).toBe(1);
    expect(depthClearValue(resolveRenderState({ geometry: "vertices", space: "clip", depth: { compare: "greater" } }))).toBe(1);
    expect(depthClearValue(resolveRenderState({ geometry: "fullscreen" }))).toBe(1);
  });
});
