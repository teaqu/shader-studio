import { describe, expect, it, vi } from "vitest";
import { SlangDebugCompiler } from "../../webgpu/SlangDebugCompiler";

describe("SlangDebugCompiler", () => {
  it("keeps the edited root as root and passes edited dependencies as modules", async () => {
    const compileImagePass = vi.fn(() => ({ success: true as const, wgsl: "wgsl" }));
    const compiler = new SlangDebugCompiler({ compileImagePass } as never);
    const result = await compiler.compile({
      workspaceHash: "hash", rootUri: "file:///work/main.slang", selectedSourceUri: "file:///work/helper.slang", executionMarkerSlot: 0, captureSlots: [],
      files: [
        { uri: "file:///work/helper.slang", path: "/work/helper.slang", source: "module helper;", version: 2, moduleName: "helper", ownerPass: "Image" },
        { uri: "file:///work/main.slang", path: "/work/main.slang", source: "import helper; float4 mainImage(float2 c) { return 1; }", version: 3, moduleName: "", ownerPass: "Image" },
      ],
    });

    expect(result).toEqual({ success: true, wgsl: "wgsl", selectedSourceUri: "file:///work/helper.slang" });
    expect(compileImagePass).toHaveBeenCalledWith("import helper; float4 mainImage(float2 c) { return 1; }", {
      passName: "Image", sourcePath: "/work/main.slang", modules: [{ moduleName: "helper", path: "/work/helper.slang", source: "module helper;" }],
    });
  });
});
