import { describe, expect, it } from "vitest";
import { CompletionItemKind, DiagnosticSeverity, DocumentHighlightKind } from "vscode-languageserver-protocol";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { WgslLanguageService } from "../WgslLanguageService";

const uri = "file:///workspace/image.wgsl";
const source = `fn shade(x: vec3f) -> vec3f { return x * 2.0; }
fn mainImage(coord: vec2f) -> vec4f {
  return vec4f(shade(iTime * tint), 1.0);
}`;

function environment(): ShaderAuthoringEnvironment {
  return {
    documentUri: uri,
    languageId: "wgsl",
    generation: 1,
    passName: "Image",
    stage: "fragment",
    customUniforms: [{ name: "tint", type: "vec3" }],
    resources: [{ name: "sky", kind: "texture-cube" }],
    virtualFiles: [],
  };
}

async function service(): Promise<WgslLanguageService> {
  const instance = new WgslLanguageService();
  await instance.syncEnvironment(environment());
  await instance.openDocument({ uri, languageId: "wgsl", version: 1, text: source });
  return instance;
}

const revision = { uri, languageId: "wgsl" as const, version: 1, environmentGeneration: 1 };

describe("WgslLanguageService", () => {
  it("advertises lightweight diagnostics that the renderer compiler still overrides", async () => {
    const capabilities = await new WgslLanguageService().initialize();

    expect(capabilities.diagnostics).toBe(true);
    expect(capabilities.completion).toBe(true);
    expect(capabilities.hover).toBe(true);
    expect(capabilities.definition).toBe(true);
    expect(capabilities.signatureHelp).toBe(true);
    expect(capabilities.documentSymbols).toBe(true);
  });

  it("documents the mainImage contract by parameter role instead of parameter name", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `fn mainImage(pixelPosition: vec2f) -> vec4f {
  return vec4f(pixelPosition / iResolution.xy, 0.0, 1.0);
}`;
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });

    const hoverAt = (needle: string, occurrence = 0) => {
      let offset = -1;
      for (let index = 0; index <= occurrence; index++) {
        offset = text.indexOf(needle, offset + 1);
      }
      const prefix = text.slice(0, offset);
      const lines = prefix.split("\n");
      return instance.hover({
        document: revision,
        position: { line: lines.length - 1, character: (lines.at(-1)?.length ?? 0) + 1 },
      });
    };

    expect(JSON.stringify((await hoverAt("mainImage"))?.contents)).toContain("fn mainImage(pixelPosition: vec2f) -> vec4f");
    expect(JSON.stringify((await hoverAt("mainImage"))?.contents)).toContain("fragment entry point");
    expect(JSON.stringify((await hoverAt("pixelPosition"))?.contents)).toContain("pixelPosition: vec2f");
    expect(JSON.stringify((await hoverAt("pixelPosition"))?.contents)).toContain("lower-left");
  });

  it("documents the mainVertex contract on the vertex stage", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), stage: "vertex" });
    const text = `fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
}`;
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });

    const hover = await instance.hover({ document: revision, position: { line: 0, character: 5 } });
    expect(JSON.stringify(hover?.contents)).toContain("mainVertex");
    expect(JSON.stringify(hover?.contents)).toContain("vertex hook");
  });

  it("completes user symbols, intrinsics, builtins, uniforms, and resources", async () => {
    const labels = (await (await service()).completion({ document: revision, position: { line: 2, character: 10 } }))
      .map((item) => item.label);

    expect(labels).toEqual(expect.arrayContaining(["shade", "normalize", "textureSample", "iTime", "tint", "sky"]));
    expect(labels).not.toContain("iChannelN");
    expect(labels).not.toContain("texture2D");
  });

  it("offers subgroup builtins in compute shaders but not in fragment shaders", async () => {
    const text = `fn main() {
  let x = subgroupA;
}`;
    const compute = new WgslLanguageService();
    await compute.syncEnvironment({ ...environment(), stage: "compute" });
    await compute.openDocument({ uri, languageId: "wgsl", version: 1, text });
    const computeLabels = (await compute.completion({ document: revision, position: { line: 1, character: 19 } }))
      .map((item) => item.label);

    expect(computeLabels).toEqual(expect.arrayContaining(["subgroupAdd", "subgroupElect", "quadSwapX"]));

    const fragment = new WgslLanguageService();
    await fragment.syncEnvironment(environment());
    await fragment.openDocument({ uri, languageId: "wgsl", version: 1, text });
    const fragmentLabels = (await fragment.completion({ document: revision, position: { line: 1, character: 19 } }))
      .map((item) => item.label);

    expect(fragmentLabels).not.toContain("subgroupAdd");
    expect(fragmentLabels).not.toContain("quadSwapX");
  });

  it("offers shader-stage builtin values with documentation", async () => {
    const text = `fn main() {
  let x = global_invocation_id;
}`;
    const compute = new WgslLanguageService();
    await compute.syncEnvironment({ ...environment(), stage: "compute" });
    await compute.openDocument({ uri, languageId: "wgsl", version: 1, text });
    const labels = (await compute.completion({ document: revision, position: { line: 1, character: 12 } }))
      .map((item) => item.label);

    expect(labels).toEqual(expect.arrayContaining(["global_invocation_id", "workgroup_id", "subgroup_invocation_id"]));
    expect(labels).not.toContain("position");
    expect(labels).not.toContain("vertex_index");

    const hover = await compute.hover({ document: revision, position: { line: 1, character: 14 } });
    expect(JSON.stringify(hover?.contents)).toContain("vec3u");
  });

  it("completes swizzles after a member selector instead of every symbol", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `fn mainImage(coord: vec2f) -> vec4f {
  return vec4f(tint.);
}`;
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });
    const items = await instance.completion({ document: revision, position: { line: 1, character: 20 } });
    const labels = items.map((item) => item.label);

    expect(labels).toContain("xy");
    expect(labels).not.toContain("shade");
  });

  it("hovers user symbols, intrinsics, builtins, and uniforms", async () => {
    const instance = await service();

    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 0, character: 4 } }))?.contents))
      .toContain("shade(vec3f) -> vec3f");
    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 2, character: 24 } }))?.contents))
      .toContain("iTime");
    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 2, character: 32 } }))?.contents))
      .toContain("custom uniform");
  });

  it("spells builtin uniform types in WGSL", async () => {
    const instance = new WgslLanguageService();
    const text = `fn mainImage(coord: vec2f) -> vec4f {\n  return iResolution + iTime + iFrame;\n}`;
    await instance.syncEnvironment(environment());
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });
    const hoverAt = (line: number, character: number) =>
      instance.hover({ document: revision, position: { line, character } });

    expect(JSON.stringify((await hoverAt(1, 11))?.contents)).toContain("vec3f iResolution");
    expect(JSON.stringify((await hoverAt(1, 25))?.contents)).toContain("f32 iTime");
    expect(JSON.stringify((await hoverAt(1, 33))?.contents)).toContain("i32 iFrame");
  });

  it("resolves definitions across the common file", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      commonFile: { uri: "file:///workspace/common.wgsl", text: "fn helper() -> f32 { return 1.0; }", version: 1 },
    });
    const text = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(helper()); }";
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });

    const locations = await instance.definition({ document: revision, position: { line: 0, character: 52 } });
    expect(locations).toHaveLength(1);
    expect(locations[0]?.uri).toBe("file:///workspace/common.wgsl");
  });

  it("offers signature help for user functions and intrinsics", async () => {
    const instance = await service();

    const user = await instance.signatureHelp({ document: revision, position: { line: 2, character: 25 } });
    expect(user?.signatures.map((signature) => signature.label)).toContain("fn shade(x: vec3f) -> vec3f");

    const text = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(textureSample(a, b, c)); }";
    await instance.changeDocument({ uri, languageId: "wgsl", version: 2, text });
    const revision2 = { ...revision, version: 2 };
    const intrinsic = await instance.signatureHelp({ document: revision2, position: { line: 0, character: 68 } });
    expect(intrinsic?.signatures.length).toBeGreaterThan(0);
    expect(intrinsic?.signatures[0]?.label).toContain("textureSample");
  });

  it("lists document symbols for functions and types", async () => {
    const instance = await service();
    const symbols = await instance.documentSymbols({ document: revision });

    expect(symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["shade", "mainImage"]));
  });

  it("finds references and highlights without the declaration", async () => {
    const instance = await service();
    const references = await instance.references({
      document: revision,
      position: { line: 0, character: 4 },
      includeDeclaration: false,
    });

    expect(references).toHaveLength(1);
    const highlights = await instance.documentHighlights({ document: revision, position: { line: 0, character: 4 } });
    expect(highlights).toHaveLength(2);
  });

  it("renames user symbols but declines builtins", async () => {
    const instance = await service();
    const edit = await instance.rename({ document: revision, position: { line: 0, character: 4 }, newName: "tintShade" });

    expect(edit?.changes?.[uri]).toHaveLength(2);
    const declined = await instance.rename({ document: revision, position: { line: 2, character: 24 }, newName: "other" });
    expect(declined).toBeNull();
  });

  it("renames at the end boundary of local and Common identifiers", async () => {
    const instance = await service();
    expect(await instance.rename({ document: revision, position: { line: 0, character: 8 }, newName: "tintShade" }))
      .toMatchObject({ changes: { [uri]: expect.any(Array) } });
    expect(await instance.rename({ document: revision, position: { line: 2, character: 20 }, newName: "tintShade" }))
      .toMatchObject({ changes: { [uri]: expect.any(Array) } });
    expect(await instance.rename({ document: revision, position: { line: 2, character: 21 }, newName: "tintShade" })).toBeNull();
    expect(await instance.rename({ document: revision, position: { line: 99, character: 0 }, newName: "tintShade" })).toBeNull();

    const commonUri = "file:///workspace/common.wgsl";
    const common = "fn tone(value: f32) -> f32 { return value; }";
    const pass = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(tone(coord.x)); }";
    const commonInstance = new WgslLanguageService();
    await commonInstance.syncEnvironment({ ...environment(), commonFile: { uri: commonUri, version: 1, text: common } });
    await commonInstance.openDocument({ uri, languageId: "wgsl", version: 1, text: pass });
    await commonInstance.syncEnvironment({ ...environment(), documentUri: commonUri, passName: "common", virtualFiles: [] });
    await commonInstance.openDocument({ uri: commonUri, languageId: "wgsl", version: 1, text: common });
    expect(await commonInstance.rename({ document: { ...revision, uri: commonUri }, position: { line: 0, character: 7 }, newName: "curve" }))
      .toMatchObject({ changes: { [commonUri]: expect.any(Array), [uri]: expect.any(Array) } });
    expect(await commonInstance.rename({ document: revision, position: { line: 0, character: pass.indexOf("tone") + 4 }, newName: "curve" }))
      .toMatchObject({ changes: { [commonUri]: expect.any(Array), [uri]: expect.any(Array) } });
  });

  it("finds and renames a Common helper without touching a same-named local", async () => {
    const commonUri = "file:///workspace/common.wgsl";
    const text = `fn unrelated(coord: vec2f) -> f32 {
  let tone: f32 = coord.x;
  return tone;
}
fn mainImage(coord: vec2f) -> vec4f {
  let sharedTone: f32 = unrelated(coord);
  return vec4f(tone(coord.x) + sharedTone);
}`;
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      commonFile: { uri: commonUri, version: 1, text: "fn tone(value: f32) -> f32 { return value * 0.5; }" },
    });
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });

    const references = await instance.references({
      document: revision,
      position: { line: 6, character: 18 },
      includeDeclaration: true,
    });
    expect(references.map((reference) => reference.uri)).toEqual([commonUri, uri]);
    const edit = await instance.rename({
      document: revision,
      position: { line: 6, character: 18 },
      newName: "curve",
    });
    expect(edit?.changes?.[commonUri]).toHaveLength(1);
    expect(edit?.changes?.[uri]).toHaveLength(1);
    expect(edit?.changes?.[uri]?.[0]?.range.start.line).toBe(6);
  });

  it("renames a Common declaration across every open configured pass", async () => {
    const commonUri = "file:///workspace/common.wgsl";
    const bufferUri = "file:///workspace/buffer.wgsl";
    const common = "fn tone(value: f32) -> f32 { return value * 0.5; }";
    const pass = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(tone(coord.x)); }";
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), commonFile: { uri: commonUri, version: 1, text: common } });
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text: pass });
    await instance.syncEnvironment({ ...environment(), documentUri: bufferUri, commonFile: { uri: commonUri, version: 1, text: common } });
    await instance.openDocument({ uri: bufferUri, languageId: "wgsl", version: 1, text: pass });
    await instance.syncEnvironment({ ...environment(), documentUri: commonUri, passName: "common", virtualFiles: [] });
    await instance.openDocument({ uri: commonUri, languageId: "wgsl", version: 1, text: common });

    const commonRevision = { ...revision, uri: commonUri };
    const passReferences = await instance.references({ document: revision, position: { line: 0, character: pass.indexOf("tone") + 1 }, includeDeclaration: true });
    expect(passReferences.map((reference) => reference.uri).sort()).toEqual([bufferUri, commonUri, uri].sort());
    expect(await instance.documentHighlights({ document: revision, position: { line: 0, character: pass.indexOf("tone") + 1 } }))
      .toEqual([{ range: expect.objectContaining({ start: { line: 0, character: pass.indexOf("tone") } }), kind: DocumentHighlightKind.Read }]);
    const references = await instance.references({ document: commonRevision, position: { line: 0, character: 4 }, includeDeclaration: true });
    expect(references.map((reference) => reference.uri).sort()).toEqual([bufferUri, commonUri, uri].sort());
    const edit = await instance.rename({ document: commonRevision, position: { line: 0, character: 4 }, newName: "curve" });
    expect(edit?.changes?.[commonUri]).toHaveLength(1);
    expect(edit?.changes?.[uri]).toHaveLength(1);
    expect(edit?.changes?.[bufferUri]).toHaveLength(1);
  });

  it("renames a Common helper from one pass across its other open passes", async () => {
    const commonUri = "file:///workspace/common.wgsl";
    const bufferUri = "file:///workspace/buffer.wgsl";
    const common = "fn tone(value: f32) -> f32 { return value; }";
    const pass = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(tone(coord.x)); }";
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), commonFile: { uri: commonUri, version: 1, text: common } });
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text: pass });
    await instance.syncEnvironment({ ...environment(), documentUri: bufferUri, commonFile: { uri: commonUri, version: 1, text: common } });
    await instance.openDocument({ uri: bufferUri, languageId: "wgsl", version: 1, text: pass });
    const edit = await instance.rename({ document: revision, position: { line: 0, character: 52 }, newName: "curve" });
    expect(edit?.changes?.[commonUri]).toHaveLength(1);
    expect(edit?.changes?.[uri]).toHaveLength(1);
    expect(edit?.changes?.[bufferUri]).toHaveLength(1);
  });

  it("renames Common across unopened workspace passes and declines an affected collision", async () => {
    const commonUri = "file:///workspace/common.wgsl";
    const bufferUri = "file:///workspace/buffer.wgsl";
    const common = "fn tone(value: f32) -> f32 { return value; }";
    const pass = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(tone(coord.x)); }";
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), documentUri: commonUri, passName: "Common", virtualFiles: [], workspaceDocuments: [
      { uri: commonUri, version: 1, text: common, stage: "fragment" },
      { uri, version: 1, text: pass, stage: "fragment", commonUri },
      { uri: bufferUri, version: 1, text: pass, stage: "fragment", commonUri },
    ] });
    await instance.openDocument({ uri: commonUri, languageId: "wgsl", version: 1, text: common });

    const commonRevision = { ...revision, uri: commonUri };
    expect((await instance.references({ document: commonRevision, position: { line: 0, character: 4 }, includeDeclaration: true }))
      .map((reference) => reference.uri).sort()).toEqual([bufferUri, commonUri, uri].sort());
    expect((await instance.rename({ document: commonRevision, position: { line: 0, character: 4 }, newName: "curve" }))?.changes)
      .toMatchObject({ [commonUri]: expect.any(Array), [uri]: expect.any(Array), [bufferUri]: expect.any(Array) });

    const collision = "fn mainImage(coord: vec2f) -> vec4f { let curve: f32 = 0.0; return vec4f(tone(coord.x) + curve); }";
    await instance.syncEnvironment({ ...environment(), documentUri: commonUri, generation: 2, passName: "Common", virtualFiles: [], workspaceDocuments: [
      { uri: commonUri, version: 1, text: common, stage: "fragment" },
      { uri, version: 1, text: collision, stage: "fragment", commonUri },
    ] });
    expect(await instance.rename({ document: { ...commonRevision, environmentGeneration: 2 }, position: { line: 0, character: 4 }, newName: "curve" })).toBeNull();

    await instance.syncEnvironment({ ...environment(), documentUri: commonUri, generation: 3, passName: "Common", virtualFiles: [], workspaceDocuments: [
      { uri: commonUri, version: 1, text: common, stage: "fragment" },
      { uri, version: 2, text: "fn mainImage(coord: vec2f) -> vec4f { return vec4f(coord, 0.0, 1.0); }", stage: "fragment", commonUri },
    ] });
    expect((await instance.references({ document: { ...commonRevision, environmentGeneration: 3 }, position: { line: 0, character: 4 }, includeDeclaration: true }))
      .map((reference) => reference.uri)).toEqual([commonUri]);
  });

  it("declines a Common rename that collides at an affected pass call", async () => {
    const commonUri = "file:///workspace/common.wgsl";
    const common = "fn tone(value: f32) -> f32 { return value; }";
    const pass = "fn mainImage(coord: vec2f) -> vec4f { let curve: f32 = 0.0; return vec4f(tone(coord.x) + curve); }";
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), commonFile: { uri: commonUri, version: 1, text: common } });
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text: pass });
    await instance.syncEnvironment({ ...environment(), documentUri: commonUri, passName: "common", virtualFiles: [] });
    await instance.openDocument({ uri: commonUri, languageId: "wgsl", version: 1, text: common });
    expect(await instance.rename({ document: { ...revision, uri: commonUri }, position: { line: 0, character: 4 }, newName: "curve" })).toBeNull();
  });

  it("keeps unused-local hints beside undefined-identifier errors", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `fn mainImage(coord: vec2f) -> vec4f {
  var unusedLocal: f32 = 1.0;
  return vec4f(mysterious + 1.0);
}`;
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });

    const diagnostics = await instance.diagnostics({ document: revision });
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "unused-parameter",
        message: "Unused parameter 'coord'.",
        severity: DiagnosticSeverity.Hint,
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 18 } },
      }),
      expect.objectContaining({
        code: "unused-variable",
        message: "Unused variable 'unusedLocal'.",
        severity: DiagnosticSeverity.Hint,
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 17 } },
      }),
    ]));
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === DiagnosticSeverity.Error)).toEqual([
      expect.objectContaining({ code: "undefined-identifier", message: "Undefined identifier 'mysterious'.", source: "shader-studio-wgsl-ls" }),
    ]);
  });

  it("surfaces config validation as warnings", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      customUniforms: [{ name: "fn", type: "float" }],
    });
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text: source });

    const diagnostics = await instance.diagnostics({ document: revision });
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "reserved-identifier",
      severity: DiagnosticSeverity.Warning,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    }));
  });

  it("ignores documents from other languages", async () => {
    const instance = await service();

    expect(await instance.completion({ document: { ...revision, languageId: "glsl" }, position: { line: 0, character: 0 } }))
      .toEqual([]);
    expect(await instance.hover({ document: { ...revision, languageId: "glsl" }, position: { line: 0, character: 0 } }))
      .toBeNull();
  });

  it("offers struct fields after a member selector", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `struct Light { color: vec3f, power: f32, }
var<private> light: Light;
fn mainImage(coord: vec2f) -> vec4f { return vec4f(light.); }`;
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });

    const items = await instance.completion({ document: revision, position: { line: 2, character: 57 } });
    const fields = items.filter((item) => item.kind === CompletionItemKind.Field).map((item) => item.label);
    expect(fields).toEqual(expect.arrayContaining(["color", "power"]));
  });

  it("offers vector and struct members through transparent aliases", async () => {
    const instance = new WgslLanguageService();
    const text = `alias Tint = vec4f;
struct Light { color: vec3f, }
alias KeyLight = Light;
fn mainImage(coord: vec2f) -> vec4f {
  var tint: Tint;
  var key: KeyLight;
  tint.
  key.
  return vec4f(coord, 0.0, 1.0);
}`;
    await instance.syncEnvironment(environment());
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });
    expect((await instance.completion({ document: revision, position: { line: 6, character: 7 } })).map((item) => item.label)).toContain("xyzw");
    expect((await instance.completion({ document: revision, position: { line: 7, character: 6 } })).map((item) => item.label)).toContain("color");
  });

  describe("scoped symbols", () => {
    const scoped = `fn shade(level: f32) -> f32 {
  var amount: f32 = level;
  {
    let level: f32 = 0.5;
    amount = amount * level;
  }
  return amount * level;
}
fn mainImage(coord: vec2f) -> vec4f { return vec4f(shade(coord.x), 0.0, 0.0, 1.0); }`;

    async function openScoped(): Promise<WgslLanguageService> {
      const instance = new WgslLanguageService();
      await instance.syncEnvironment(environment());
      await instance.openDocument({ uri, languageId: "wgsl", version: 1, text: scoped });
      return instance;
    }

    /** Character just inside the nth `level` occurrence, so the cursor sits on the identifier. */
    function levelPosition(occurrence: number): { line: number; character: number } {
      let offset = -1;
      for (let index = 0; index <= occurrence; index++) {
        offset = scoped.indexOf("level", offset + 1);
      }
      const lines = scoped.slice(0, offset).split("\n");
      return { line: lines.length - 1, character: (lines.at(-1)?.length ?? 0) + 1 };
    }

    it("resolves the shadowed local without reaching the shadowing parameter", async () => {
      const instance = await openScoped();

      const inner = await instance.references({
        document: revision,
        position: levelPosition(3),
        includeDeclaration: true,
      });

      expect(inner.map((item) => item.range.start.line)).toEqual([3, 4]);
    });

    it("resolves the parameter from outside the shadowing block", async () => {
      const instance = await openScoped();

      const outer = await instance.references({
        document: revision,
        position: levelPosition(0),
        includeDeclaration: true,
      });

      expect(outer.map((item) => item.range.start.line)).toEqual([0, 1, 6]);
    });

    it("renames only the shadowed local, leaving the parameter untouched", async () => {
      const instance = await openScoped();

      const edit = await instance.rename({ document: revision, position: levelPosition(3), newName: "weight" });

      expect(edit?.changes?.[uri]?.map((change) => change.range.start.line)).toEqual([3, 4]);
    });

    it("ignores requests for a stale document revision", async () => {
      const instance = await openScoped();
      const stale = { ...revision, version: 99 };

      expect(await instance.references({ document: stale, position: levelPosition(0), includeDeclaration: true })).toEqual([]);
      expect(await instance.documentHighlights({ document: stale, position: levelPosition(0) })).toEqual([]);
      expect(await instance.rename({ document: stale, position: levelPosition(0), newName: "weight" })).toBeNull();
    });

    it("ignores requests for a stale environment generation", async () => {
      const instance = await openScoped();
      const stale = { ...revision, environmentGeneration: 99 };

      expect(await instance.references({ document: stale, position: levelPosition(0), includeDeclaration: true })).toEqual([]);
      expect(await instance.documentHighlights({ document: stale, position: levelPosition(0) })).toEqual([]);
      expect(await instance.rename({ document: stale, position: levelPosition(0), newName: "weight" })).toBeNull();
    });
  });
});

