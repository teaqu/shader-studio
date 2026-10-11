import { describe, expect, it } from "vitest";
import { createVertexHookSource } from "../VertexHookInsertion";

describe.each(["glsl", "slang", "wgsl"] as const)("%s vertex insertion", language => {
  it("adds an identity hook for meshes and fullscreen", () => {
    const text = createVertexHookSource(language, "// mainVertex is not defined");
    expect(text).toContain("mainVertex");
    expect(text).toContain("vertexIndex");
    expect(text).not.toContain("corners");
  });
  it("places a triangle for vertices geometry", () => {
    expect(createVertexHookSource(language, "", true)).toContain("corners[vertexIndex % 3");
  });
  it("reuses an existing hook without modifying the shader", () => {
    expect(createVertexHookSource(language, createVertexHookSource(language, ""), true)).toBe("");
  });
});
