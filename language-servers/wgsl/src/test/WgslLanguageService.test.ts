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
  it("advertises no diagnostics: the renderer compiler always wins for WGSL", async () => {
    const capabilities = await new WgslLanguageService().initialize();

    expect(capabilities.diagnostics).toBe(false);
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
    expect(user?.signatures.map((signature) => signature.label)).toContain("shade(vec3f) -> vec3f");

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

  it("reports unused-local hints but no errors: the compiler owns errors", async () => {
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
    expect(diagnostics.every((diagnostic) => diagnostic.severity !== DiagnosticSeverity.Error)).toBe(true);
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
