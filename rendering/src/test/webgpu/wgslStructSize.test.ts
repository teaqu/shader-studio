import { describe, expect, it } from "vitest";
import { extractStructSizes } from "../../webgpu/wgslStructSize";

describe("extractStructSizes", () => {
  it("uses WGSL array stride, resolves nested structs, and honours explicit member layout", () => {
    const layouts = extractStructSizes(`
enable f16;
struct Child {
  value: vec3<f32>,
}
struct Particle {
  weight: f32,
  @align(16) offset: f32,
  @size(16) lifetime: f32,
  samples: array<Child, 2>,
  halfValue: f16,
}
`);

    expect(layouts.get("Child")).toMatchObject({ size: 16, alignment: 16 });
    // weight @0; offset @16; lifetime @20 (occupies 16); samples @48
    // (two Child values at array stride 16); halfValue @80; struct ends @96.
    expect(layouts.get("Particle")).toMatchObject({ size: 96, alignment: 16 });
  });

  it("uses a rounded-up stride for arrays of vectors", () => {
    const layouts = extractStructSizes(`
struct Samples {
  values: array<vec3<f32>, 2>,
  marker: f32,
}
`);

    // vec3<f32> has size 12 but an array stride of 16.
    expect(layouts.get("Samples")).toMatchObject({ size: 48, alignment: 16 });
  });

  it("recognises f16 scalar and vector storage layouts", () => {
    const layouts = extractStructSizes(`
enable f16;
struct HalfData {
  scalar: f16,
  pair: vec2<f16>,
  triple: vec3<f16>,
  quad: vec4<f16>,
}
`);

    expect(layouts.get("HalfData")).toMatchObject({ size: 24, alignment: 8 });
  });

  it("recognises signed and unsigned atomic storage layouts", () => {
    const layouts = extractStructSizes(`
struct Counters {
  before: u32,
  unsigned: atomic < u32 >,
  signed: atomic<i32>,
  values: array<atomic<u32>, 2>,
  after: f32,
}
`);

    expect(layouts.get("Counters")).toMatchObject({ size: 24, alignment: 4, containsAtomic: true });
  });

  it("rejects atomics with unsupported element types", () => {
    const layouts = extractStructSizes(`
struct InvalidAtomic {
  value: atomic<f32>,
}
`);

    expect(layouts.get("InvalidAtomic")).toBeUndefined();
  });

  it("handles indented and same-line structs, multiline attributes, and comments", () => {
    const layouts = extractStructSizes(`
// struct Ignored { broken: NotAType, }
  struct First { value: f32, } struct Formatted {
  @align(16)
  value: f32, // this comment must not become part of the type
  @size(16)
  padding: f32,
}
`);

    expect(layouts.get("Ignored")).toBeUndefined();
    expect(layouts.get("First")).toMatchObject({ size: 4, alignment: 4 });
    expect(layouts.get("Formatted")).toMatchObject({ size: 32, alignment: 16 });
  });
});
