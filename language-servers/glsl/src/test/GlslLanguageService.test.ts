import { describe, expect, it } from "vitest";
import { CompletionItemKind, DocumentHighlightKind } from "vscode-languageserver-protocol";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { GlslLanguageService } from "../GlslLanguageService";

const uri = "file:///workspace/image.glsl";
const source = `float shade(float x) { return x * 2.0; }
void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(shade(tint.x), iResolution.xy, 1.0);
}`;

function environment(): ShaderAuthoringEnvironment {
  return {
    documentUri: uri,
    languageId: "glsl",
    generation: 1,
    passName: "Image",
    stage: "fragment",
    customUniforms: [{ name: "tint", type: "vec3" }],
    resources: [{ name: "sky", kind: "texture-cube" }],
    virtualFiles: [],
  };
}

async function service(): Promise<GlslLanguageService> {
  const service = new GlslLanguageService();
  await service.syncEnvironment(environment());
  await service.openDocument({ uri, languageId: "glsl", version: 1, text: source });
  return service;
}

const revision = { uri, languageId: "glsl" as const, version: 1, environmentGeneration: 1 };

describe("GlslLanguageService", () => {
  it("documents the mainImage contract by parameter role instead of parameter name", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `void mainImage(out vec4 rendered, in vec2 pixelPosition) {
  rendered = vec4(pixelPosition / iResolution.xy, 0.0, 1.0);
}`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    const hoverAt = async (needle: string, occurrence = 0) => {
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

    expect(JSON.stringify((await hoverAt("mainImage"))?.contents)).toContain("void mainImage(out vec4 rendered, in vec2 pixelPosition)");
    expect(JSON.stringify((await hoverAt("mainImage"))?.contents)).toContain("fragment entry point");
    expect(JSON.stringify((await hoverAt("rendered"))?.contents)).toContain("out vec4 rendered");
    expect(JSON.stringify((await hoverAt("rendered"))?.contents)).toContain("RGBA output");
    expect(JSON.stringify((await hoverAt("rendered", 1))?.contents)).toContain("RGBA output");
    expect(JSON.stringify((await hoverAt("pixelPosition"))?.contents)).toContain("lower-left");
    expect(JSON.stringify((await hoverAt("pixelPosition", 1))?.contents)).toContain("Pixel-space");
  });

  it("completes standard, Shader Studio, custom uniform, and resource symbols", async () => {
    const labels = (await (await service()).completion({ document: revision, position: { line: 2, character: 10 } }))
      .map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["normalize", "texture", "iResolution", "tint", "sky", "shade"]));
    expect(labels).not.toContain("texture2D");
    expect(labels).not.toContain("iChannelN");
    expect(labels).not.toContain("mainVertex");
  });

  it("offers generated metadata aliases for configured higher GLSL channel slots", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      resources: [{ name: "iChannel5", kind: "texture-2d", slot: 5 }],
    });
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text: source });

    const labels = (await instance.completion({ document: revision, position: { line: 2, character: 0 } })).map((item) => item.label);
    expect(labels).toContain("iCh5");
    expect(labels).not.toContain("iChannelN");
  });

  it("completes vector components instead of every symbol after a member selector", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  uv.
  color = vec4(uv, 0.0, 1.0);
}`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    const items = await instance.completion({ document: revision, position: { line: 2, character: 5 } });

    expect(items.map((item) => item.label)).toEqual(["x", "y", "xy", "r", "g", "rg", "s", "t", "st"]);
    expect(items).toContainEqual(expect.objectContaining({ label: "x", detail: "float", kind: CompletionItemKind.Field }));
    expect(items).toContainEqual(expect.objectContaining({ label: "xy", detail: "vec2" }));
  });

  it("completes generated channel metadata members from the GLSL authoring preamble", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      resources: [{ name: "sky", kind: "texture-cube", slot: 0 }],
    });
    const text = `void mainImage(out vec4 color, in vec2 coord) {
  iCh0.
  iCh0.sampler.
  iCh0.size.
  color = vec4(0.0);
}`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
    const labels = async (line: number) => (await instance.completion({
      document: revision,
      position: { line, character: (text.split("\n")[line] ?? "").length },
    })).map((item) => item.label);

    expect(await labels(1)).toEqual(expect.arrayContaining(["sampler", "size", "time", "loaded"]));
    expect(await labels(2)).toEqual([]);
    expect(await labels(3)).toContain("xyz");
  });

  it("completes struct fields declared in the document and in Shader Studio Common", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      passName: "BufferA",
      commonFile: {
        uri: "file:///workspace/common.glsl",
        version: 1,
        text: "struct Light { vec3 color; float power; };\nLight keyLight;",
      },
    });
    const text = `struct Material { vec3 albedo; float rough; };
