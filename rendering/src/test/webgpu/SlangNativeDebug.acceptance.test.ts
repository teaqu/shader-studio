import { beforeAll, describe, expect, it } from "vitest";
import SlangModuleFactory from "../../../../ui/src/slang/slang-wasm.js";
import { SlangDebugEngine } from "../../../../debug/src";
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
    if (!plan.ok) {
      return;
    }
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
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0].message);
    }
    const plan = engine.planCapture({
      workspace: { rootUri: "/main.slang", rootPath: "/main.slang", passName: "Image", contentHash: "a1b2c3d4", files: [{ uri: "/main.slang", path: "/main.slang", source, version: 1, moduleName: "", ownerPass: "Image" }] },
      sourceUri: "/main.slang", position: { line: 1, character: 2 },
    }, [analysis.analysis.previewValueId!]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const root = plan.plan.files.find((file) => file.uri === plan.plan.rootUri)!;

    expect(compiler.compileImagePass(root.source, { passName: "Image", sourcePath: root.path, captureMode: true })).toMatchObject({ success: true });
  });

  it("captures the default Slang shader return path before it exits", () => {
    const source = [
      "float4 mainImage(float2 fragCoord)",
      "{",
      "  float2 uv = fragCoord / iResolution.xy;",
      "  float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));",
      "  return float4(col, 1.0);",
      "}",
      "",
    ].join("\n");
    const workspace = { rootUri: "/default.slang", rootPath: "/default.slang", passName: "Image", contentHash: "default1234", files: [{ uri: "/default.slang", path: "/default.slang", source, version: 1, moduleName: "", ownerPass: "Image" }] };
    const engine = new SlangDebugEngine();
    const request = { workspace, sourceUri: "/default.slang", position: { line: 4, character: 10 } };
    const analysis = engine.analyze(request);
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0].message);
    }
    const col = analysis.analysis.visibleValues.find((value) => value.name === "col");
    if (!col) {
      throw new Error("Expected col to be visible at the return statement");
    }
    const plan = engine.planCapture(request, [col.id]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const root = plan.plan.files.find((file) => file.uri === plan.plan.rootUri)!;

    expect(root.source.indexOf("_ssdbg_defa1234_executed = true;")).toBeLessThan(root.source.indexOf("return float4(col, 1.0);"));
    expect(compiler.compileImagePass(root.source, { passName: "Image", sourcePath: root.path, captureMode: true })).toMatchObject({ success: true });
  });

  it("previews the default Slang shader return value with real Slang WASM", () => {
    const source = "float4 mainImage(float2 fragCoord) {\n  float3 col = float3(fragCoord, 0.5);\n  return float4(col, 1.0);\n}\n";
    const workspace = { rootUri: "/default-preview.slang", rootPath: "/default-preview.slang", passName: "Image", contentHash: "cafe1234", files: [{ uri: "/default-preview.slang", path: "/default-preview.slang", source, version: 1, moduleName: "", ownerPass: "Image" }] };
    const request = { workspace, sourceUri: "/default-preview.slang", position: { line: 2, character: 2 } };
    const plan = new SlangDebugEngine().planPreview(request, { normalizeMode: "off", stepEdge: null });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const root = plan.plan.files.find((file) => file.uri === plan.plan.rootUri)!;

    expect(root.source.indexOf("_ssdbg_cafe1234_executed = true;")).toBeLessThan(root.source.indexOf("return float4(col, 1.0);"));
    expect(compiler.compileImagePass(root.source, { passName: "Image", sourcePath: root.path })).toMatchObject({ success: true });
  });

  it("declines native compute variable inspection without compiling a fragment replay", () => {
    const source = [
      "[shader(\"compute\")]",
      "[numthreads(8, 8, 1)]",
      "void update(uint3 id : SV_DispatchThreadID)",
      "{",
      "  float value = float(id.x);",
      "}",
      "",
    ].join("\n");
    const workspace = { rootUri: "/compute.slang", rootPath: "/compute.slang", passName: "ComputeUpdate", contentHash: "compute1234", files: [{ uri: "/compute.slang", path: "/compute.slang", source, version: 1, moduleName: "", ownerPass: "ComputeUpdate" }] };
    const request = { workspace, sourceUri: "/compute.slang", position: { line: 4, character: 8 } };
    const engine = new SlangDebugEngine();
    const plan = engine.planPreview(request, { normalizeMode: "off", stepEdge: null });
    expect(plan).toMatchObject({
      ok: false,
      diagnostics: [{ message: "Compute variable inspection is not available yet. Your shader will continue running normally." }],
    });
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
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0].message);
    }
    const plan = engine.planCapture(request, [analysis.analysis.previewValueId!]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const main = plan.plan.files.find((file) => file.uri === "file:///main.slang")!;
    const modules = plan.plan.files.filter((file) => file.uri !== main.uri).map((file) => ({ moduleName: file.moduleName, path: file.path, source: file.source }));

    const result = compiler.compileImagePass(main.source, {
      passName: "Image",
      sourcePath: main.path,
      captureMode: true,
      modules,
    });
    expect(result.success, result.success ? "" : result.errors.join("\n")).toBe(true);
  });
});
