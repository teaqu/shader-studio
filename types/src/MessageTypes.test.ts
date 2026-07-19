import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ShaderSourceMessage,
  SlangDiagnostic,
  SlangWorkspaceSnapshot,
} from "./index";

describe("ShaderSourceMessage Slang workspace contract", () => {
  it("keeps workspace and diagnostics optional for legacy clients", () => {
    const message: ShaderSourceMessage = {
      type: "shaderSource",
      code: "void main() {}",
      config: {},
      path: "/shader.glsl",
      buffers: {},
    };

    expect(message.workspace).toBeUndefined();
    expect(message.diagnostics).toBeUndefined();
  });

  it("exports reusable workspace and diagnostic types", () => {
    expectTypeOf<NonNullable<ShaderSourceMessage["workspace"]>>()
      .toEqualTypeOf<SlangWorkspaceSnapshot>();
    expectTypeOf<NonNullable<ShaderSourceMessage["diagnostics"]>[number]>()
      .toEqualTypeOf<SlangDiagnostic>();
  });
});
