import { describe, expect, it } from "vitest";
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
    expect(labels).not.toContain("mainVertex");
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
    const labels = await instance.completion({ document: revision, position: { line: 0, character: 5 } });

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
    const completions = await instance.completion({ document: revision, position: { line: 0, character: text.length - 3 } });
    expect(completions.find((item) => item.label === "mainVertex")?.detail)
      .toBe("void mainVertex(inout vec3 deformed, inout vec3 surfaceNormal, inout vec2 textureUv)");
    expect(completions.find((item) => item.label === "deformed")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex position") }));
    expect(completions.find((item) => item.label === "surfaceNormal")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex normal") }));
    expect(completions.find((item) => item.label === "textureUv")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("texture coordinate") }));
  });
});
