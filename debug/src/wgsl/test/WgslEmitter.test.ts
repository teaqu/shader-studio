import { describe, expect, it } from "vitest";
import { emitWgslFloat4, emitWgslStatic } from "../WgslEmitter";

describe("WGSL debug emission", () => {
  it("converts every supported capture type to vec4f with valid WGSL", () => {
    expect(emitWgslFloat4("f32", "value")).toBe("vec4f(f32(value), f32(value), f32(value), 1.0)");
    expect(emitWgslFloat4("vec2f", "value")).toBe("vec4f(value, 0.0, 1.0)");
    expect(emitWgslFloat4("vec3f", "value")).toBe("vec4f(value, 1.0)");
    expect(emitWgslFloat4("vec4f", "value")).toBe("value");
    expect(emitWgslFloat4("vec2<f32>", "value")).toBe("vec4f(value, 0.0, 1.0)");
    expect(emitWgslFloat4("i32", "value")).toBe("vec4f(f32(value), f32(value), f32(value), 1.0)");
    expect(emitWgslFloat4("u32", "value")).toBe("vec4f(f32(value), f32(value), f32(value), 1.0)");
    expect(emitWgslFloat4("vec2i", "value")).toBe("vec4f(vec2f(value), 0.0, 1.0)");
    expect(emitWgslFloat4("vec3u", "value")).toBe("vec4f(vec3f(value), 1.0)");
    expect(emitWgslFloat4("f16", "value")).toBe("vec4f(f32(value), f32(value), f32(value), 1.0)");
  });

  it("emits booleans with select because WGSL has no ternary or bool conversion", () => {
    expect(emitWgslFloat4("bool", "value")).toBe(
      "select(vec4f(0.0, 0.0, 0.0, 1.0), vec4f(1.0, 1.0, 1.0, 1.0), value)",
    );
  });

  it("emits module-private capture storage for supported types only", () => {
    expect(emitWgslStatic("vec3f", "_ssdbg_value")).toBe("var<private> _ssdbg_value: vec3f;");
    expect(() => emitWgslFloat4("mat3x3f", "value")).toThrow("Unsupported WGSL debug capture type");
    expect(() => emitWgslStatic("mat4x4<f32>", "value")).toThrow("Unsupported WGSL debug capture type");
    expect(() => emitWgslFloat4("mat2x2h", "value")).toThrow("Unsupported WGSL debug capture type");
  });

  it.each(["mat2x2f", "mat2x2<f32>", "mat2x2< f32 >"])("packs %s columns into RGBA in Slang float2x2 order", (typeName) => {
    // Column-major: column 0 fills R/G and column 1 fills B/A, so the four
    // constructor arguments read back in authored order, like float2x2.
    expect(emitWgslFloat4(typeName, "value")).toBe("vec4f(value[0][0], value[0][1], value[1][0], value[1][1])");
    expect(emitWgslStatic(typeName, "_ssdbg_value")).toBe(`var<private> _ssdbg_value: ${typeName};`);
  });
});