describe('WGSL named channel authoring', () => {
  it('completes channel metadata without exposing texture handles as fields', async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment(environment());
    const text = 'fn mainImage(c: vec2f) -> vec4f { sky. }';
    await instance.openDocument({ uri, languageId: 'wgsl', version: 1, text });
    const items = await instance.completion({ document: revision, position: { line: 0, character: text.indexOf('sky.') + 4 } });
    expect(items.map(item => item.label).sort()).toEqual(['loaded', 'size', 'time']);
  });
  it('offers native handles and shared helper signatures, but cannot rename generated globals', async () => {
    const instance = await service();
    const items = await instance.completion({ document: revision, position: { line: 1, character: 0 } });
    expect(items.map(item => item.label)).toEqual(expect.arrayContaining(['skyTexture', 'skySampler', 'sampleCubeLevel']));
    const text = 'fn mainImage(c: vec2f) -> vec4f { return sampleCubeLevel(skyTexture, skySampler, vec3f(0,0,1), 0); }';
    await instance.changeDocument({ uri, languageId: 'wgsl', version: 2, text });
    const current = { ...revision, version: 2 };
    const signature = await instance.signatureHelp({ document: current, position: { line: 0, character: text.indexOf('skyTexture') } });
    expect(signature?.signatures[0]?.label).toContain('texture_cube<f32>');
    const atTexture = { document: current, position: { line: 0, character: text.indexOf('skyTexture') + 1 } };
    expect(await instance.rename({ ...atTexture, newName: 'other' })).toBeNull();
    expect(await instance.definition(atTexture)).toEqual([]);
  });
  it('warns at an implicit compute sample call and does not warn about a shadowing authored function', async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), stage: 'compute' });
    const text = '@compute @workgroup_size(1) fn update() { let color = sampleCube(skyTexture, skySampler, vec3f(0,0,1)); }';
    await instance.openDocument({ uri, languageId: 'wgsl', version: 1, text });
    const diagnostics = await instance.diagnostics({ document: revision });
    const warning = diagnostics.find(item => item.code === 'sampling-requires-fragment');
    expect(warning?.range.start.character).toBe(text.indexOf('sampleCube'));
    expect(warning?.message).toContain('sampleCubeLevel');
    await instance.changeDocument({ uri, languageId: 'wgsl', version: 2, text: 'fn sampleCube() {} @compute @workgroup_size(1) fn update() { sampleCube(); }' });
    expect((await instance.diagnostics({ document: { ...revision, version: 2 } })).some(item => item.code === 'sampling-requires-fragment')).toBe(false);
  });
});