void mainImage(out vec4 color, in vec2 coord) {
  Material m;
  m.
  keyLight.
  color = vec4(m.albedo, 1.0);
}`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    const fields = await instance.completion({ document: revision, position: { line: 3, character: 4 } });
    expect(fields).toEqual([
      expect.objectContaining({ label: "albedo", detail: "vec3", kind: CompletionItemKind.Field }),
      expect.objectContaining({ label: "rough", detail: "float" }),
    ]);

    const shared = await instance.completion({ document: revision, position: { line: 4, character: 11 } });
    expect(shared.map((item) => item.label)).toEqual(["color", "power"]);
  });

  it("completes members of built-in uniforms, custom uniforms, and intrinsic results", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord / iResolution.
  vec3 shade = tint.
  vec4 sampled = texture(sky, uv).
  color = vec4(uv, 0.0, 1.0);
}`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
    const labels = async (line: number) => (await instance.completion({
      document: revision,
      position: { line, character: (text.split("\n")[line] ?? "").length },
    })).map((item) => item.label);

    expect(await labels(1)).toContain("xyz");
    expect(await labels(1)).not.toContain("xyzw");
    expect(await labels(2)).toContain("rgb");
    expect(await labels(3)).toContain("xyzw");
  });

  it("offers no suggestions when the selected expression has no members", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord;
  float t = uv.x;
  missing.
  t.
  sky.
  iChannel0.
  color = vec4(uv, t, 1.0);
}`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
    const completions = async (line: number) => instance.completion({
      document: revision,
      position: { line, character: (text.split("\n")[line] ?? "").length },
    });

    expect(await completions(3)).toEqual([]);
    expect(await completions(4)).toEqual([]);
    expect(await completions(5)).toEqual([]);
    expect(await completions(6)).toEqual([]);
  });

  it("retains legacy texture names for explicitly versioned GLSL ES 1.00 documents", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    await instance.openDocument({
      uri,
      languageId: "glsl",
      version: 1,
      text: "#version 100\nvoid mainImage(out vec4 color, in vec2 coord) {}",
    });
    const labels = (await instance.completion({ document: revision, position: { line: 1, character: 10 } }))
      .map((item) => item.label);
    expect(labels).toContain("texture2D");
    expect(labels).not.toContain("texture");
  });

  it("returns docs, local definitions, signatures, and document symbols", async () => {
    const instance = await service();
    const hover = await instance.hover({ document: revision, position: { line: 2, character: 36 } });
    expect(JSON.stringify(hover?.contents)).toContain("Canvas dimensions");
    const definition = await instance.definition({ document: revision, position: { line: 2, character: 17 } });
    expect(definition[0]?.uri).toBe(uri);
    expect((await instance.signatureHelp({ document: revision, position: { line: 2, character: 26 } }))?.signatures[0]?.label)
      .toContain("shade");
    expect((await instance.documentSymbols({ document: revision })).map((symbol) => symbol.name))
      .toEqual(expect.arrayContaining(["shade", "mainImage"]));
  });

  it("does not provide hovers for words inside comments", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `// texture iResolution tint
