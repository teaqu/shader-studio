import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stageForPass } from "@shader-studio/types";
import { GlslLanguageService } from "../GlslLanguageService";

/**
 * Language-service coverage over every GLSL corpus mirror
 * (tests/fixtures/shader-corpus/glsl). Each document opens with the
 * environment the extension would build from its sibling config — stage,
 * channel resources (every input maps to a texture kind with a slot, exactly
 * like ShaderAuthoringEnvironmentProvider.resourcesFor), script uniforms,
 * common file — and asserts: zero diagnostics, working hover on the entry
 * point (plus "Shader Studio Common" provenance for common helpers).
 * A dedicated case pins the mainImage contract tooltip and the builtin
 * tooltips exercised by intellisense_glsl.glsl, and a negative case proves
 * the diagnostic assertions are not vacuous.
 */
const CORPUS = normalize(join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "tests", "fixtures", "shader-corpus", "glsl",
));

interface ShaInput { type?: string; source?: string }
interface ShaPass {
  type?: string;
  path?: string;
  vertex?: string;
  entryPoint?: string;
  inputs?: Record<string, ShaInput>;
}
interface ShaConfig {
  script?: string;
  storage?: Record<string, { elementType?: string }>;
  passes?: Record<string, ShaPass>;
}

const walkConfigs = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkConfigs(p, out);
    else if (e.name.endsWith(".sha.json")) out.push(p);
  }
  return out.sort();
};

// Workspace-anchored `@/` refs resolve from the corpus root
// (e.g. `@/glsl/foundation/debugging/common_glsl.glsl`); everything else
// resolves relative to the owning config, like the extension loader.
const CORPUS_ROOT = dirname(CORPUS);
const resolveRef = (configAbs: string, value: string): string => {
  if (value.startsWith("@/")) return normalize(relative(CORPUS, join(CORPUS_ROOT, value.slice("@/".length))));
  return normalize(relative(CORPUS, join(dirname(configAbs), value)));
};

// Every error/warning-severity diagnostic the corpus intentionally carries,
// keyed by corpus-relative file. Anything else must be clean.
// - intellisense_glsl.glsl exercises ES 1.00-only texture builtins inside a
//   `#if __VERSION__ < 300` branch that is dead under the renderer's
//   `#version 300 es` target; the service does not prune version branches.
// - vertex_glsl.glsl deliberately binds a texture AS `iChannel3`, which the
//   service (correctly) flags as colliding with canonical channel slot 3.
const EXPECTED_PROBLEMS = new Map<string, RegExp[]>([
  ["intellisense_glsl.glsl", [
    /Undefined function 'texture2DProj'\./,
    /Undefined function 'texture2DLod'\./,
    /Undefined function 'texture2DProjLod'\./,
    /Undefined function 'textureCubeLod'\./,
  ]],
  ["vertex_glsl.glsl", [/conflicts with canonical channel slot 3/]],
  // The vertex hook inherits the same colliding binding through its pass
  // environment, so it carries the same (correct) warning.
  ["vertex_glsl_vertex.glsl", [/conflicts with canonical channel slot 3/]],
]);

const uniformsFor = (script?: string) => {
  if (!script) return [];
  if (script.endsWith("custom-uniforms.ts")) {
    return ["uRed", "uGreen", "uOffset"].map((name) => ({ name, type: "float" as const }));
  }
  return [
    { name: "uFloat", type: "float" as const },
    { name: "uVec2", type: "vec2" as const },
    { name: "uVec3", type: "vec3" as const },
    { name: "uVec4", type: "vec4" as const },
    { name: "uBool", type: "bool" as const },
  ];
};

