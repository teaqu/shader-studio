import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stageForPass } from "@shader-studio/types";
import { parseGlslDocument, symbolAtPosition } from "@shader-studio/glsl-analysis";
import { swizzleSelections } from "@shader-studio/language-server-core";
import { GlslLanguageService } from "../GlslLanguageService";
import { GLSL_INTRINSICS } from "../intrinsics";

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
    if (e.isDirectory()) {
      walkConfigs(p, out);
    } else if (e.name.endsWith(".sha.json")) {
      out.push(p);
    }
  }
  return out.sort();
};

// Workspace-anchored `@/` refs resolve from the corpus root
// (e.g. `@/glsl/foundation/debugging/common_glsl.glsl`); everything else
// resolves relative to the owning config, like the extension loader.
const CORPUS_ROOT = dirname(CORPUS);
const resolveRef = (configAbs: string, value: string): string => {
  if (value.startsWith("@/")) {
    return normalize(relative(CORPUS, join(CORPUS_ROOT, value.slice("@/".length))));
  }
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
  if (!script) {
    return [];
  }
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
    if (/^\s*#/.test(raw)) {
      continue;
    }
    const code = raw.split("//")[0]!;
    const match = pattern.exec(code);
    if (match && match.index !== undefined) {
      if (seen === occurrence) {
        return { line, character: match.index };
      }
      seen++;
    }
  }
  return null;
};