/* normalize */
void mainImage(out vec4 color, in vec2 coord) { color = texture(sky, coord); }`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    expect(await instance.hover({ document: revision, position: { line: 0, character: 5 } })).toBeNull();
    expect(await instance.hover({ document: revision, position: { line: 0, character: 13 } })).toBeNull();
    expect(await instance.hover({ document: revision, position: { line: 0, character: 25 } })).toBeNull();
    expect(await instance.hover({ document: revision, position: { line: 1, character: 5 } })).toBeNull();
    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 2, character: 60 } }))?.contents))
      .toContain("texture");
  });

  it("does not offer completions inside line or block comments", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = `// iChannel0
/* iChannel0 */
void mainImage(out vec4 color, in vec2 coord) { color = texture(iChannel0, coord); }`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    await expect(instance.completion({ document: revision, position: { line: 0, character: 11 } })).resolves.toEqual([]);
    await expect(instance.completion({ document: revision, position: { line: 1, character: 11 } })).resolves.toEqual([]);
    await expect(instance.completion({ document: revision, position: { line: 2, character: 61 } }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ label: "iChannel0" })]));
  });

  it("does not show signature help inside comments", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = "// normalize(\n/* normalize( */";
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    await expect(instance.signatureHelp({ document: revision, position: { line: 0, character: 12 } })).resolves.toBeNull();
    await expect(instance.signatureHelp({ document: revision, position: { line: 1, character: 12 } })).resolves.toBeNull();
  });

  it("returns syntax/include diagnostics and colors without throwing on stale requests", async () => {
    const instance = await service();
    await instance.changeDocument({ uri, languageId: "glsl", version: 2, text: '#include "missing.glsl"\nvoid mainImage( {' });
    const current = { ...revision, version: 2 };
    expect((await instance.diagnostics({ document: current })).map((item) => item.code))
      .toEqual(expect.arrayContaining(["include-not-found", "syntax"]));
    expect(await instance.completion({ document: revision, position: { line: 0, character: 0 } })).toEqual([]);

    await instance.changeDocument({ uri, languageId: "glsl", version: 3, text: "vec3 color = vec3(1.0, .25, 0.0);" });
    const colors = await instance.documentColors({ document: { ...revision, version: 3 } });
    expect(colors).toHaveLength(1);
    expect(colors[0]?.color.green).toBe(0.25);
  });

  it("reports unresolved GLSL symbols while accepting authoring, include, and stage built-ins", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      virtualFiles: [{
        uri: "file:///workspace/common.glsl",
        version: 1,
        text: "float includedValue(float value) { return value; }",
      }],
    });
    const text = `#include "common.glsl"
