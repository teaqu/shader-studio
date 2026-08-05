import { beforeAll, describe, expect, it } from "vitest";
import SlangModuleFactory from "../../../../ui/src/slang/slang-wasm.js";
import { SlangDebugEngine } from "../../../../slang-debug/src";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

describe("native Slang debug acceptance", () => {
  let compiler: SlangCompiler;

  beforeAll(async () => {
    const slang = await SlangModuleFactory({ locateFile: () => new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url).pathname.replace(/^\/@fs/, "") }) as SlangModuleApi;
    compiler = new SlangCompiler(slang);
  });

  it("compiles a generated root preview workspace with real Slang WASM", () => {
    const source = "float4 mainImage(float2 fragCoord) {\n  float value = fragCoord.x;\n  return float4(value);\n}\n";
    const engine = new SlangDebugEngine();
    const plan = engine.planPreview({
      workspace: { rootUri: "/main.slang", rootPath: "/main.slang", passName: "Image", contentHash: "a1b2c3d4", files: [{ uri: "/main.slang", path: "/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" }] },
      sourceUri: "/main.slang", position: { line: 1, character: 2 },
    }, { normalizeMode: "off", stepEdge: null });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const root = plan.plan.files.find((file) => file.uri === plan.plan.rootUri)!;

    expect(compiler.compileImagePass(root.source, { passName: "Image", sourcePath: root.path })).toMatchObject({ success: true });
  });
});
