import { describe, expect, it } from "vitest";
import { emitSlangFloat4, emitSlangStatic } from "../SlangEmitter";

describe("Slang debug emission", () => {
  it("converts every supported capture type to float4 without a GLSL dialect", () => {
    expect(emitSlangFloat4("float", "value")).toBe("float4(value, value, value, 1.0)");
    expect(emitSlangFloat4("float2", "value")).toBe("float4(value, 0.0, 1.0)");
    expect(emitSlangFloat4("float3", "value")).toBe("float4(value, 1.0)");
    expect(emitSlangFloat4("float4", "value")).toBe("value");
    expect(emitSlangFloat4("int", "value")).toBe("float4(float(value), float(value), float(value), 1.0)");
    expect(emitSlangFloat4("bool", "value")).toBe("float4(value ? 1.0 : 0.0, value ? 1.0 : 0.0, value ? 1.0 : 0.0, 1.0)");
    expect(emitSlangFloat4("float2x2", "value")).toBe("float4(value[0][0], value[0][1], value[1][0], value[1][1])");
  });

  it("emits module-local static capture storage for supported types only", () => {
    expect(emitSlangStatic("float3", "_ssdbg_value")).toBe("static float3 _ssdbg_value;");
    expect(() => emitSlangFloat4("half", "value")).toThrow("Unsupported Slang debug capture type");
    expect(() => emitSlangStatic("half", "value")).toThrow("Unsupported Slang debug capture type");
  });
});