function positionOf(text: string, needle: string, delta = 0, occurrence = 0): { line: number; character: number } {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = text.indexOf(needle, offset + 1);
  }
  if (offset < 0) {
    throw new Error(`missing ${needle}`);
  }
  const lines = text.slice(0, offset + delta).split("\n");
  return { line: lines.length - 1, character: lines.at(-1)!.length };
}

async function open(text: string, overrides: Partial<ShaderAuthoringEnvironment> = {}): Promise<WgslLanguageService> {
  const instance = new WgslLanguageService();
  await instance.syncEnvironment({ ...environment(), ...overrides });
  await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });
  return instance;
}

const errorsOf = async (instance: WgslLanguageService, document = revision) =>
  (await instance.diagnostics({ document })).filter((item) => item.severity === DiagnosticSeverity.Error);

describe("WGSL language-service errors before renderer compilation", () => {
  it("reports undefined identifiers, functions, and types at their authored ranges", async () => {
    const text = `fn mainImage(coord: vec2f) -> vec4f {
  let a: Missing = coord.x;
  return vec4f(mysterious + missingFn(a));
}`;
    const errors = await errorsOf(await open(text));
    expect(errors).toEqual([
      { range: { start: positionOf(text, "Missing"), end: positionOf(text, "Missing", 7) }, severity: DiagnosticSeverity.Error, source: "shader-studio-wgsl-ls", code: "undefined-type", message: "Undefined type 'Missing'." },
      { range: { start: positionOf(text, "mysterious"), end: positionOf(text, "mysterious", 10) }, severity: DiagnosticSeverity.Error, source: "shader-studio-wgsl-ls", code: "undefined-identifier", message: "Undefined identifier 'mysterious'." },
      { range: { start: positionOf(text, "missingFn"), end: positionOf(text, "missingFn", 9) }, severity: DiagnosticSeverity.Error, source: "shader-studio-wgsl-ls", code: "undefined-function", message: "Undefined function 'missingFn'." },
    ]);
  });

  it("accepts Common, generated channel helpers, storage, uniforms, builtins, aliases, forward module declarations, and shadowing", async () => {
    const commonUri = "file:///workspace/common.wgsl";
    const text = `enable f16;
alias Tint = vec3f;
const COUNT = 4;
@group(0) @binding(9) var storageTarget: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(10) var video: texture_external;
@group(0) @binding(11) var shadowMap: texture_depth_2d;
@group(0) @binding(12) var shadowSampler: sampler_comparison;
fn mainImage(coord: vec2f) -> vec4f {
  let base: Tint = tint * iTime + vec3f(later(coord.x));
  var table = array<f32, COUNT>();
  let sampled = sampleCube(skyTexture, skySampler, vec3f(0.0, 0.0, 1.0));
  let loaded = skyLoaded() && sky.loaded;
  let particle = particles[0].x + f32(arrayLength(&particles));
  let tone = commonTone(base.x) + f32(bitcast<u32>(1i)) + textureSampleCompare(shadowMap, shadowSampler, coord, 0.5);
  let tint = select(0.0, 1.0, loaded);
  let pair = array(1.0, 2.0);
  let column = mat2x2(1.0, 0.0, 0.0, 1.0)[0] + vec2(tint);
  return vec4f(vec3f(tint * tone * particle) + sampled.rgb + table[0] + pair[1] + column.x + f32(iFrame) + iResolution.x, 1.0);
}
fn later(x: f32) -> f32 { return x * globalGain; }
var<private> globalGain: f32 = 0.5;`;
    const instance = await open(text, {
      commonFile: { uri: commonUri, version: 1, text: "fn commonTone(value: f32) -> f32 { return value; }" },
      resources: [{ name: "sky", kind: "texture-cube" }, { name: "particles", kind: "storage", elementType: "vec4f" }],
    });
    expect(await errorsOf(instance)).toEqual([]);
  });

  it("does not report an identifier from another function or a later local as declared", async () => {
    const text = `fn helper() -> f32 { let local = 1.0; return local; }
fn mainImage(coord: vec2f) -> vec4f {
  let early = late;
  let late = local;
  return vec4f(early + late);
}`;
    expect((await errorsOf(await open(text))).map((item) => item.message)).toEqual([
      "Undefined identifier 'late'.",
      "Undefined identifier 'local'.",
    ]);
  });

  it("reports only the first syntax error and withholds semantic errors until the parse recovers", async () => {
    const broken = `fn mainImage(coord: vec2f) -> vec4f {
  let partial = ;
  let other = ;
  return vec4f(missingValue);
}`;
    const instance = await open(broken);
    expect(await errorsOf(instance)).toEqual([
      expect.objectContaining({ code: "syntax", range: expect.objectContaining({ start: positionOf(broken, ";") }) }),
    ]);

    const corrected = broken.replace("let partial = ;", "let partial = 1.0;").replace("let other = ;", "let other = partial;");
    await instance.changeDocument({ uri, languageId: "wgsl", version: 2, text: corrected });
    expect((await errorsOf(instance, { ...revision, version: 2 })).map((item) => item.code)).toEqual(["undefined-identifier"]);

    await instance.changeDocument({ uri, languageId: "wgsl", version: 3, text: corrected.replace("missingValue", "other") });
    expect(await errorsOf(instance, { ...revision, version: 3 })).toEqual([]);
    expect(await instance.diagnostics({ document: { ...revision, version: 2 } })).toEqual([]);
  });

  it("analyses every incomplete prefix without hanging, escaping the document, or guessing semantic errors", async () => {
    const complete = `struct Light { color: vec3f, power: f32, }
fn shade(light: Light, uv: vec2f) -> vec3f {
  var total = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    total += light.color * light.power * f32(i) * uv.x;
  }
  switch i32(uv.y * 3.0) { case 0, 1 { total *= 0.5; } default { } }
  return total;
}
fn mainImage(coord: vec2f) -> vec4f {
  let light = Light(tint, 2.0);
  return vec4f(shade(light, coord / iResolution.xy), 1.0);
}
`;
    const instance = new WgslLanguageService();
    await instance.syncEnvironment(environment());
    await instance.openDocument({ uri, languageId: "wgsl", version: 1, text: "" });
    for (let length = 0; length <= complete.length; length++) {
      const text = complete.slice(0, length);
      await instance.changeDocument({ uri, languageId: "wgsl", version: length + 2, text });
      const diagnostics = await instance.diagnostics({ document: { ...revision, version: length + 2 } });
      const lines = text.split("\n");
      for (const diagnostic of diagnostics) {
        expect(diagnostic.range.end.line).toBeLessThan(lines.length);
        expect(diagnostic.range.end.character).toBeLessThanOrEqual(lines[diagnostic.range.end.line]!.length);
      }
      const errors = diagnostics.filter((item) => item.severity === DiagnosticSeverity.Error);
      const syntax = errors.filter((item) => item.code === "syntax");
      expect(syntax.length).toBeLessThanOrEqual(1);
      if (syntax.length > 0) {
        expect(errors).toEqual(syntax);
      }
      // Complete declarations never reference names that a prefix could still add.
      expect(errors.filter((item) => item.code !== "syntax").map((item) => item.message).join("\n")).not.toMatch(/'(?:shade|Light|light|total|tint|iResolution|coord|uv)'/);
    }
  });

  it("reports fragment-only builtins and discard reachable from compute and vertex entries", async () => {
    const compute = `fn blur(uv: vec2f) -> f32 { return dpdx(uv.x); }
fn unused() { discard; }
@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) {
  let v = blur(vec2f(id.xy));
  let c = textureSample(colorTexture, colorSampler, vec2f(v));
}
@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var colorSampler: sampler;`;
    const computeErrors = await errorsOf(await open(compute, { stage: "compute" }));
    expect(computeErrors).toEqual([
      expect.objectContaining({ code: "stage-unavailable-builtin", range: { start: positionOf(compute, "dpdx"), end: positionOf(compute, "dpdx", 4) }, message: "'dpdx' is only available in the fragment stage." }),
      expect.objectContaining({ code: "stage-unavailable-builtin", range: { start: positionOf(compute, "textureSample"), end: positionOf(compute, "textureSample", 13) }, message: "'textureSample' is only available in the fragment stage; use textureSampleLevel with an explicit level." }),
    ]);

    const vertex = `fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) {
  if (*uv).x > 2.0 { discard; }
  (*position).y += fwidth((*uv).x);
}`;
    expect((await errorsOf(await open(vertex, { stage: "vertex" }))).map((item) => [item.code, item.message])).toEqual([
      ["stage-unavailable-statement", "'discard' is only available in the fragment stage."],
      ["stage-unavailable-builtin", "'fwidth' is only available in the fragment stage."],
    ]);

    const fragment = "fn mainImage(c: vec2f) -> vec4f { workgroupBarrier(); return vec4f(dpdx(c.x)); }";
    expect((await errorsOf(await open(fragment))).map((item) => item.message)).toEqual([
      "'workgroupBarrier' is only available in the compute stage.",
    ]);
  });

  it("keeps the compute sampling warning instead of adding an undefined-function error", async () => {
    const text = "@compute @workgroup_size(1) fn update() { let color = sampleCube(skyTexture, skySampler, vec3f(0,0,1)); }";
    const diagnostics = await (await open(text, { stage: "compute" })).diagnostics({ document: revision });
    expect(diagnostics.filter((item) => item.range.start.character === text.indexOf("sampleCube")).map((item) => item.code))
      .toEqual(["sampling-requires-fragment"]);
  });

  it("reports WGSL reserved words used as declaration names, once per declaration", async () => {
    const text = `fn enum(value: f32) -> f32 { return value; }
fn mainImage(coord: vec2f) -> vec4f {
  let shared = enum(coord.x);
  return vec4f(shared);
}`;
    expect(await errorsOf(await open(text))).toEqual([
      { range: { start: positionOf(text, "enum"), end: positionOf(text, "enum", 4) }, severity: DiagnosticSeverity.Error, source: "shader-studio-wgsl-ls", code: "reserved-word", message: "'enum' is a reserved word in WGSL and cannot name a declaration." },
      { range: { start: positionOf(text, "shared"), end: positionOf(text, "shared", 6) }, severity: DiagnosticSeverity.Error, source: "shader-studio-wgsl-ls", code: "reserved-word", message: "'shared' is a reserved word in WGSL and cannot name a declaration." },
    ]);
    // Predeclared and generated names may be declared or shadowed.
    expect(await errorsOf(await open("fn mainImage(coord: vec2f) -> vec4f {\n  let vec3f = 1.0;\n  let iTime = 2.0;\n  return vec4f(vec3f + iTime);\n}"))).toEqual([]);
  });

  it("reports syntax but not pass-supplied names in a Common document", async () => {
    const commonUri = "file:///workspace/common.wgsl";
    const text = "fn blurred(uv: vec2f) -> vec4f { return iChannel0Sample(uv) + albedoTexture2(uv); }";
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), documentUri: commonUri, passName: "common", resources: [] });
    await instance.openDocument({ uri: commonUri, languageId: "wgsl", version: 1, text });
    const commonRevision = { ...revision, uri: commonUri };
    // Every pass that prepends Common supplies its own channel helpers.
    expect(await errorsOf(instance, commonRevision)).toEqual([]);
    await instance.changeDocument({ uri: commonUri, languageId: "wgsl", version: 2, text: text.replace("return", "return (") });
    expect((await errorsOf(instance, { ...commonRevision, version: 2 })).map((item) => item.code)).toEqual(["syntax"]);
  });

  it("returns nothing for stale revisions or documents without an environment", async () => {
    const instance = await open("fn mainImage(c: vec2f) -> vec4f { return vec4f(missing); }");
    expect(await instance.diagnostics({ document: { ...revision, version: 7 } })).toEqual([]);
    expect(await instance.diagnostics({ document: { ...revision, environmentGeneration: 7 } })).toEqual([]);
    const unsynced = new WgslLanguageService();
    await unsynced.openDocument({ uri, languageId: "wgsl", version: 1, text: "fn f() { missing(); }" });
    expect(await unsynced.diagnostics({ document: revision })).toEqual([]);
    expect(await unsynced.completion({ document: revision, position: { line: 0, character: 10 } })).toEqual([]);
    expect(await unsynced.signatureHelp({ document: revision, position: { line: 0, character: 17 } })).toBeNull();
    expect(await unsynced.documentColors({ document: revision })).toEqual([]);
  });
});

