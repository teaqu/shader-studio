import { describe, expect, it } from "vitest";
import { parseWgslDocument, visibleSymbolsAtPosition } from "../parseWgslDocument";

const URI = "file:///workspace/image.wgsl";

describe("host-global seeding", () => {
  it("types unannotated locals from host globals", () => {
    const document = parseWgslDocument(URI, [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let t = iTime;",
      "  let res = iResolution.xy;",
      "  return vec4f(t, res.x, 0.0, 1.0);",
      "}",
    ].join("\n"), "fragment");

    const types = Object.fromEntries(document.symbols
      .filter((symbol) => symbol.kind === "variable")
      .map((symbol) => [symbol.name, symbol.typeName]));
    expect(types).toMatchObject({ t: "f32", res: "vec2f" });
    expect(document.unresolvedReferences.map((reference) => reference.name)).not.toContain("iTime");
  });

  it("exposes host globals with their prelude types at any position", () => {
    const document = parseWgslDocument(URI, [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  return vec4f(iTime, 0.0, 0.0, 1.0);",
      "}",
    ].join("\n"), "fragment");

    const visible = visibleSymbolsAtPosition(document, { line: 1, character: 10 });
    expect(visible.find((symbol) => symbol.name === "iTime")).toMatchObject({ typeName: "f32" });
    expect(visible.find((symbol) => symbol.name === "iResolution")).toMatchObject({ typeName: "vec3f" });
    expect(visible.find((symbol) => symbol.name === "iFrame")).toMatchObject({ typeName: "i32" });
  });

  it("limits stage-gated globals to their stage", () => {
    const fragment = parseWgslDocument(URI, "fn mainImage(coord: vec2f) -> vec4f {\n  return vec4f(0.0);\n}", "fragment");
    const compute = parseWgslDocument(URI, "@compute @workgroup_size(8)\nfn main() {\n}", "compute");

    const fragmentNames = visibleSymbolsAtPosition(fragment, { line: 1, character: 2 }).map((symbol) => symbol.name);
    const computeNames = visibleSymbolsAtPosition(compute, { line: 2, character: 0 }).map((symbol) => symbol.name);
    expect(fragmentNames).toContain("iWorldPosition");
    expect(fragmentNames).not.toContain("iDispatch");
    expect(computeNames).toContain("iDispatch");
    expect(computeNames).not.toContain("iWorldPosition");
  });

  it("lets user declarations shadow host globals", () => {
    const document = parseWgslDocument(URI, [
      "var iTime = 2.0;",
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  return vec4f(iTime, 0.0, 0.0, 1.0);",
      "}",
    ].join("\n"), "fragment");

    const visible = visibleSymbolsAtPosition(document, { line: 2, character: 12 })
      .filter((symbol) => symbol.name === "iTime");
    expect(visible).toHaveLength(1);
    expect(visible[0]?.declaration.start).toMatchObject({ line: 0 });
  });
});
