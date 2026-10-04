import { describe, expect, it } from "vitest";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { WgslLanguageServiceBackend } from "../WgslLanguageServiceBackend";
import { WgslSymbolsProvider } from "../providers/WgslSymbolsProvider";

const commonUri = "file:///workspace/common.wgsl";
const imageUri = "file:///workspace/image.wgsl";
const bufferUri = "file:///workspace/buffer.wgsl";

const common = "fn tone(value: f32) -> f32 { return value; }";
const image = "fn mainImage(coord: vec2f) -> vec4f { return vec4f(tone(coord.x)); }";
const collidingBuffer = "fn mainImage(coord: vec2f) -> vec4f { let curve: f32 = 0.0; return vec4f(tone(coord.x) + curve); }";

function environment(overrides: Partial<ShaderAuthoringEnvironment> = {}): ShaderAuthoringEnvironment {
  return {
    documentUri: imageUri,
    languageId: "wgsl",
    generation: 1,
    passName: "Image",
    stage: "fragment",
    customUniforms: [{ name: "tint", type: "vec3" }],
    resources: [{ name: "sky", kind: "texture-cube" }],
    virtualFiles: [],
    ...overrides,
  };
}

function document(uri: string, text: string, version = 1) {
  return { uri, languageId: "wgsl" as const, version, text };
}

function revision(uri: string, version = 1, environmentGeneration = 1) {
  return { uri, languageId: "wgsl" as const, version, environmentGeneration };
}

describe("WgslLanguageServiceBackend", () => {
  it("keeps only matching environment and document revisions, and drops all analysis after close", async () => {
    const backend = new WgslLanguageServiceBackend();
    await backend.syncEnvironment({ ...environment(), languageId: "glsl" });
    await backend.openDocument(document(imageUri, image));
    expect(backend.current({ document: revision(imageUri) })).toBeUndefined();

    await backend.syncEnvironment(environment());
    await backend.openDocument(document(imageUri, image));
    expect(backend.current({ document: revision(imageUri) })?.analysis.symbols.map((symbol) => symbol.name))
      .toContain("mainImage");

    await backend.changeDocument({ ...document(imageUri, image, 2), languageId: "glsl" });
    expect(backend.current({ document: revision(imageUri, 1) })).toBeDefined();
    expect(backend.current({ document: revision(imageUri, 2) })).toBeUndefined();

    await backend.closeDocument(imageUri);
    expect(backend.current({ document: revision(imageUri) })).toBeUndefined();
    expect(await backend.documentColors({ document: revision(imageUri) })).toEqual([]);
    expect(await new WgslSymbolsProvider(backend).provide({ document: revision(imageUri) })).toEqual([]);
    await backend.dispose();
  });

  it("indexes Common across workspace passes and rejects a rename that collides in one affected pass", async () => {
    const backend = new WgslLanguageServiceBackend();
    await backend.syncEnvironment(environment({
      documentUri: commonUri,
      passName: "Common",
      virtualFiles: [],
      workspaceDocuments: [
        { uri: commonUri, version: 1, text: common, stage: "fragment" },
        { uri: imageUri, version: 1, text: image, stage: "fragment", commonUri },
        { uri: bufferUri, version: 1, text: collidingBuffer, stage: "fragment", commonUri },
      ],
    }));
    await backend.openDocument(document(commonUri, common));

    const state = backend.current({ document: revision(commonUri) });
    expect(state).toBeDefined();
    const tone = state!.analysis.symbols.find((symbol) => symbol.name === "tone");
    expect(tone).toBeDefined();

    expect([...backend.analysesIncluding(commonUri, tone!.id)].map(([uri]) => uri).sort())
      .toEqual([bufferUri, imageUri]);
    const uses = backend.commonUses(tone!, commonUri);
    expect([...uses.keys()].sort()).toEqual([bufferUri, imageUri]);
    expect(backend.commonRenameCollides(uses, tone!, "curve")).toBe(true);
    expect(backend.commonRenameCollides(uses, tone!, "renamedTone")).toBe(false);
  });

  it("finds Common references and reserves authored, configured, generated, and builtin names", async () => {
    const backend = new WgslLanguageServiceBackend();
    await backend.syncEnvironment(environment({ commonFile: { uri: commonUri, version: 1, text: common } }));
    await backend.openDocument(document(imageUri, image));
    const state = backend.current({ document: revision(imageUri) });
    expect(state).toBeDefined();
    const position = { line: 0, character: image.indexOf("tone") + 1 };
    const params = { document: revision(imageUri), position, includeDeclaration: true };

    const included = backend.includedSymbolAt(state!, position);
    expect(included?.analysis.uri).toBe(commonUri);
    expect(included?.symbol.name).toBe("tone");
    expect(backend.includedReferences(state!, params, true).map((location) => location.uri))
      .toEqual([commonUri, imageUri]);
    expect(backend.includedReferences(state!, { ...params, position: { line: 0, character: 0 } }, false)).toEqual([]);

    for (const newName of ["mainImage", "tint", "sky", "iTime", "sin", "tone"]) {
      expect(backend.nameIsTaken(state!, { ...params, newName })).toBe(true);
    }
    expect(backend.nameIsTaken(state!, { ...params, newName: "renamedTone" })).toBe(false);
  });
});