describe("WGSL color swatches", () => {
  const text = `const a = vec3f(1.0, 0.25, 0.0);
const b = vec4f(0.0, 0.5, 1.0, 1.0);
const c = vec3<f32>(0.2, 0.4, 0.6);
const d = vec4< f32 >( 1, .5,
  0.25, 0.75 );
const e = vec3 <f32> (0.1,0.2,0.3);
const skipped = array(vec3f(uv, 0.0), vec3<f32>(tint.x, 0.0, 1.0), vec3f(1.0, 0.0, 0.0, 1.0), vec4<f32>(1.0, 0.0, 0.0), vec3<i32>(1, 0, 0), vec3f(2.0, 0.0, 0.0));`;

  it("finds literal vec3/vec4 f32 constructors in every spelling and skips nonliteral or mismatched ones", async () => {
    const instance = await open(text);
    const colors = await instance.documentColors({ document: revision });
    const lines = text.split("\n");
    const covered = colors.map(({ range }) => range.start.line === range.end.line
      ? lines[range.start.line]!.slice(range.start.character, range.end.character)
      : `${lines[range.start.line]!.slice(range.start.character)}\n${lines[range.end.line]!.slice(0, range.end.character)}`);
    expect(covered).toEqual([
      "vec3f(1.0, 0.25, 0.0)",
      "vec4f(0.0, 0.5, 1.0, 1.0)",
      "vec3<f32>(0.2, 0.4, 0.6)",
      "vec4< f32 >( 1, .5,\n  0.25, 0.75 )",
      "vec3 <f32> (0.1,0.2,0.3)",
    ]);
    expect(colors[3]?.color).toEqual({ red: 1, green: 0.5, blue: 0.25, alpha: 0.75 });
  });

  it("edits a swatch without changing constructor spelling or component count", async () => {
    const instance = await open(text);
    const colors = await instance.documentColors({ document: revision });
    const edits = await Promise.all(colors.map(async (color) => (await instance.colorPresentations({
      document: revision,
      color: { red: 0, green: 0.5, blue: 1, alpha: 0.25 },
      range: color.range,
    }))[0]?.textEdit?.newText));
    expect(edits).toEqual([
      "vec3f(0.0, 0.5, 1.0)",
      "vec4f(0.0, 0.5, 1.0, 0.25)",
      "vec3<f32>(0.0, 0.5, 1.0)",
      "vec4< f32 >(0.0, 0.5, 1.0, 0.25)",
      "vec3 <f32> (0.0, 0.5, 1.0)",
    ]);
    expect(await instance.colorPresentations({ document: { ...revision, version: 2 }, color: { red: 0, green: 0, blue: 0, alpha: 1 }, range: colors[0]!.range })).toEqual([]);
  });

  it("offers no presentation for a range that is not a literal color constructor", async () => {
    const instance = await open(text);
    const nonliteral = { start: positionOf(text, "vec3f(uv"), end: positionOf(text, "vec3f(uv", "vec3f(uv, 0.0)".length) };
    expect(await instance.colorPresentations({ document: revision, color: { red: 0, green: 0, blue: 0, alpha: 1 }, range: nonliteral })).toEqual([]);
  });
});

