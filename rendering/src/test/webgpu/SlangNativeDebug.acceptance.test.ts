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

  it("compiles a generated root capture workspace with the capture prelude", () => {
    const source = "float4 mainImage(float2 fragCoord) {\n  float value = fragCoord.x;\n  return float4(value);\n}\n";
    const engine = new SlangDebugEngine();
    const analysis = engine.analyze({
      workspace: { rootUri: "/main.slang", rootPath: "/main.slang", passName: "Image", contentHash: "a1b2c3d4", files: [{ uri: "/main.slang", path: "/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" }] },
      sourceUri: "/main.slang", position: { line: 1, character: 2 },
    });
    if (!analysis.ok) throw new Error(analysis.diagnostics[0].message);
    const plan = engine.planCapture({
      workspace: { rootUri: "/main.slang", rootPath: "/main.slang", passName: "Image", contentHash: "a1b2c3d4", files: [{ uri: "/main.slang", path: "/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" }] },
      sourceUri: "/main.slang", position: { line: 1, character: 2 },
    }, [analysis.analysis.previewValueId!]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const root = plan.plan.files.find((file) => file.uri === plan.plan.rootUri)!;

    expect(compiler.compileImagePass(root.source, { passName: "Image", sourcePath: root.path, captureMode: true })).toMatchObject({ success: true });
  });

  it("compiles a capture selected in an imported Slang module", () => {
    const root = "import helper;\nfloat4 mainImage(float2 fragCoord) { return float4(helperValue(fragCoord.x)); }\n";
    const helper = "module helper;\npublic float helperValue(float input) {\n  float value = input;\n  return value;\n}\n";
    const workspace = { rootUri: "/main.slang", rootPath: "/main.slang", passName: "Image", contentHash: "b1b2c3d4", files: [
      { uri: "/main.slang", path: "/main.slang", source: root, version: 1, moduleName: "", ownerPass: "Image" },
      { uri: "/helper.slang", path: "/helper.slang", source: helper, version: 1, moduleName: "helper", ownerPass: "Image" },
    ] };
    const engine = new SlangDebugEngine();
    const request = { workspace, sourceUri: "/helper.slang", position: { line: 2, character: 2 } };
    const analysis = engine.analyze(request);
    if (!analysis.ok) throw new Error(analysis.diagnostics[0].message);
    const plan = engine.planCapture(request, [analysis.analysis.previewValueId!]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const main = plan.plan.files.find((file) => file.uri === "file:///main.slang")!;
    const modules = plan.plan.files.filter((file) => file.uri !== main.uri).map((file) => ({ moduleName: file.moduleName, path: file.path, source: file.source }));

    expect(compiler.compileImagePass(main.source, { passName: "Image", sourcePath: main.path, captureMode: true, modules })).toMatchObject({ success: true });
  });
});
