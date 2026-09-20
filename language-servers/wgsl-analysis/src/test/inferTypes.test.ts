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

  it("infers targeted template, integer, and matrix builtins without guessing invalid calls", () => {
    const types = variableTypes([
      "alias Mask = vec2u;",
      "alias Matrix = mat2x3f;",
      "fn shade(uv: vec2f, mask: Mask, matrix: Matrix) {",
      "  let bits = bitcast<vec2u>(uv);",
      "  let leading = countLeadingZeros(mask);",
      "  let trailing = countTrailingZeros(mask);",
      "  let ones = countOneBits(mask);",
      "  let reversed = reverseBits(mask);",
      "  let transposed = transpose(matrix);",
      "  let determinant = determinant(mat2x2h());",
      "  let badBitcast = bitcast<vec2u>();",
      "  let badTranspose = transpose(uv);",
      "}",
    ].join("\n"));

    expect(types.bits).toBe("vec2u");
    expect(types.leading).toBe("vec2u");
    expect(types.trailing).toBe("vec2u");
    expect(types.ones).toBe("vec2u");
    expect(types.reversed).toBe("vec2u");
    expect(types.transposed).toBe("mat3x2f");
    expect(types.determinant).toBe("f16");
    expect(types.badBitcast).toBeUndefined();
    expect(types.badTranspose).toBeUndefined();
  });

  it("preserves result shapes for comparisons, boolean negation, and scalar-matrix multiplication", () => {
    const types = variableTypes([
      "fn shade(uv: vec2f, mask: vec2<bool>, matrix: mat2x3f, halfMatrix: mat3x2h) {",
      "  let compared = uv < vec2f(0.5);",
      "  let scalarCompared = uv.x < 0.5;",
      "  let inverted = !mask;",
      "  let scaledRight = matrix * 0.5;",
      "  let scaledLeft = 2.0 * matrix;",
      "  let scaledHalf = halfMatrix * 0.5;",
      "  let incompatible = matrix * vec2f(1.0);",
      "  let mismatched = uv < vec3f(0.5);",
      "  let mixedInteger = vec2u(1u) + 1.0;",
      "}",
    ].join("\n"));

    expect(types.compared).toBe("vec2<bool>");
    expect(types.scalarCompared).toBe("bool");
    expect(types.inverted).toBe("vec2<bool>");
    expect(types.scaledRight).toBe("mat2x3f");
    expect(types.scaledLeft).toBe("mat2x3f");
    expect(types.scaledHalf).toBe("mat3x2h");
    expect(types.incompatible).toBeUndefined();
    expect(types.mismatched).toBeUndefined();
    expect(types.mixedInteger).toBeUndefined();
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
  it.each([['mat2x2f', 'vec2f'], ['mat2x2<f32>', 'vec2f'], ['mat3x2h', 'vec2h']])('infers %s constructors, storage elements, and column indexing', (matrix, column) => {
    const types = variableTypes(`var<storage, read> bases: array<${matrix}>;\nfn read() { let local = ${matrix}(); let stored = bases[0]; let picked = stored[1]; }`);
    expect(types.local).toBe(matrix);
    expect(types.stored).toBe(matrix);
    expect(types.picked).toBe(column);
  });
  it('keeps both closing brackets of a fused >> in nested template annotations', () => {
    const document = parseWgslDocument(URI, 'var<storage, read> tints: array<vec3<f32>>;\nfn read() { let tint = tints[0]; let shade = tint.x; }', 'fragment');
    expect(document.symbols.find(symbol => symbol.name === 'tints')?.typeName).toBe('array<vec3<f32>>');
    expect(document.diagnostics).toEqual([]);
    const types = variableTypes('var<storage, read> tints: array<vec3<f32>>;\nfn read() { let tint = tints[0]; let shade = tint.x; }');
    expect(types.tint).toBe('vec3<f32>');
    expect(types.shade).toBe('f32');
  });
  it('terminates on cyclic aliases', () => {
    const types = variableTypes('alias A = B; alias B = A; var<private> a: A; fn read() { let value = a[0]; }');
    expect(types.value).toBeUndefined();
  });
});

