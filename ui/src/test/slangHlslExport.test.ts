import { describe, expect, it, vi } from "vitest";
import {
  exportSlangImageToHlsl,
  hlslExportPath,
} from "../lib/slangHlslExport";

describe("Slang HLSL export", () => {
  it.each([
    ["/project/image.slang", "/project/image.hlsl"],
    ["C:\\project\\shader.SLANG", "C:\\project\\shader.hlsl"],
    ["shader", "shader.hlsl"],
    ["", "shader.hlsl"],
  ])("uses an HLSL save path for %s", (source, expected) => {
    expect(hlslExportPath(source)).toBe(expected);
  });

  it("saves UTF-8 HLSL through the existing base64 file transport", async () => {
    const code = "// π\nfloat4 fragmentMain() : SV_Target { return 1; }";
    const compileImageTarget = vi.fn(async () => ({
      success: true as const,
      target: "HLSL" as const,
      code,
      diagnostics: [],
    }));
    const saveFile = vi.fn();
    const reportError = vi.fn();

    await expect(exportSlangImageToHlsl({
      engine: { compileImageTarget },
      path: "/project/image.slang",
      saveFile,
      reportError,
    })).resolves.toBe(true);

    expect(compileImageTarget).toHaveBeenCalledWith("HLSL");
    expect(saveFile).toHaveBeenCalledWith({
      data: expect.any(String),
      defaultName: "/project/image.hlsl",
      filters: { "HLSL files": ["hlsl"] },
    });
    const payload = saveFile.mock.calls[0][0];
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(payload.data), (character) => character.charCodeAt(0)),
    );
    expect(decoded).toBe(code);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports compiler errors and does not open a save dialog", async () => {
    const saveFile = vi.fn();
    const reportError = vi.fn();

    await expect(exportSlangImageToHlsl({
      engine: {
        compileImageTarget: vi.fn(async () => ({
          success: false as const,
          errors: ["Image: syntax error", "Image: unknown identifier"],
          diagnostics: [],
        })),
      },
      path: "/project/image.slang",
      saveFile,
      reportError,
    })).resolves.toBe(false);

    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenNthCalledWith(1, "Image: syntax error");
    expect(reportError).toHaveBeenNthCalledWith(2, "Image: unknown identifier");
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("reports unavailable target compilation without opening a save dialog", async () => {
    const saveFile = vi.fn();
    const reportError = vi.fn();

    await expect(exportSlangImageToHlsl({
      engine: {},
      path: "/project/image.slang",
      saveFile,
      reportError,
    })).resolves.toBe(false);

    expect(reportError).toHaveBeenCalledWith(
      "HLSL export is unavailable for the current shader",
    );
    expect(saveFile).not.toHaveBeenCalled();
  });
});
