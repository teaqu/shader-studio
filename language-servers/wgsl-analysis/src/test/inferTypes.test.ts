import { describe, expect, it } from "vitest";
import { parseWgslDocument } from "../parseWgslDocument";

const URI = "file:///workspace/image.wgsl";

function variableTypes(source: string): Record<string, string | undefined> {
  const document = parseWgslDocument(URI, source, "fragment");
  const types: Record<string, string | undefined> = {};
  for (const symbol of document.symbols) {
    if (symbol.kind === "variable" || symbol.kind === "constant") {
      types[symbol.name] = symbol.typeName;
    }
  }
  return types;
}

describe("declaration type inference", () => {
  it("keeps explicit annotations untouched", () => {
    const types = variableTypes([
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  var uv: vec2f = coord;",
      "  return vec4f(uv, 1.0, 1.0, 1.0);",
      "}",
    ].join("\n"));

    expect(types.uv).toBe("vec2f");
  });

  it("infers constructor, identifier, and binary-expression types", () => {
    const types = variableTypes([
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let st = coord / vec2f(iResolution.x, iResolution.y);",
      "  let uv = vec2f(st.x, st.y);",
      "  let sky = vec3f(0.5) + vec3f(uv, 0.0);",
      "  return vec4f(sky, 1.0);",
      "}",
    ].join("\n"));

    expect(types.st).toBe("vec2f");
    expect(types.uv).toBe("vec2f");
    expect(types.sky).toBe("vec3f");
  });

  it("infers swizzles, literals, comparisons, and chained identifiers", () => {
    const types = variableTypes([
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let x = coord.x;",
      "  let half = 0.5;",
      "  let count = 3;",
      "  let flag = x > 0.5;",
      "  let y = x;",
      "  let neg = -x;",
      "  return vec4f(x, y, 1.0, 1.0);",
      "}",
    ].join("\n"));

    expect(types.x).toBe("f32");
    expect(types.half).toBe("f32");
    expect(types.count).toBe("i32");
    expect(types.flag).toBe("bool");
    expect(types.y).toBe("f32");
    expect(types.neg).toBe("f32");
  });

  it("splats scalars across vectors but leaves unknown builtin calls uninferred", () => {
    const types = variableTypes([
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let wave = sin(coord.x);",
      "  let mixed = coord + 1.0;",
      "  let clash = coord + vec3f(0.0);",
      "  return vec4f(0.0);",
      "}",
    ].join("\n"));

    expect(types.wave).toBe("f32");
    expect(types.mixed).toBe("vec2f");
    expect(types.clash).toBeUndefined();
  });

  it("propagates concrete types through type-preserving builtins", () => {
    const types = variableTypes([
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let wave = sin(coord.x * 6.0) + cos(coord.y * 8.0);",
      "  let sky = vec3f(0.5) + vec3f(0.5) * cos(coord.x);",
      "  let limited = clamp(sky, vec3f(0.0), vec3f(1.0));",
      "  let mixed = mix(vec2f(0.0), coord, 0.5);",
      "  let d = dot(coord, coord);",
      "  return vec4f(sky + wave, d);",
      "}",
    ].join("\n"));

    expect(types.wave).toBe("f32");
    expect(types.sky).toBe("vec3f");
    expect(types.limited).toBe("vec3f");
    expect(types.mixed).toBe("vec2f");
    expect(types.d).toBe("f32");
  });

  it("resolves struct constructors by their declared type name", () => {
    const types = variableTypes([
      "struct Light { dir: vec3f, energy: f32 }",
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let sun = Light(vec3f(0.0, 1.0, 0.0), 2.0);",
      "  return vec4f(sun.energy);",
      "}",
    ].join("\n"));

    expect(types.sun).toBe("Light");
  });

  it("resolves user function return types in initializers", () => {
    const types = variableTypes([
      "fn shade(p: vec2f) -> f32 {",
      "  return p.x;",
      "}",
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  let gain = shade(coord);",
      "  return vec4f(gain, 0.0, 0.0, 1.0);",
      "}",
    ].join("\n"));

    expect(types.gain).toBe("f32");
  });
});

describe('storage expression inference', () => {
  it.each(['array<f32>', 'array<f32, 4>'])('infers an element of %s', type => {
    expect(variableTypes(`var<storage, read> values: ${type};\nfn read() { let shade = values[0]; }`).shade).toBe('f32');
  });
  it('resolves aliases and fields after indexing storage structs', () => {
    const types = variableTypes('struct Particle { tint: vec3f, }\nalias Particles = array<Particle>;\nvar<storage, read> particles: Particles;\nfn read() { let shade = particles[0].tint.x; let absent = particles[0].missing; }');
    expect(types.shade).toBe('f32');
    expect(types.absent).toBeUndefined();
  });
  it('handles nested arrays and local shadowing without guessing unknown types', () => {
    const types = variableTypes('var<storage, read> values: array<array<f32,2>,4>;\nfn read() { let nested = values[0][1]; { let values = vec3u(1); let local = values[0]; } let unknown = absent[0]; }');
    expect(types.nested).toBe('f32');
    expect(types.local).toBe('u32');
    expect(types.unknown).toBeUndefined();
  });
  it('terminates on cyclic aliases', () => {
    const types = variableTypes('alias A = B; alias B = A; var<private> a: A; fn read() { let value = a[0]; }');
    expect(types.value).toBeUndefined();
  });
});