describe("WGSL structured signature help", () => {
  const commonUri = "file:///workspace/common.wgsl";
  const commonText = "// Maps a value into display range.\nfn commonTone(value: f32, curve: f32) -> f32 { return pow(value, curve); }";
  const helpers = `// Scales a colour by gain.
fn shade(color: vec3f, gain: f32) -> vec3f { return color * gain; }
fn length(v: vec2f) -> f32 { return v.x; }
`;

  async function help(body: string, needle: string, delta: number, overrides: Partial<ShaderAuthoringEnvironment> = {}) {
    const text = `${helpers}fn mainImage(coord: vec2f) -> vec4f {\n  ${body}\n}`;
    const instance = await open(text, { commonFile: { uri: commonUri, version: 1, text: commonText }, ...overrides });
    return instance.signatureHelp({ document: revision, position: positionOf(text, needle, delta) });
  }

  const parameterLabels = (result: Awaited<ReturnType<typeof help>>, signature = result?.activeSignature ?? 0) => {
    const information = result?.signatures[signature];
    return information?.parameters?.map((parameter) => Array.isArray(parameter.label)
      ? information.label.slice(parameter.label[0], parameter.label[1])
      : parameter.label);
  };

  it("describes user functions with named parameters and leading comments", async () => {
    const result = await help("let c = shade(vec3f(1.0), 0.5);", "0.5", 0);
    expect(result).toMatchObject({ activeSignature: 0, activeParameter: 1, signatures: [{ label: "fn shade(color: vec3f, gain: f32) -> vec3f" }] });
    expect(parameterLabels(result)).toEqual(["color: vec3f", "gain: f32"]);
    expect(JSON.stringify(result?.signatures[0]?.documentation)).toContain("Scales a colour by gain.");
  });

  it("describes Common, generated channel, and builtin functions", async () => {
    const common = await help("let t = commonTone(coord.x, 2.0);", "2.0", 0);
    expect(common?.signatures[0]?.label).toBe("fn commonTone(value: f32, curve: f32) -> f32");
    expect(JSON.stringify(common?.signatures[0]?.documentation)).toMatch(/Maps a value into display range\.[\s\S]*Shader Studio Common/);

    const generated = await help("let s = sampleCubeLevel(skyTexture, skySampler, vec3f(0.0), 0.0);", "vec3f(0.0)", 0);
    expect(generated?.activeParameter).toBe(2);
    expect(parameterLabels(generated)?.[0]).toContain("texture_cube<f32>");
    expect(JSON.stringify(generated?.signatures[0]?.documentation)).toContain("Generated by Shader Studio");

    const builtin = await help("let m = smoothstep(0.0, 1.0, coord.x);", "coord.x", 0);
    expect(builtin?.signatures[0]).toMatchObject({ label: "fn smoothstep(low: T, high: T, x: T) -> T" });
    expect(parameterLabels(builtin)).toEqual(["low: T", "high: T", "x: T"]);
    expect(JSON.stringify(builtin?.signatures[0]?.documentation)).toContain("Hermite");
  });

  it("selects the first overload with enough parameters for the active argument", async () => {
    const result = await help("let s = textureSample(a, b, c, 2u);", "2u", 0);
    expect(result?.activeParameter).toBe(3);
    expect(result?.signatures[result.activeSignature ?? 0]?.label).toContain("texture_2d_array");
  });

  it("tracks the active parameter through nested calls, templates, and comments", async () => {
    expect((await help("let c = shade(vec3f(max(1.0, 2.0), 0.0, 0.0), 0.5);", "0.5", 0))?.activeParameter).toBe(1);
    const inner = await help("let c = shade(vec3f(max(1.0, 2.0), 0.0, 0.0), 0.5);", "2.0", 0);
    expect(inner?.signatures[0]?.label).toContain("max");
    expect(inner?.activeParameter).toBe(1);
    expect((await help("let c = shade(array<f32, 3>(1.0, 2.0, 3.0)[0], 0.5);", "0.5", 0))?.activeParameter).toBe(1);
    expect((await help("let c = shade(vec3<f32>(1.0, 2.0, 3.0), 0.5);", "0.5", 0))?.activeParameter).toBe(1);
    expect((await help("let c = shade(vec3f(1.0), /* a, b, ( */ 0.5);", "0.5", 0))?.activeParameter).toBe(1);
    const bitcast = await help("let b = bitcast<u32>(1i);", "1i", 0);
    expect(bitcast?.signatures[0]?.label).toContain("bitcast");
    expect(bitcast?.activeParameter).toBe(0);
  });

  it("lets a user function shadow a builtin of the same name", async () => {
    const result = await help("let l = length(coord);", "coord);", 0);
    expect(result?.signatures.map((signature) => signature.label)).toEqual(["fn length(v: vec2f) -> f32"]);
  });

  it("offers nothing for constructors or inside comments, and still helps in an unfinished call", async () => {
    expect(await help("let v = vec3<f32>(1.0, 2.0, 3.0);", "2.0", 0)).toBeNull();
    expect(await help("// shade(vec3f(1.0),", "1.0),", 5)).toBeNull();
    expect(await help("/* shade(vec3f(1.0), */", "1.0),", 5)).toBeNull();
    const unfinished = await help("let c = shade(coord.xyx, ", "coord.xyx, ", 11);
    expect(unfinished).toMatchObject({ activeParameter: 1, signatures: [{ label: "fn shade(color: vec3f, gain: f32) -> vec3f" }] });
  });
});

