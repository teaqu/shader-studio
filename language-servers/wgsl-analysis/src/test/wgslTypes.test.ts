import { describe, expect, it } from "vitest";
import {
  isBuiltinValueType,
  isWgslSamplerType,
  isWgslTextureType,
  matrixType,
  parseWgslArrayType,
  parseWgslAtomicType,
  parseWgslPointerType,
  resolveSwizzleType,
  vectorType,
  vectorTypeName,
} from "../wgslTypes";

describe("wgslTypes", () => {
  it("recognizes scalar types", () => {
    for (const name of ["bool", "i32", "u32", "f32", "f16"]) {
      expect(isBuiltinValueType(name)).toBe(true);
    }
    expect(isBuiltinValueType("float")).toBe(false);
    expect(isBuiltinValueType("int")).toBe(false);
  });

  it("parses vector types in alias and parameterized form", () => {
    expect(vectorType("vec4f")).toEqual({ componentType: "f32", size: 4 });
    expect(vectorType("vec2h")).toEqual({ componentType: "f16", size: 2 });
    expect(vectorType("vec3i")).toEqual({ componentType: "i32", size: 3 });
    expect(vectorType("vec2u")).toEqual({ componentType: "u32", size: 2 });
    expect(vectorType("vec3<f32>")).toEqual({ componentType: "f32", size: 3 });
    expect(vectorType("vec2<bool>")).toBeUndefined();
    expect(vectorType("vec4f ")).toBeUndefined();
    expect(vectorType("vec5f")).toBeUndefined();
  });

  it("names canonical vector types", () => {
    expect(vectorTypeName("f32", 4)).toBe("vec4f");
    expect(vectorTypeName("i32", 2)).toBe("vec2i");
    expect(vectorTypeName("bool", 3)).toBeUndefined();
  });

  it("parses matrix types in alias and parameterized form", () => {
    expect(matrixType("mat4x4f")).toEqual({ componentType: "f32", columns: 4, rows: 4 });
    expect(matrixType("mat2x3h")).toEqual({ componentType: "f16", columns: 2, rows: 3 });
    expect(matrixType("mat3x2<f32>")).toEqual({ componentType: "f32", columns: 3, rows: 2 });
    expect(matrixType("mat4x4<i32>")).toBeUndefined();
    expect(matrixType("mat5x5f")).toBeUndefined();
  });

  it("recognizes texture and sampler types", () => {
    for (const name of [
      "texture_1d<f32>",
      "texture_2d<f32>",
      "texture_2d_array<f32>",
      "texture_3d<f32>",
      "texture_cube<f32>",
      "texture_cube_array<f32>",
      "texture_multisampled_2d<f32>",
      "texture_depth_2d",
      "texture_depth_cube",
      "texture_external",
      "texture_storage_2d<rgba8unorm, write>",
      "texture_storage_2d_array<rgba16float, read_write>",
    ]) {
      expect(isWgslTextureType(name)).toBe(true);
    }
    expect(isWgslTextureType("texture_2d")).toBe(false);
    expect(isWgslTextureType("sampler")).toBe(false);
    expect(isWgslSamplerType("sampler")).toBe(true);
    expect(isWgslSamplerType("sampler_comparison")).toBe(true);
    expect(isWgslSamplerType("texture_2d<f32>")).toBe(false);
  });

  it("parses atomic, array, and pointer types", () => {
    expect(parseWgslAtomicType("atomic<u32>")).toBe("u32");
    expect(parseWgslAtomicType("atomic<i32>")).toBe("i32");
    expect(parseWgslAtomicType("atomic<f32>")).toBeUndefined();
    expect(parseWgslArrayType("array<f32, 4>")).toEqual({ elementType: "f32", elementCount: 4 });
    expect(parseWgslArrayType("array<vec4f>")).toEqual({ elementType: "vec4f", elementCount: undefined });
    expect(parseWgslArrayType("array<>")).toBeUndefined();
    expect(parseWgslPointerType("ptr<function, f32>")).toEqual({ addressSpace: "function", elementType: "f32" });
    expect(parseWgslPointerType("ptr<storage, vec4f, read_write>")).toEqual({
      addressSpace: "storage",
      elementType: "vec4f",
      accessMode: "read_write",
    });
    expect(parseWgslPointerType("ptr<f32>")).toBeUndefined();
  });

  it("resolves swizzle selections", () => {
    expect(resolveSwizzleType("vec3f", "xy")).toBe("vec2f");
    expect(resolveSwizzleType("vec4h", "w")).toBe("f16");
    expect(resolveSwizzleType("vec2<f32>", "yx")).toBe("vec2f");
    expect(resolveSwizzleType("vec3f", "rgba")).toBeUndefined();
    expect(resolveSwizzleType("vec2f", "z")).toBeUndefined();
    expect(resolveSwizzleType("f32", "x")).toBeUndefined();
  });

  it("treats every closed type family as a builtin value type", () => {
    for (const name of [
      "vec4f", "vec2<f32>", "mat4x4f", "mat3x2<f32>",
      "sampler", "texture_depth_2d", "texture_external", "texture_storage_2d<rgba8unorm, write>",
      "atomic<u32>", "array<f32, 4>", "ptr<function, f32>",
    ]) {
      expect(isBuiltinValueType(name)).toBe(true);
    }
    expect(isBuiltinValueType("MyStruct")).toBe(false);
    expect(isBuiltinValueType("array<f32>")).toBe(true);
  });
});
