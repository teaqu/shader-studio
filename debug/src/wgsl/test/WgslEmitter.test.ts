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
    expect(() => emitWgslFloat4("mat2x2f", "value")).toThrow("Unsupported WGSL debug capture type");
    expect(() => emitWgslStatic("mat2x2f", "value")).toThrow("Unsupported WGSL debug capture type");
  });
});