describe("WGSL completion recovery", () => {
  it("does not complete inside line or block comments", async () => {
    const text = "// iTi\n/* iTi */\nfn mainImage(c: vec2f) -> vec4f { return vec4f(iTi); }";
    const instance = await open(text);
    expect(await instance.completion({ document: revision, position: { line: 0, character: 6 } })).toEqual([]);
    expect(await instance.completion({ document: revision, position: { line: 1, character: 6 } })).toEqual([]);
    expect((await instance.completion({ document: revision, position: positionOf(text, "iTi);", 3) })).map((item) => item.label)).toContain("iTime");
  });

  it("offers parameters and preceding locals while the statement is unfinished, but not later or out-of-scope locals", async () => {
    const text = `fn shade(x: f32) -> f32 { return x; }
fn mainImage(coord: vec2f) -> vec4f {
  { let inner = 1.0; }
  let glow = 1.0;
  let partial = gl
  let after = 2.0;
  return vec4f(glow);
}`;
    const items = await (await open(text)).completion({ document: revision, position: positionOf(text, "= gl", 4) });
    const labels = items.map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["glow", "coord", "shade", "iTime", "tint", "normalize"]));
    expect(labels).not.toContain("inner");
    expect(labels).not.toContain("after");
    expect(items.find((item) => item.label === "glow")?.detail).toBe("f32");
  });

  it("shows the innermost declaration when a local shadows a uniform or builtin", async () => {
    const text = "fn mainImage(coord: vec2f) -> vec4f {\n  let tint = 0.5;\n  let iTime = 2i;\n  return vec4f(ti);\n}";
    const items = await (await open(text)).completion({ document: revision, position: positionOf(text, "ti);", 2) });
    expect(items.filter((item) => item.label === "tint").map((item) => item.detail)).toEqual(["f32"]);
    expect(items.filter((item) => item.label === "iTime").map((item) => item.detail)).toEqual(["i32"]);
  });

  it("recovers after a correction and ignores the stale broken revision", async () => {
    const broken = "fn mainImage(coord: vec2f) -> vec4f {\n  let glow = 1.0\n  let later = gl\n}";
    const instance = await open(broken);
    const fixed = "fn mainImage(coord: vec2f) -> vec4f {\n  let glow = 1.0;\n  let later = gl;\n  return vec4f(later);\n}";
    await instance.changeDocument({ uri, languageId: "wgsl", version: 2, text: fixed });
    expect(await instance.completion({ document: revision, position: positionOf(broken, "= gl", 4) })).toEqual([]);
    const labels = (await instance.completion({ document: { ...revision, version: 2 }, position: positionOf(fixed, "= gl", 4) })).map((item) => item.label);
    expect(labels).toContain("glow");
    expect(await instance.signatureHelp({ document: revision, position: { line: 0, character: 13 } })).toBeNull();
  });
});