// First function definition in a GLSL source: `type name(` at line start,
// ignoring preprocessor directives and comments.
const firstFn = (text: string): string | null => {
  for (const raw of text.split("\n")) {
    if (/^\s*#/.test(raw)) {
      continue;
    }
    const code = raw.split("//")[0]!;
    const match = /^\s*(?:void|float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|mat[234]|mat[234]x[234]|sampler\w+)\s+([A-Za-z_]\w*)\s*\(/.exec(code);
    if (match?.[1]) {
      return match[1];
    }
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
    if (!pos) {
      return null;
    }
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
      if (passName === "common") {
        continue;
      }
      const fileRel = pass.path ? resolveRef(configAbs, pass.path) : join(dir, `${stem}.glsl`);
      if (!existsSync(join(CORPUS, fileRel))) {
        continue;
      }
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
    if (!existsSync(join(CORPUS, standalone))) {
      continue;
    }
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

/**
 * Every authored identifier in the GLSL corpus, classified by what the
 * language service should do there, mirroring the WGSL sweep. Preprocessor
 * lines, keywords, and built-in type names are syntax with no symbol behind
 * them; declarations and references must hover with their owner; members
 * complete from their owner's type; calls show the callee's signature with
 * the argument under the cursor active. GLSL-specific differences: overloads
 * are chosen by arity, constructors are not catalogued, and `#include`d or
 * Common declarations must say where they come from.
 */
type GlslSiteCategory = "preprocessor" | "version-branch" | "keyword" | "builtin-type" | "declaration" | "reference" | "member";

interface GlslSweepToken {
  readonly text: string;
  readonly kind: "identifier" | "number" | "punctuation";
  readonly line: number;
  readonly character: number;
  readonly directive: boolean;
  /** Inside `#if __VERSION__ < 300`: kept by the service, removed by the renderer's `#version 300 es`. */
  readonly legacyVersionBranch: boolean;
}

const GLSL_KEYWORDS = new Set([
  "attribute", "break", "case", "centroid", "const", "continue", "default", "discard", "do", "else", "false", "flat",
  "for", "highp", "if", "in", "inout", "invariant", "layout", "lowp", "mediump", "out", "precision", "return",
  "smooth", "struct", "switch", "true", "uniform", "varying", "while",
]);
const GLSL_BUILTIN_TYPE = /^(?:void|bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?|[iu]?sampler(?:2D|3D|Cube|2DArray)(?:Shadow)?|samplerCubeShadow|sampler2DArrayShadow)$/;

function tokenizeGlslSweep(source: string): GlslSweepToken[] {
  const tokens: GlslSweepToken[] = [];
  let line = 0;
  let character = 0;
  let directive = false;
  let lineStart = true;
  let legacyDepth = 0;
  let depth = 0;
  for (let offset = 0; offset < source.length;) {
    const rest = source.slice(offset);
    const char = source[offset]!;
    const step = (length: number) => {
      for (const consumed of source.slice(offset, offset + length)) {
        if (consumed === "\n") {
          line += 1;
          character = 0;
          directive = false;
          lineStart = true;
        } else {
          character += 1;
        }
      }
      offset += length;
    };
    if (char === "\n" || char === " " || char === "\t" || char === "\r") {
      step(1);
      continue;
    }
    if (rest.startsWith("//")) {
      step(rest.indexOf("\n") === -1 ? rest.length : rest.indexOf("\n"));
      continue;
    }
    if (rest.startsWith("/*")) {
      step(rest.indexOf("*/") === -1 ? rest.length : rest.indexOf("*/") + 2);
      continue;
    }
    if (lineStart && char === "#") {
      directive = true;
      const line = rest.slice(0, rest.indexOf("\n") === -1 ? rest.length : rest.indexOf("\n"));
      if (/^#\s*if/.test(line)) {
        depth += 1;
        if (legacyDepth === 0 && /__VERSION__\s*<\s*300/.test(line)) {
          legacyDepth = depth;
        }
      } else if (/^#\s*endif/.test(line)) {
        if (legacyDepth === depth) {
          legacyDepth = 0;
        }
        depth -= 1;
      }
    }
    lineStart = false;
    const identifier = /^[A-Za-z_]\w*/.exec(rest)?.[0];
    const number = /^(?:\d[\w.]*|\.\d[\w.]*)/.exec(rest)?.[0];
    const text = identifier ?? number ?? char;
    tokens.push({ text, kind: identifier ? "identifier" : number ? "number" : "punctuation", line, character, directive, legacyVersionBranch: legacyDepth > 0 });
    step(text.length);
  }
  return tokens;
}

/** Offered GLSL swizzles: components and prefix runs from each set, as completion lists them. */
const GLSL_OFFERED_SWIZZLES = new Set(swizzleSelections(4, ["xyzw", "rgba", "stpq"]));

function glslArgumentPositions(tokens: readonly GlslSweepToken[], open: number): { line: number; character: number }[] {
  const positions = [{ line: tokens[open]!.line, character: tokens[open]!.character + 1 }];
  for (let cursor = open, depth = 0; cursor < tokens.length; cursor++) {
    const text = tokens[cursor]!.text;
    if (text === "(" || text === "[") {
      depth += 1;
    } else if (text === ")" || text === "]") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    } else if (text === "," && depth === 1) {
      positions.push({ line: tokens[cursor]!.line, character: tokens[cursor]!.character + 1 });
    }
  }
  return positions;
}

const signatureArity = (label: string) => {
  const inside = label.slice(label.indexOf("(") + 1, label.lastIndexOf(")")).trim();
  return inside === "" || inside === "void" ? 0 : inside.split(",").length;
};

const glslSweepTotals = new Map<string, number>();
const glslSweptDocs = new Set<string>();
const countSite = (key: string) => glslSweepTotals.set(key, (glslSweepTotals.get(key) ?? 0) + 1);

describe("GLSL corpus mirrors: authored identifier sweep", () => {
  it.each(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`))(
    "hovers, completes, and signs every authored identifier: %s",
    async (label) => {
      const doc = DOCS.find((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})` === label)!;
      const { instance, revision } = await openMirror(doc.fileRel, doc.text, {
        stage: doc.stage, passName: doc.pass, resources: doc.resources,
        customUniforms: doc.customUniforms, commonFile: doc.commonFile,
      });
      const analysis = parseGlslDocument(doc.fileRel, doc.text, doc.stage);
      const common = doc.commonFile ? parseGlslDocument(doc.commonFile.uri, doc.commonFile.text, doc.stage) : undefined;
      const declarations = new Set(analysis.symbols.map((symbol) => `${symbol.declaration.start.line}:${symbol.declaration.start.character}`));
      const structNames = new Set([...analysis.symbols, ...(common?.symbols ?? [])].filter((symbol) => symbol.kind === "type").map((symbol) => symbol.name));
      const commonNames = new Set(common?.symbols.map((symbol) => symbol.name) ?? []);
      const uniformNames = new Set(doc.customUniforms.map((uniform) => uniform.name));
      const resourceNames = new Set(doc.resources.map((resource) => resource.name));
      const intrinsicNames = new Set(GLSL_INTRINSICS.map((intrinsic) => intrinsic.name));
      const tokens = tokenizeGlslSweep(doc.text);
      const gaps: string[] = [];
      glslSweptDocs.add(label);
      for (const [index, token] of tokens.entries()) {
        if (token.kind !== "identifier") {
          continue;
        }
        // ES 1.00 names under `#if __VERSION__ < 300` are dead for the renderer's
        // `#version 300 es`; the service does not prune that branch and the
        // 3.00 catalogue has no entry for them (see EXPECTED_PROBLEMS).
        const category: GlslSiteCategory = token.directive ? "preprocessor"
          : token.legacyVersionBranch ? "version-branch"
            : tokens[index - 1]?.text === "." ? "member"
              : declarations.has(`${token.line}:${token.character}`) ? "declaration"
                : GLSL_KEYWORDS.has(token.text) ? "keyword"
                  : GLSL_BUILTIN_TYPE.test(token.text) ? "builtin-type"
                    : "reference";
        countSite(category);
        const where = `${token.line + 1}:${token.character + 1} ${category} '${token.text}'`;
        const start = { line: token.line, character: token.character };
        const end = { line: token.line, character: token.character + token.text.length };
        const hover = await instance.hover({ document: revision, position: start });
        const contents = hover ? JSON.stringify(hover.contents) : "";
        if (category === "version-branch" && hover && !contents.includes(token.text)) {
          gaps.push(`${where}: ${category} hovers something else ${contents.slice(0, 80)}`);
        }
        if (category === "keyword" && hover) {
          gaps.push(`${where}: keyword hovers ${contents.slice(0, 80)}`);
        }
        if (category === "declaration" || category === "reference" || category === "member") {
          if (!contents.includes(token.text)) {
            gaps.push(`${where}: hover ${hover ? `lacks its name: ${contents.slice(0, 80)}` : "missing"}`);
          } else if (category !== "member") {
            // Ownership: the hover names the source the symbol actually comes from.
            const user = symbolAtPosition(analysis, start);
            // Hook parameters (mainImage, mainVertex) document their role instead.
            const owner = user ? /Declared in this shader|entry point|lower-left|hook|Mutable/
              : commonNames.has(token.text) ? /Shader Studio Common/
                : uniformNames.has(token.text) ? /custom uniform/
                  : resourceNames.has(token.text) ? /resource|channel/i
                    : intrinsicNames.has(token.text) ? new RegExp(`${token.text}\\(|${token.text}\\b`)
                      : undefined;
            if (owner && !owner.test(contents)) {
              gaps.push(`${where}: hover names the wrong owner: ${contents.slice(0, 100)}`);
            }
          }
        }
        if (category === "reference") {
          const labels = (await instance.completion({ document: revision, position: end })).map((item) => item.label);
          if (!labels.includes(token.text)) {
            gaps.push(`${where}: completion lacks it`);
          }
        }
        if (category === "member") {
          const labels = (await instance.completion({ document: revision, position: start })).map((item) => item.label);
          const permutation = /^(?:[xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})$/.test(token.text) && !GLSL_OFFERED_SWIZZLES.has(token.text);
          const expected = permutation ? token.text[0]! : token.text;
          if (!labels.includes(expected)) {
            gaps.push(`${where}: member completion lacks ${expected} (${labels.length} items)`);
          }
        }
        if (tokens[index + 1]?.text === "(" && (category === "reference" || category === "builtin-type")) {
          const constructor = category === "builtin-type" || structNames.has(token.text);
          for (const [argument, position] of glslArgumentPositions(tokens, index + 1).entries()) {
            countSite(constructor ? "constructor-argument" : "call-argument");
            const help = await instance.signatureHelp({ document: revision, position });
            if (constructor) {
              if (help) {
                gaps.push(`${where}: constructor has signature help`);
              }
              continue;
            }
            const active = help?.signatures[help.activeSignature ?? 0];
            const fitting = help?.signatures.some((signature) => signatureArity(signature.label) > argument);
            if (!active?.label.includes(`${token.text}(`) || help!.activeParameter !== argument) {
              gaps.push(`${where}: argument ${argument} signature ${help ? `${active?.label} @${help.activeParameter}` : "missing"}`);
            } else if (fitting && signatureArity(active.label) <= argument) {
              gaps.push(`${where}: argument ${argument} active overload is too short: ${active.label}`);
            }
          }
        }
      }
      expect(gaps, label).toEqual([]);
    },
    // A whole-document sweep: ich_glsl alone takes about 4.9s against Vitest's
    // 5s default, so use the same limit as the Slang sweep.
    120_000,
  );

  it("visited every mirror document and every site category", () => {
    expect([...glslSweptDocs].sort()).toEqual(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`).sort());
    expect(Object.fromEntries(glslSweepTotals)).toMatchObject({
      declaration: expect.any(Number), reference: expect.any(Number), member: expect.any(Number),
      keyword: expect.any(Number), "builtin-type": expect.any(Number), "call-argument": expect.any(Number),
      "constructor-argument": expect.any(Number), preprocessor: expect.any(Number),
    });
    expect(glslSweepTotals.get("version-branch")).toBeGreaterThan(0);
    expect(glslSweepTotals.get("declaration")).toBeGreaterThan(200);
    expect(glslSweepTotals.get("reference")).toBeGreaterThan(500);
    expect(glslSweepTotals.get("member")).toBeGreaterThan(100);
    expect(glslSweepTotals.get("call-argument")).toBeGreaterThan(300);
  });
});