void mainImage(out vec4 color, in vec2 position) {
  color = texture(sky, position) + vec4(includedValue(tint.x + iResolution.x + gl_FragCoord.x + missingValue));
  color += vec4(missingFunction(position.x));
}`;
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    const diagnostics = await instance.diagnostics({ document: revision });

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "undefined-identifier",
        message: "Undefined identifier 'missingValue'.",
        range: { start: { line: 2, character: 96 }, end: { line: 2, character: 108 } },
      }),
      expect.objectContaining({
        code: "undefined-function",
        message: "Undefined function 'missingFunction'.",
        range: { start: { line: 3, character: 16 }, end: { line: 3, character: 31 } },
      }),
    ]));
    expect(diagnostics.map((diagnostic) => diagnostic.message).join("\n")).not.toMatch(
      /sky|includedValue|tint|iResolution|gl_FragCoord/,
    );
  });

  it("reports built-ins that are unavailable in the current GLSL stage", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment(environment());
    const text = "void mainImage(out vec4 color, in vec2 position) { color = vec4(gl_VertexID); }";
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });

    await expect(instance.diagnostics({ document: revision })).resolves.toContainEqual(expect.objectContaining({
      code: "undefined-identifier",
      message: "Undefined identifier 'gl_VertexID'.",
    }));
  });

  it("completes and navigates into environment-provided includes", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      virtualFiles: [{ uri: "file:///workspace/common.glsl", version: 1, text: "float twice(float value) { return value * 2.0; }" }],
    });
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text: '#include "common.glsl"\nvoid mainImage(out vec4 c, vec2 p) { c = vec4(twice(1.0)); }' });
    const labels = (await instance.completion({ document: revision, position: { line: 1, character: 48 } })).map((item) => item.label);
    expect(labels).toContain("twice");
    expect((await instance.definition({ document: revision, position: { line: 1, character: 48 } }))[0]?.uri)
      .toBe("file:///workspace/common.glsl");
    expect(await instance.diagnostics({ document: revision })).not.toContainEqual(expect.objectContaining({ code: "include-not-found" }));
  });

  it("provides completion, hover, signatures, and navigation for implicit Shader Studio Common", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({
      ...environment(),
      passName: "BufferA",
      commonFile: {
        uri: "file:///workspace/common.glsl",
        version: 1,
        text: "float sharedTone(float value) { return value * 0.5; }",
      },
    });
    const text = "void mainImage(out vec4 color, vec2 coord) { color = vec4(sharedTone(coord.x)); }";
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
    const position = { line: 0, character: text.indexOf("sharedTone") + 3 };

    expect((await instance.completion({ document: revision, position })).map((item) => item.label)).toContain("sharedTone");
    expect(JSON.stringify((await instance.hover({ document: revision, position }))?.contents)).toContain("Shader Studio Common");
    expect((await instance.definition({ document: revision, position }))[0]?.uri).toBe("file:///workspace/common.glsl");
    expect((await instance.signatureHelp({
      document: revision,
      position: { line: 0, character: text.indexOf("coord.x") + "coord.x".length },
    }))?.signatures.map((item) => item.label)).toContain("float sharedTone(float)");
  });

  it("documents the Shader Studio vertex hook and its mutable parameters", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({ ...environment(), stage: "vertex" });
    const vertexSource = "void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv) { position += normal; }";
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text: vertexSource });
    // Complete from inside the body: GLSL only brings the parameters into scope there.
    const labels = await instance.completion({
      document: revision,
      position: { line: 0, character: vertexSource.indexOf("position +=") },
    });

    expect(labels.find((item) => item.label === "mainVertex")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex hook") }));
    expect(labels.find((item) => item.label === "position")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("position") }));
    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 0, character: 7 } }))?.contents))
      .toContain("vertex hook");
    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 0, character: 29 } }))?.contents))
      .toContain("object-space");
    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 0, character: 51 } }))?.contents))
      .toContain("normal");
    expect(JSON.stringify((await instance.hover({ document: revision, position: { line: 0, character: 68 } }))?.contents))
      .toContain("texture coordinate");
  });

  it("documents renamed GLSL vertex-hook parameters by role", async () => {
    const instance = new GlslLanguageService();
    await instance.syncEnvironment({ ...environment(), stage: "vertex" });
    const text = "void mainVertex(inout vec3 deformed, inout vec3 surfaceNormal, inout vec2 textureUv) { deformed += surfaceNormal * textureUv.x; }";
    await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
    const hoverAt = (name: string, occurrence = 0) => {
      let offset = -1;
      for (let index = 0; index <= occurrence; index++) {
        offset = text.indexOf(name, offset + 1);
      }
      return instance.hover({ document: revision, position: { line: 0, character: offset + 1 } });
    };

    expect(JSON.stringify((await hoverAt("deformed"))?.contents)).toContain("vertex position");
    expect(JSON.stringify((await hoverAt("deformed", 1))?.contents)).toContain("object-space");
    expect(JSON.stringify((await hoverAt("surfaceNormal"))?.contents)).toContain("vertex normal");
    expect(JSON.stringify((await hoverAt("textureUv"))?.contents)).toContain("texture coordinate");
    const completions = await instance.completion({
      document: revision,
      position: { line: 0, character: text.indexOf("deformed +=") + "deformed".length },
    });
    expect(completions.find((item) => item.label === "mainVertex")?.detail)
      .toBe("void mainVertex(inout vec3 deformed, inout vec3 surfaceNormal, inout vec2 textureUv)");
    expect(completions.find((item) => item.label === "deformed")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex position") }));
    expect(completions.find((item) => item.label === "surfaceNormal")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex normal") }));
    expect(completions.find((item) => item.label === "textureUv")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("texture coordinate") }));
  });

  describe("scope-aware completion", () => {
    const scopedSource = `float tone(float amount) {
  float level = amount * 0.5;
  return level;
}
void mainImage(out vec4 color, in vec2 coord) {
  vec2 offset = coord * 2.0;
  color = vec4(offset, 0.0, 1.0);
}`;

    async function completeIn(text: string, position: { line: number; character: number }) {
      const instance = new GlslLanguageService();
      await instance.syncEnvironment(environment());
      await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
      const items = await instance.completion({ document: revision, position });
      return items.map((item) => item.label);
    }

    it("omits locals and parameters that belong to another function", async () => {
      const labels = await completeIn(scopedSource, { line: 6, character: 18 });

      expect(labels).not.toContain("amount");
      expect(labels).not.toContain("level");
    });

    it("offers locals, parameters, and functions that are in scope", async () => {
      const labels = await completeIn(scopedSource, { line: 6, character: 18 });

      expect(labels).toEqual(expect.arrayContaining(["offset", "color", "coord", "tone"]));
    });

    it("omits symbols declared after the cursor", async () => {
      const labels = await completeIn(scopedSource, { line: 1, character: 20 });

      expect(labels).toContain("amount");
      expect(labels).not.toContain("mainImage");
      expect(labels).not.toContain("offset");
    });

    it("keeps built-ins and environment symbols when the document does not parse", async () => {
      const labels = await completeIn(`void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(sha`, { line: 1, character: 18 });

      expect(labels).toEqual(expect.arrayContaining(["normalize", "iResolution", "tint", "sky"]));
    });
  });

  describe("references, highlights, and rename", () => {
    const scoped = `float tone(float amount) {
  float level = amount * 0.5;
  return level + amount;
}
void mainImage(out vec4 color, in vec2 coord) {
  vec2 level = coord * 2.0;
  color = vec4(level, 0.0, 1.0);
}`;

    function positionOf(text: string, needle: string, occurrence = 0) {
      let offset = -1;
      for (let index = 0; index <= occurrence; index++) {
        offset = text.indexOf(needle, offset + 1);
      }
      const lines = text.slice(0, offset).split("\n");
      return { line: lines.length - 1, character: (lines.at(-1)?.length ?? 0) + 1 };
    }

    async function open(text: string, overrides: Partial<ShaderAuthoringEnvironment> = {}) {
      const instance = new GlslLanguageService();
      await instance.syncEnvironment({ ...environment(), ...overrides });
      await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
      return instance;
    }

    it("lists the declaration and every use of a local", async () => {
      const instance = await open(scoped);

      const locations = await instance.references({
        document: revision,
        position: positionOf(scoped, "amount", 1),
        includeDeclaration: true,
      });

      expect(locations.map((item) => item.uri)).toEqual([uri, uri, uri]);
      expect(locations.map((item) => item.range.start)).toEqual([
        { line: 0, character: 17 },
        { line: 1, character: 16 },
        { line: 2, character: 17 },
      ]);
    });

    it("omits the declaration when it is not requested", async () => {
      const instance = await open(scoped);

      const locations = await instance.references({
        document: revision,
        position: positionOf(scoped, "amount", 1),
        includeDeclaration: false,
      });

      expect(locations.map((item) => item.range.start)).toEqual([
        { line: 1, character: 16 },
        { line: 2, character: 17 },
      ]);
    });

    it("resolves the shadowed symbol belonging to the enclosing scope", async () => {
      const instance = await open(scoped);

      const inner = await instance.references({
        document: revision,
        position: positionOf(scoped, "level", 2),
        includeDeclaration: true,
      });

      expect(inner.map((item) => item.range.start.line)).toEqual([5, 6]);
    });

    it("returns no references when the cursor is not on a symbol", async () => {
      const instance = await open(scoped);

      expect(await instance.references({
        document: revision,
        position: { line: 3, character: 0 },
        includeDeclaration: true,
      })).toEqual([]);
    });

    it("highlights the declaration as a write and each use as a read", async () => {
      const instance = await open(scoped);

      const highlights = await instance.documentHighlights({
        document: revision,
        position: positionOf(scoped, "amount", 1),
      });

      expect(highlights).toEqual([
        { range: expect.objectContaining({ start: { line: 0, character: 17 } }), kind: DocumentHighlightKind.Write },
        { range: expect.objectContaining({ start: { line: 1, character: 16 } }), kind: DocumentHighlightKind.Read },
        { range: expect.objectContaining({ start: { line: 2, character: 17 } }), kind: DocumentHighlightKind.Read },
      ]);
    });

    it("returns no highlights when the cursor is not on a symbol", async () => {
      const instance = await open(scoped);

      expect(await instance.documentHighlights({ document: revision, position: { line: 3, character: 0 } }))
        .toEqual([]);
    });

    it("rewrites the declaration and every use in one edit set", async () => {
      const instance = await open(scoped);

      const edit = await instance.rename({
        document: revision,
        position: positionOf(scoped, "amount", 1),
        newName: "strength",
      });

      expect(edit?.changes?.[uri]?.map((item) => ({ line: item.range.start.line, newText: item.newText }))).toEqual([
        { line: 0, newText: "strength" },
        { line: 1, newText: "strength" },
        { line: 2, newText: "strength" },
      ]);
    });

    it.each([
      ["an empty name", ""],
      ["a leading digit", "2bad"],
      ["embedded whitespace", "has space"],
      ["a GLSL keyword", "float"],
      ["a reserved gl_ prefix", "gl_Custom"],
      ["a double underscore", "bad__name"],
    ])("declines %s", async (_label, newName) => {
      const instance = await open(scoped);

      expect(await instance.rename({
        document: revision,
        position: positionOf(scoped, "amount", 1),
        newName,
      })).toBeNull();
    });

    it.each([
      ["a symbol already visible in scope", "level"],
      ["a custom uniform", "tint"],
      ["a shader resource", "sky"],
      ["a Shader Studio built-in", "iResolution"],
      ["a GLSL intrinsic", "normalize"],
    ])("declines a name that collides with %s", async (_label, newName) => {
      const instance = await open(scoped);

      expect(await instance.rename({
        document: revision,
        position: positionOf(scoped, "amount", 1),
        newName,
      })).toBeNull();
    });

    it("declines a name already used by the common file", async () => {
      const text = "void mainImage(out vec4 color, vec2 coord) { float local = coord.x; color = vec4(local); }";
      const instance = await open(text, {
        commonFile: {
          uri: "file:///workspace/common.glsl",
          version: 1,
          text: "float sharedTone(float value) { return value * 0.5; }",
        },
      });

      expect(await instance.rename({
        document: revision,
        position: positionOf(text, "local", 1),
        newName: "sharedTone",
      })).toBeNull();
    });

    it("declines to rename a symbol that the common file owns", async () => {
      const text = "void mainImage(out vec4 color, vec2 coord) { color = vec4(sharedTone(coord.x)); }";
      const instance = await open(text, {
        commonFile: {
          uri: "file:///workspace/common.glsl",
          version: 1,
          text: "float sharedTone(float value) { return value * 0.5; }",
        },
      });

      expect(await instance.rename({
        document: revision,
        position: positionOf(text, "sharedTone"),
        newName: "toneCurve",
      })).toBeNull();
    });

    it("declines when the cursor is not on a symbol", async () => {
      const instance = await open(scoped);

      expect(await instance.rename({
        document: revision,
        position: { line: 3, character: 0 },
        newName: "strength",
      })).toBeNull();
    });

    it("ignores requests for a stale document revision", async () => {
      const instance = await open(scoped);
      const stale = { ...revision, version: 99 };

      expect(await instance.references({ document: stale, position: positionOf(scoped, "amount", 1), includeDeclaration: true })).toEqual([]);
      expect(await instance.documentHighlights({ document: stale, position: positionOf(scoped, "amount", 1) })).toEqual([]);
      expect(await instance.rename({ document: stale, position: positionOf(scoped, "amount", 1), newName: "strength" })).toBeNull();
    });
  });
  describe("completion inside an unfinished statement", () => {
    async function open(text: string, overrides: Partial<ShaderAuthoringEnvironment> = {}) {
      const instance = new GlslLanguageService();
      await instance.syncEnvironment({ ...environment(), ...overrides });
      await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
      return instance;
    }

    const typing = `float shade(float x) { return x * 2.0; }
void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord * 0.5;
  float glow = 1.0;
  u
}`;

    it("offers parameters and preceding locals while the statement under the cursor is unfinished", async () => {
      const instance = await open(typing);

      const completions = await instance.completion({ document: revision, position: { line: 4, character: 3 } });

      const labels = completions.map((item) => item.label);
      expect(labels).toContain("uv");
      expect(labels).toContain("glow");
      expect(labels).toContain("coord");
      expect(labels).toContain("color");
      expect(labels).toContain("shade");
      expect(completions.find((item) => item.label === "uv")).toEqual(expect.objectContaining({
        kind: CompletionItemKind.Variable,
        detail: "vec2",
      }));
      expect(completions.find((item) => item.label === "coord")).toEqual(expect.objectContaining({
        kind: CompletionItemKind.Variable,
      }));
    });

    it("still offers intrinsics and Shader Studio symbols while the statement is unfinished", async () => {
      const instance = await open(typing);

      const labels = (await instance.completion({ document: revision, position: { line: 4, character: 3 } }))
        .map((item) => item.label);

      expect(labels).toContain("iTime");
      expect(labels).toContain("tint");
      expect(labels).toContain("normalize");
    });

    it("keeps locals out of scope that the unfinished statement cannot see", async () => {
      const instance = await open(`void mainImage(out vec4 color, in vec2 coord) {
  {
    float inner = 1.0;
  }
  float outer = 2.0;
  i
}`);

      const labels = (await instance.completion({ document: revision, position: { line: 5, character: 3 } }))
        .map((item) => item.label);

      expect(labels).toContain("outer");
      expect(labels).not.toContain("inner");
    });

    it("offers nothing local when blanking the statement cannot repair the document", async () => {
      const instance = await open(`void mainImage(out vec4 color, in vec2 coord) {
  float glow = 1.0;
  g
`);

      const labels = (await instance.completion({ document: revision, position: { line: 2, character: 3 } }))
        .map((item) => item.label);

      expect(labels).not.toContain("glow");
      expect(labels).toContain("iTime");
    });

    it("offers members of a local declared before an unfinished selection", async () => {
      const instance = await open(`void mainImage(out vec4 color, in vec2 coord) {
  vec2 uv = coord * 0.5;
  uv.
}`);

      const labels = (await instance.completion({ document: revision, position: { line: 2, character: 5 } }))
        .map((item) => item.label);

      expect(labels).toContain("x");
      expect(labels).toContain("y");
      expect(labels).not.toContain("uv");
    });
  });
});