describe("WGSL member typing and hover gaps found by the corpus sweep", () => {
  const labelsAt = async (instance: WgslLanguageService, text: string, needle: string) =>
    (await instance.completion({ document: revision, position: positionOf(text, needle, needle.length) })).map((item) => item.label);
  const hoverAt = async (instance: WgslLanguageService, text: string, needle: string, delta = 0, occurrence = 0) => {
    const hover = await instance.hover({ document: revision, position: positionOf(text, needle, delta, occurrence) });
    return hover ? JSON.stringify(hover.contents) : null;
  };

  /** Completion after `member.` in a body holding only that one unfinished statement. */
  const membersOf = async (prefix: string, access: string, overrides: Partial<ShaderAuthoringEnvironment>, signature = "@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u)") => {
    const text = `struct Body { position: vec4f, velocity: vec4f, }\n${signature} {\n${prefix}  ${access}\n}`;
    return labelsAt(await open(text, overrides), text, access);
  };

  it("types configured storage buffers for member completion, directly and through locals", async () => {
    const storage: Partial<ShaderAuthoringEnvironment> = { stage: "compute", resources: [
      { name: "bodies", kind: "storage", elementType: "Body" },
      { name: "seed", kind: "storage", elementType: "vec4<f32>" },
    ] };
    expect(await membersOf("", "bodies[id.x].", storage)).toEqual(expect.arrayContaining(["position", "velocity"]));
    expect(await membersOf("", "seed[0].", storage)).toEqual(expect.arrayContaining(["xy", "rgb"]));
    expect(await membersOf("  var current = bodies[id.x];\n", "current.", storage)).toEqual(expect.arrayContaining(["position", "velocity"]));
    expect(await membersOf("  let state = select(seed[1], seed[0], id.x > 2u);\n", "state.", storage)).toEqual(expect.arrayContaining(["xy", "x"]));
    expect(await membersOf("", "bodies[id.x].", { stage: "compute" })).toEqual([]);
  });

  it("types locals from storage structs declared in Common", async () => {
    const common = { uri: "file:///workspace/common.wgsl", version: 1, text: "struct Particle { position: vec4f, velocity: vec4f, }" };
    const storage: Partial<ShaderAuthoringEnvironment> = { stage: "compute", commonFile: common, resources: [{ name: "particles", kind: "storage", elementType: "Particle" }] };
    const signature = "@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u)";
    const text = `${signature} {\n  let pos2d = particles[id.x].position.xy * 0.5 + 0.5;\n  pos2d.\n}`;
    expect(await labelsAt(await open(text, storage), text, "pos2d.")).toEqual(expect.arrayContaining(["x", "xy"]));
  });

  it("completes members through pointer dereferences", async () => {
    const hook = "fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2<f32>>)";
    expect(await membersOf("", "(*uv).", { stage: "vertex" }, hook)).toEqual(expect.arrayContaining(["x", "y", "xy"]));
    expect(await membersOf("  var pos = *position;\n", "pos.", { stage: "vertex" }, hook)).toEqual(expect.arrayContaining(["x", "xyz"]));
    expect(await membersOf("", "(*normal).xy.", { stage: "vertex" }, hook)).toEqual(expect.arrayContaining(["x", "y"]));
  });

  it("types locals from generated helpers, concrete builtins, and mixed vector spellings", async () => {
    const text = `fn mainImage(coord: vec2<f32>) -> vec4<f32> {
  let uv = coord / iResolution.xy;
  let previous = iChannel0Sample(uv);
  let tex = textureSampleLevel(iChannel0Texture, iChannel0Sampler, uv, 0.0);
  let packed = unpack2x16float(1u);
  uv.
  previous.
  tex.
  packed.
  return previous;
}`;
    const instance = await open(text, { resources: [{ name: "iChannel0", kind: "texture-2d" }] });
    expect(await labelsAt(instance, text, "  uv.")).toEqual(expect.arrayContaining(["x", "xy"]));
    expect(await labelsAt(instance, text, "previous.")).toEqual(expect.arrayContaining(["rgb", "xyzw"]));
    expect(await labelsAt(instance, text, "tex.")).toEqual(expect.arrayContaining(["rgba"]));
    expect(await labelsAt(instance, text, "packed.")).toEqual(expect.arrayContaining(["xy"]));
  });

  it("completes modf and frexp result fields", async () => {
    const text = "fn mainImage(coord: vec2f) -> vec4f {\n  let a = modf(coord.x).\n  let b = frexp(coord).\n  return vec4f(0.0);\n}";
    const instance = await open(text);
    expect((await labelsAt(instance, text, "modf(coord.x).")).sort()).toEqual(["fract", "whole"]);
    expect((await labelsAt(instance, text, "frexp(coord).")).sort()).toEqual(["exp", "fract"]);
  });

  it("hovers the compute output helper", async () => {
    const text = "@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) { writeOutput(id.xy, vec4f(1.0)); }";
    expect(await hoverAt(await open(text, { stage: "compute" }), text, "writeOutput"))
      .toContain("fn writeOutput(coord: vec2u, color: vec4f)");
    expect(await hoverAt(await open(text, { stage: "compute", outputLayers: 3 }), text, "writeOutput"))
      .toContain("fn writeOutput(coord: vec2u, layer: u32, color: vec4f)");
  });

  it("does not hover an authored symbol for an attribute of the same name", async () => {
    const text = "@compute @workgroup_size(1) fn compute(@builtin(global_invocation_id) id: vec3u) {}";
    const instance = await open(text, { stage: "compute" });
    expect(await hoverAt(instance, text, "compute", 1)).toBeNull();
    expect(await hoverAt(instance, text, "compute", 1, 1)).toContain("compute(vec3u)");
    expect(await hoverAt(instance, text, "global_invocation_id", 1)).toContain("Global workgroup-grid coordinates");
  });

  it("hovers members by their owner's type rather than a same-named symbol", async () => {
    const text = `struct Light { color: vec3f, }
fn mainImage(coord: vec2f) -> vec4f {
  let light = Light(vec3f(1.0));
  let color = 0.5;
  let uv = coord.xy;
  return vec4f(light.color * color, unknownThing.color);
}`;
    const instance = await open(text);
    const field = await hoverAt(instance, text, "light.color", "light.".length + 1);
    expect(field).toContain("vec3f color");
    expect(field).toContain("Field of `Light`");
    expect(await hoverAt(instance, text, "coord.xy", "coord.".length + 1)).toContain("vec2f xy");
    expect(await hoverAt(instance, text, "unknownThing.color", "unknownThing.".length + 1)).toBeNull();
  });
});

