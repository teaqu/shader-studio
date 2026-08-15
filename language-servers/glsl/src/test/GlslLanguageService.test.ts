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
  it("completes standard, Shader Studio, custom uniform, and resource symbols", async () => {
    const labels = (await (await service()).completion({ document: revision, position: { line: 2, character: 10 } }))
      .map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["normalize", "texture", "iResolution", "tint", "sky", "shade"]));
    expect(labels).not.toContain("texture2D");
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
});