describe('inference gaps found by the language-service corpus sweep', () => {
  it('ends a statement at its last token rather than at a following comment', () => {
    const source = 'fn mainImage(coord: vec2f) -> vec4f {\n  let uv = coord / iResolution.xy; // trailing\n\n  // Background\n  let grid = abs(fract(uv * 10.0) - vec2f(0.5)) * 2.0;\n  return vec4f(grid, 0.0, 1.0);\n}';
    const document = parseWgslDocument(URI, source, 'fragment');
    const declaration = document.statements.find(statement => statement.kind === 'declaration');
    expect(declaration?.range).toEqual({ start: { line: 1, character: 2 }, end: { line: 1, character: 34 } });
    const types = variableTypes(source);
    expect(types.uv).toBe('vec2f');
    expect(types.grid).toBe('vec2f');
  });

  it('treats alias and parameterized spellings of one type as equal operands', () => {
    const types = variableTypes('fn mainImage(coord: vec2<f32>) -> vec4<f32> {\n  let uv = coord / iResolution.xy;\n  let lifted = max(vec3<f32>(uv, 0.0), vec3f(0.5));\n  return vec4f(uv, lifted.x, 1.0);\n}');
    expect(types.uv).toBe('vec2<f32>');
    expect(types.lifted).toBe('vec3<f32>');
  });

  it('infers dereferenced pointers and select', () => {
    const types = variableTypes('fn hook(position: ptr<function, vec3<f32>>, flag: bool) {\n  var pos = *position;\n  let chosen = select(vec2f(0.0), vec2f(1.0), flag);\n  let address = &pos;\n}');
    expect(types.pos).toBe('vec3<f32>');
    expect(types.chosen).toBe('vec2f');
    expect(types.address).toBeUndefined();
  });

  it('consults an external context for environment values and functions without guessing generic results', () => {
    const source = 'fn update(i: u32) {\n  let body = bodies[i];\n  let previous = iChannel0Sample(vec2f(0.5));\n  let generic = mystery(1.0);\n  let unknown = absent;\n}';
    const document = parseWgslDocument(URI, source, 'compute', {
      valueType: name => name === 'bodies' ? 'array<Body>' : undefined,
      functionType: name => name === 'iChannel0Sample' ? 'vec4f' : name === 'mystery' ? 'T' : undefined,
    });
    const types = Object.fromEntries(document.symbols.map(symbol => [symbol.name, symbol.typeName]));
    expect(types.body).toBe('Body');
    expect(types.previous).toBe('vec4f');
    expect(types.generic).toBeUndefined();
    expect(types.unknown).toBeUndefined();
  });

  it('asks the context for fields of structs declared outside the document', () => {
    const source = 'fn update(i: u32) {\n  let pos2d = bodies[i].position.xy * 0.5 + 0.5;\n  let missing = bodies[i].absent;\n}';
    const document = parseWgslDocument(URI, source, 'compute', {
      valueType: name => name === 'bodies' ? 'array<Body>' : undefined,
      fieldType: (owner, field) => owner === 'Body' && field === 'position' ? 'vec4f' : undefined,
    });
    const types = Object.fromEntries(document.symbols.map(symbol => [symbol.name, symbol.typeName]));
    expect(types.pos2d).toBe('vec2f');
    expect(types.missing).toBeUndefined();
  });

  it("infers declarations in a for-loop initializer", () => {
    const document = parseWgslDocument(URI, [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  var total = 0.0;",
      "  for (var i = 0; i < 3; i++) {",
      "    total += f32(i);",
      "  }",
      "  for (var j = 0u; j < 2u; j++) { }",
      "  for (let k = coord.x; total < k; total += 1.0) { }",
      "  for (var typed: i32 = 0; typed < 1; typed++) { }",
      "  for (var unknown = mystery(); ; ) { break; }",
      "  return vec4f(total);",
      "}",
    ].join("\n"), "fragment");
    const types = Object.fromEntries(document.symbols.map(symbol => [symbol.name, symbol.typeName]));

    expect(types.i).toBe("i32");
    expect(types.j).toBe("u32");
    expect(types.k).toBe("f32");
    expect(types.typed).toBe("i32");
    expect(types.unknown).toBeUndefined();
  });

  it("does not add the for-loop initializer to the statement list", () => {
    const document = parseWgslDocument(URI, [
      "fn mainImage(coord: vec2f) -> vec4f {",
      "  for (var i = 0; i < 3; i++) { }",
      "  return vec4f(0.0);",
      "}",
    ].join("\n"), "fragment");

    expect(document.statements.map(statement => statement.kind)).toEqual(["for", "return"]);
  });
});
