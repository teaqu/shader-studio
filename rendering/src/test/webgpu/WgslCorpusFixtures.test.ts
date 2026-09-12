import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { wrapWgslImageSource } from "../../webgpu/WgslPrelude";

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../tests/fixtures/shader-corpus", name), "utf8");
}

/**
 * Headless smoke coverage for the WGSL corpus fixtures. The browser corpus
 * suite renders these for real; these tests pin the assembly invariants that
 * must hold for any fixture (balanced module, unique bindings, wired entry
 * points) without needing a GPU.
 */
describe("WGSL corpus fixtures", () => {
  it.each([
    ["wgsl/test.wgsl", "fn mainImage(coord: vec2<f32>)"],
    ["wgsl/texture.wgsl", "// Texture input smoke test for WGSL/WebGPU."],
  ])("wraps %s into a structurally sound module", (name, firstLine) => {
    const userSource = loadFixture(name);
    const channels = name === "wgsl/texture.wgsl"
      ? [{ slot: 0, key: "iChannel0", kind: "texture" as const, textureIdentity: "t", samplerIdentity: "s" }]
      : [];
    const { source, preludeLineCount } = wrapWgslImageSource(userSource, { channels });

    // Balanced braces and parentheses in the assembled module.
    for (const [open, close] of [["{", "}"], ["(", ")"]] as const) {
      const opens = source.split(open).length;
      const closes = source.split(close).length;
      expect(closes, `${name}: unbalanced ${open}${close}`).toBe(opens);
    }
    // One declaration per binding number.
    const bindings = [...source.matchAll(/@binding\((\d+)\)/g)].map((match) => Number(match[1]));
    expect(new Set(bindings).size).toBe(bindings.length);
    // User entry and generated entries are all present.
    expect(source).toContain("fn mainImage(coord: vec2<f32>) -> vec4<f32>");
    expect(source).toContain("@vertex fn vertexMain(");
    expect(source).toContain("@fragment fn fragmentMain(");
    // The user's line 1 really is where the offset says it is.
    const userStart = source.indexOf(firstLine);
    expect(userStart).toBeGreaterThanOrEqual(0);
    expect(source.slice(0, userStart).split("\n").length - 1).toBe(preludeLineCount);
  });

  it("wires the texture fixture's channel accessors", () => {
    const { source } = wrapWgslImageSource(loadFixture("wgsl/texture.wgsl"), {
      channels: [{ slot: 0, key: "iChannel0", kind: "texture" as const, textureIdentity: "t", samplerIdentity: "s" }],
    });
    expect(source).toContain("fn iChannel0Sample(uv: vec2<f32>) -> vec4<f32>");
    expect(source).toContain("var iChannel0Texture: texture_2d<f32>;");
  });
});
