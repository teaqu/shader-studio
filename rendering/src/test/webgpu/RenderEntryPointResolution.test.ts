import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { resolveRenderEntryPoints } from "../../webgpu/RenderEntryPointResolution";

const source = "@vertex fn vertices() -> @builtin(position) vec4f { return vec4f(0); } @fragment fn image() -> @location(0) vec4f { return vec4f(1); }";

describe("native render configuration validation", () => {
  it.each([{ vertex: 0 }, { fragment: "" }, { other: "image" }, { vertex: false }])("rejects malformed selections %j instead of auto-selecting", entryPoints => {
    const errors: string[] = [];
    const pass = { entryPoints } as unknown as ShaderConfig["passes"][string];
    expect(resolveRenderEntryPoints("Image", pass, source, "wgsl", errors)).toBeNull();
    expect(errors[0]).toContain("entryPoints");
  });
  it("auto-selects omitted names in a valid native object", () => {
    const errors: string[] = [];
    expect(resolveRenderEntryPoints("Image", { entryPoints: {} }, source, "wgsl", errors)).toEqual({ vertex: "vertices", fragment: "image" });
    expect(errors).toEqual([]);
  });
});
