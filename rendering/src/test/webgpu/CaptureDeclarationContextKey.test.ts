import { describe, expect, it } from "vitest";
import { captureDeclarationContextKey } from "../../webgpu/CaptureDeclarationContextKey";

const base = {
  nativeRender: {
    geometry: "cube" as const,
    width: 16,
    height: 16,
  },
};

describe("captureDeclarationContextKey", () => {
  it("invalidates procedural capture for changes in topology and coordinate space", () => {
    const original = { nativeRender: { geometry: "vertices" as const, width: 16, height: 16 } };
    const key = captureDeclarationContextKey(original);
    expect(captureDeclarationContextKey({ nativeRender: { ...original.nativeRender, topology: "point-list" } })).not.toBe(key);
    expect(captureDeclarationContextKey({ nativeRender: { ...original.nativeRender, vertexSpace: "clip" } })).not.toBe(key);
  });
  it("treats the default viewer camera as enabled and invalidates for the disabled depth rule", () => {
    const implicit = captureDeclarationContextKey(base);
    const enabled = captureDeclarationContextKey({ nativeRender: { ...base.nativeRender, useViewerCamera: true } });
    const disabled = captureDeclarationContextKey({ nativeRender: { ...base.nativeRender, useViewerCamera: false } });

    expect(implicit).toBe(enabled);
    expect(disabled).not.toBe(enabled);
  });
});
