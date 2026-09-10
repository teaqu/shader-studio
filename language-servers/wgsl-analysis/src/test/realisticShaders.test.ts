import { describe, expect, it } from "vitest";
import { parseWgslDocument } from "../parseWgslDocument";

const URI = "file:///workspace/image.wgsl";

/** Representative of real authoring: directives, structs, storage, control flow. */
const REALISTIC = [
  "enable f16;",
  "diagnostic(off, derivative_uniformity);",
  "struct Ray { origin: vec3f, direction: vec3f, }",
  "alias Color = vec4f;",
  "@group(0) @binding(0) var<uniform> uniforms: vec4f;",
  "@group(0) @binding(1) var<storage, read> particles: array<vec4f, 64>;",
  "var<private> step: u32 = 0u;",
  "fn trace(ray: Ray, depth: i32) -> Color {",
  "  var result: Color = Color(0.0, 0.0, 0.0, 1.0);",
  "  for (var bounce: i32 = 0; bounce < depth; bounce += 1) {",
  "    let hit = particles[bounce & 63];",
  "    switch bounce {",
  "      case 0: { result = Color(hit.xyz, 1.0); }",
  "      default: { result += Color(hit.zyx, 0.0); }",
  "    }",
  "  }",
  "  return result;",
  "}",
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  var ray: Ray;",
  "  ray.origin = vec3f(coord, 0.0);",
  "  ray.direction = vec3f(0.0, 0.0, -1.0);",
  "  loop {",
  "    step += 1u;",
  "    if step >= 4u { break; }",
  "  }",
  "  return trace(ray, 2);",
  "}",
].join("\n");

describe("parseWgslDocument realistic shaders", () => {
  it("parses a full authoring-style shader without diagnostics", () => {
    const document = parseWgslDocument(URI, REALISTIC, "fragment");

    expect(document.parsedSuccessfully).toBe(true);
    expect(document.diagnostics).toEqual([]);
    const names = document.symbols.map((symbol) => symbol.name);
    for (const name of ["Ray", "Color", "uniforms", "particles", "step", "trace", "mainImage", "ray", "bounce", "hit", "result"]) {
      expect(names).toContain(name);
    }
  });

  it("links cross-function references in a realistic shader", () => {
    const document = parseWgslDocument(URI, REALISTIC, "fragment");
    const trace = document.symbols.find((symbol) => symbol.name === "trace");

    expect(trace?.references).toHaveLength(1);
    expect(document.unresolvedReferences).toEqual([]);
  });
});