// First whole-word `needle` occurrence in code (comments and preprocessor
// lines stripped, lines preserved).
const findWord = (text: string, needle: string, occurrence = 0) => {
  const pattern = new RegExp(`\\b${needle}\\b`);
  let seen = 0;
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line]!;
    if (/^\s*#/.test(raw)) continue;
    const code = raw.split("//")[0]!;
    const match = pattern.exec(code);
    if (match && match.index !== undefined) {
      if (seen === occurrence) return { line, character: match.index };
      seen++;
    }
  }
  return null;
};

// First function definition in a GLSL source: `type name(` at line start,
// ignoring preprocessor directives and comments.
const firstFn = (text: string): string | null => {
  for (const raw of text.split("\n")) {
    if (/^\s*#/.test(raw)) continue;
    const code = raw.split("//")[0]!;
    const match = /^\s*(?:void|float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|mat[234]|mat[234]x[234]|sampler\w+)\s+([A-Za-z_]\w*)\s*\(/.exec(code);
    if (match?.[1]) return match[1];
  }
  return null;
};

// First common helper the document actually references (whole word, comments
// and preprocessor lines stripped); undefined when the doc never names one.
const referencedHelper = (docText: string, commonText: string): string | undefined => {
  const stripped = (t: string) => t.split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.split("//")[0])
    .join("\n");
  const names = [...stripped(commonText).matchAll(/^\s*\w[\w\s]*?\s+([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]!);
  const doc = stripped(docText);
  return names.find((name) => new RegExp(`\\b${name}\\b`).test(doc));
};

let generation = 0;

async function openMirror(rel: string, text: string, opts: {
  stage: "fragment" | "vertex" | "compute";
  passName: string;
  resources: { name: string; kind: "texture-2d" | "texture-cube" | "storage"; slot?: number; elementType?: string }[];
  customUniforms: { name: string; type: "float" | "vec2" | "vec3" | "vec4" | "bool" }[];
  commonFile?: { uri: string; text: string; version: number };
}) {
  const uri = `file:///corpus/${rel}`;
  const instance = new GlslLanguageService();
  const gen = ++generation;
  await instance.syncEnvironment({
    documentUri: uri,
    languageId: "glsl",
    generation: gen,
    passName: opts.passName,
    stage: opts.stage,
    customUniforms: opts.customUniforms,
    resources: opts.resources,
    ...(opts.commonFile ? { commonFile: opts.commonFile } : {}),
    virtualFiles: [],
  });
  await instance.openDocument({ uri, languageId: "glsl", version: 1, text });
  const revision = { uri, languageId: "glsl" as const, version: 1, environmentGeneration: gen };
  const hoverText = async (needle: string, occurrence = 0): Promise<string | null> => {
    const pos = findWord(text, needle, occurrence);
    if (!pos) return null;
    const hover = await instance.hover({ document: revision, position: pos });
    return hover ? JSON.stringify(hover.contents) : null;
  };
  return { instance, revision, hoverText };
}

interface MirrorDoc {
  configRel: string;
  pass: string;
  fileRel: string;
  text: string;
  stage: "fragment" | "vertex" | "compute";
  entry: string;
  resources: { name: string; kind: "texture-2d" | "texture-cube" | "storage"; slot?: number; elementType?: string }[];
  customUniforms: { name: string; type: "float" | "vec2" | "vec3" | "vec4" | "bool" }[];
  commonFile?: { uri: string; text: string; version: number };
  commonHelper?: string;
}

const collectDocs = (): MirrorDoc[] => {
  const docs: MirrorDoc[] = [];
  const toRel = (abs: string) => abs.slice(`${CORPUS}/`.length);
  for (const configAbs of walkConfigs(CORPUS)) {
    const configRel = toRel(configAbs);
    const dir = dirname(configRel);
    const stem = configAbs.slice(configAbs.lastIndexOf("/") + 1, -".sha.json".length);
    const cfg = JSON.parse(readFileSync(configAbs, "utf8")) as ShaConfig;
    const passes = cfg.passes ?? {};
    const uniforms = uniformsFor(cfg.script);
    const commonPath = passes.common?.path;
    const commonRel = commonPath ? resolveRef(configAbs, commonPath) : undefined;
    const commonText = commonRel && existsSync(join(CORPUS, commonRel))
      ? readFileSync(join(CORPUS, commonRel), "utf8")
      : undefined;
    const commonFile = commonRel && commonText !== undefined
      ? { uri: `file:///corpus/${commonRel}`, text: commonText, version: 1 }
      : undefined;
    const resourcesFor = (pass?: ShaPass) => [
      ...Object.entries(pass?.inputs ?? {}).map(([key, inp], slot) => ({
        name: key,
        kind: (inp.type === "cubemap" ? "texture-cube" : "texture-2d") as "texture-2d" | "texture-cube",
        slot,
      })),
      ...Object.entries(cfg.storage ?? {}).map(([name, s]) => ({
        name,
        kind: "storage" as const,
        ...(s.elementType ? { elementType: s.elementType } : {}),
      })),
    ];
    // Common file itself, opened the way the extension opens it.
    if (commonRel && commonText !== undefined) {
      const helper = firstFn(commonText);
      if (helper) {
        docs.push({
          configRel, pass: "common", fileRel: commonRel, text: commonText,
          stage: "fragment", entry: helper, resources: [], customUniforms: uniforms,
        });
      }
    }
    for (const [passName, pass] of Object.entries(passes)) {
      if (passName === "common") continue;
      const fileRel = pass.path ? resolveRef(configAbs, pass.path) : join(dir, `${stem}.glsl`);
      if (!existsSync(join(CORPUS, fileRel))) continue;
      const text = readFileSync(join(CORPUS, fileRel), "utf8");
      const stage = stageForPass(cfg as never, passName, fileRel);
      const entry = pass.entryPoint ?? firstFn(text) ?? "mainImage";
      docs.push({
        configRel, pass: passName, fileRel, text, stage, entry,
        resources: resourcesFor(pass), customUniforms: uniforms, commonFile,
        commonHelper: commonFile ? referencedHelper(text, commonFile.text) : undefined,
      });
      if (typeof pass.vertex === "string") {
        const vertRel = resolveRef(configAbs, pass.vertex);
        if (existsSync(join(CORPUS, vertRel))) {
          const vertText = readFileSync(join(CORPUS, vertRel), "utf8");
          docs.push({
            configRel, pass: `${passName}:vertex`, fileRel: vertRel, text: vertText,
            stage: "vertex", entry: "mainVertex",
            resources: resourcesFor(pass), customUniforms: uniforms, commonFile,
          });
        }
      }
    }
  }
  // Config-less sanity shaders open with an empty environment.
  for (const standalone of ["shadertoy.glsl", "parity/pixel-inspector/gradient_glsl.glsl"]) {
    if (!existsSync(join(CORPUS, standalone))) continue;
    const text = readFileSync(join(CORPUS, standalone), "utf8");
    docs.push({
      configRel: "(none)", pass: "Image", fileRel: standalone, text,
      stage: "fragment", entry: "mainImage", resources: [], customUniforms: [],
    });
  }
  return docs;
};

const DOCS = collectDocs();

describe("GLSL corpus mirrors in the language service", () => {
  it(`opens every mirror document (${DOCS.length} across all configs)`, () => {
    expect(DOCS.length).toBeGreaterThan(30);
  });

  it.each(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`))(
    "reports no diagnostics and hovers its entry point: %s",
    async (label) => {
      const doc = DOCS.find((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})` === label)!;
      const stage = doc.stage as "fragment" | "vertex" | "compute";
      const { hoverText, revision, instance } = await openMirror(doc.fileRel, doc.text, {
        stage, passName: doc.pass, resources: doc.resources,
        customUniforms: doc.customUniforms, commonFile: doc.commonFile,
      });
      const diagnostics = await instance.diagnostics({ document: revision });
      // Hints (unused parameters and the like) are advisory; errors and
      // warnings must be clean except for the documented EXPECTED_PROBLEMS.
      const problems = diagnostics.filter((d) => (d.severity ?? 1) <= 2);
      const expected = EXPECTED_PROBLEMS.get(doc.fileRel) ?? [];
      expect(problems.map((d) => d.message), `${label}: unexpected diagnostics`).toHaveLength(expected.length);
      for (const problem of problems) {
        expect(expected.some((pattern) => pattern.test(problem.message)), `${label}: unexpected diagnostic: ${problem.message}`).toBe(true);
      }
      const hover = await hoverText(doc.entry);
      expect(hover, `${label}: no hover for ${doc.entry}`).not.toBeNull();
      expect(hover).toContain(doc.entry);
      if (doc.commonHelper) {
        const commonHover = await hoverText(doc.commonHelper);
        expect(commonHover, `${label}: no Common hover for ${doc.commonHelper}`).not.toBeNull();
        expect(commonHover).toContain("Declared in Shader Studio Common.");
      }
    },
  );

  it("documents the mainImage contract on a configured image pass", async () => {
    const doc = DOCS.find((d) => d.fileRel === "flow_glsl.glsl" && d.pass === "Image")!;
    const { hoverText } = await openMirror(doc.fileRel, doc.text, {
      stage: "fragment", passName: doc.pass, resources: doc.resources,
      customUniforms: doc.customUniforms, commonFile: doc.commonFile,
    });
    const hover = await hoverText("mainImage");
    expect(hover).not.toBeNull();
    expect(hover).toContain("fragment entry point");
  });

  it("documents the builtins exercised by intellisense_glsl.glsl", async () => {
    const doc = DOCS.find((d) => d.fileRel === "intellisense_glsl.glsl" && d.pass === "Image")!;
    const { hoverText } = await openMirror(doc.fileRel, doc.text, {
      stage: "fragment", passName: doc.pass, resources: doc.resources,
      customUniforms: doc.customUniforms, commonFile: doc.commonFile,
    });
    for (const name of ["fwidth", "intBitsToFloat", "texture", "normalize", "clamp"]) {
      const hover = await hoverText(name);
      expect(hover, `no tooltip for ${name}`).not.toBeNull();
      expect(hover).toContain(name);
    }
  });

  it("documents generated vertex-stage samplers", async () => {
    const doc = DOCS.find((d) => d.fileRel === "feature-coverage_glsl.vert.glsl")!;
    const { hoverText } = await openMirror(doc.fileRel, doc.text, {
      stage: "vertex", passName: doc.pass, resources: doc.resources,
      customUniforms: doc.customUniforms, commonFile: doc.commonFile,
    });
    const helper = await hoverText("samplePatternTex");
    expect(helper).not.toBeNull();
    expect(helper).toContain("vec4 samplePatternTex(vec2 uv)");
    expect(helper).toContain("patternTex");
  });

  it("completes generated vertex-stage samplers", async () => {
    const doc = DOCS.find((d) => d.fileRel === "feature-coverage_glsl.vert.glsl")!;
    const { instance, revision } = await openMirror(doc.fileRel, doc.text, {
      stage: "vertex", passName: doc.pass, resources: doc.resources,
      customUniforms: doc.customUniforms, commonFile: doc.commonFile,
    });
    const items = await instance.completion({
      document: revision,
      position: { line: 0, character: 0 },
    });
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining([
      "samplePatternTex",
      "sampleIChannel0",
    ]));
  });

  it("still reports diagnostics on broken input (assertions above are not vacuous)", async () => {
    const { revision, instance } = await openMirror("broken.glsl",
      "void mainImage(out vec4 color, in vec2 coord) {\n  color = vec4(undefinedIdentifier_xyz, 1.0);\n}",
      { stage: "fragment", passName: "Image", resources: [], customUniforms: [] });
    const diagnostics = await instance.diagnostics({ document: revision });
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