describe("WGSL stage diagnostics through Common helpers", () => {
  const commonUri = "file:///workspace/common.wgsl";
  const commonText = `@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var colorSampler: sampler;
fn edge(v: f32) -> f32 { return dpdx(v); }
fn blur(v: f32) -> f32 { return edge(v) * 0.5; }
fn cycleA(v: f32) -> f32 { return cycleB(v); }
fn cycleB(v: f32) -> f32 { return cycleA(dpdy(v)); }
fn unusedFragmentOnly(uv: vec2f) -> vec4f { return textureSample(colorTexture, colorSampler, uv); }
fn safe(v: f32) -> f32 { return v; }
fn stop() { discard; }
fn sync() { workgroupBarrier(); }
fn fwidth(v: f32) -> f32 { return v; }`;
  const withCommon = (stage: ShaderAuthoringEnvironment["stage"]): Partial<ShaderAuthoringEnvironment> => ({
    stage, commonFile: { uri: commonUri, version: 1, text: commonText },
  });

  it("reports fragment-only builtins a compute entry reaches in Common, at the pass call site with the Common chain", async () => {
    const text = `@compute @workgroup_size(1) fn update(@builtin(global_invocation_id) id: vec3u) {
  let a = blur(1.0);
  let b = helper(2.0);
  let c = safe(3.0) + fwidth(4.0);
}
fn helper(v: f32) -> f32 { return cycleA(v); }`;
    const errors = await errorsOf(await open(text, withCommon("compute")));
    expect(errors.map((item) => ({ code: item.code, message: item.message, range: item.range }))).toEqual([
      {
        code: "stage-unavailable-builtin",
        message: "'dpdx' is only available in the fragment stage; reached through Common: blur → edge (common.wgsl line 3).",
        range: { start: positionOf(text, "blur"), end: positionOf(text, "blur", 4) },
      },
      {
        code: "stage-unavailable-builtin",
        message: "'dpdy' is only available in the fragment stage; reached through Common: cycleA → cycleB (common.wgsl line 6).",
        range: { start: positionOf(text, "cycleA"), end: positionOf(text, "cycleA", 6) },
      },
    ]);
  });

  it("accepts the same Common helpers from a fragment pass and ignores helpers no entry calls", async () => {
    const text = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(blur(coord.x) + cycleA(coord.y)); }";
    expect(await errorsOf(await open(text, withCommon("fragment")))).toEqual([]);
    const compute = "@compute @workgroup_size(1) fn update() { let s = safe(1.0); }";
    expect(await errorsOf(await open(compute, withCommon("compute")))).toEqual([]);
  });

  it("reports discard from a vertex hook and compute-only builtins from a fragment entry through Common", async () => {
    const vertex = "fn mainVertex(position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>) { stop(); }";
    expect((await errorsOf(await open(vertex, withCommon("vertex")))).map((item) => [item.code, item.message])).toEqual([
      ["stage-unavailable-statement", "'discard' is only available in the fragment stage; reached through Common: stop (common.wgsl line 9)."],
    ]);
    const fragment = "fn mainImage(coord: vec2f) -> vec4f { sync(); return vec4f(0.0); }";
    expect((await errorsOf(await open(fragment, withCommon("fragment")))).map((item) => item.message)).toEqual([
      "'workgroupBarrier' is only available in the compute stage; reached through Common: sync (common.wgsl line 10).",
    ]);
  });

  it("does not report stage errors inside the Common document itself", async () => {
    const instance = new WgslLanguageService();
    await instance.syncEnvironment({ ...environment(), documentUri: commonUri, passName: "common", resources: [] });
    await instance.openDocument({ uri: commonUri, languageId: "wgsl", version: 1, text: commonText });
    expect(await errorsOf(instance, { ...revision, uri: commonUri })).toEqual([]);
  });
});
