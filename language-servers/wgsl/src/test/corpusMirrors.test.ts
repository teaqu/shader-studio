import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stageForPass } from "@shader-studio/types";
import { parseWgslDocument } from "@shader-studio/wgsl-analysis";
import { WgslLanguageService } from "../WgslLanguageService";

/**
 * Language-service coverage over every WGSL corpus mirror
 * (tests/fixtures/shader-corpus/wgsl). Each document opens
 * with the environment the extension would build from its sibling config —
 * stage, channel resources, script uniforms, common file — and asserts:
 * zero parser diagnostics, working hover on the entry point (plus "Common"
 * provenance for common helpers), and a working completion list.
 * A dedicated case pins tooltip docs for the exotic builtins exercised by
 * intellisense.wgsl, and a negative case proves the diagnostic assertions
 * are not vacuous.
 */
const CORPUS = normalize(join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "tests", "fixtures", "shader-corpus", "wgsl",
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

const resolveRef = (configAbs: string, value: string): string => {
  if (value.startsWith("@/")) throw new Error(`unexpected @/ ref in wgsl config: ${value}`);
  return normalize(join(dirname(configAbs), value));
};

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

// First whole-word `needle` occurrence in code (comments stripped, lines
// preserved). Word boundaries keep `mix` from matching `mixed`, and accept
// generic calls like `bitcast<u32>(x)` as well as plain `frexp(`.
const findWord = (text: string, needle: string, occurrence = 0) => {
  const pattern = new RegExp(`\\b${needle}\\b`);
  let seen = 0;
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const code = lines[line]!.split("//")[0]!;
    const match = pattern.exec(code);
    if (match && match.index !== undefined) {
      // Occurrence counting across lines is overkill here; first hit wins
      // unless the caller asks for a later one via repeated single hits.
      if (seen === occurrence) return { line, character: match.index };
      seen++;
    }
  }
  return null;
};

const firstFn = (text: string): string | null => /fn\s+([A-Za-z_]\w*)\s*\(/.exec(text)?.[1] ?? null;

// First common helper the document actually references (whole word, comments
// stripped); undefined when the doc never names one (e.g. pure blur passes).
const referencedHelper = (docText: string, commonText: string): string | undefined => {
  const names = [...commonText.matchAll(/fn\s+([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]!);
  return names.find((name) => new RegExp(`\\b${name}\\b`).test(
    docText.split("\n").map((line) => line.split("//")[0]).join("\n"),
  ));
};
const firstComputeEntry = (text: string): string | null =>
  /@compute[^\n]*\nfn\s+([A-Za-z_]\w*)\s*\(/.exec(text)?.[1] ?? null;

let generation = 0;

async function openMirror(rel: string, text: string, opts: {
  stage: "fragment" | "vertex" | "compute";
  passName: string;
  resources: { name: string; kind: "texture-2d" | "texture-cube" | "storage"; elementType?: string }[];
  customUniforms: { name: string; type: "float" | "vec2" | "vec3" | "vec4" | "bool" }[];
  commonFile?: { uri: string; text: string; version: number };
}) {
  const uri = `file:///corpus/${rel}`;
  const instance = new WgslLanguageService();
  const gen = ++generation;
  await instance.syncEnvironment({
    documentUri: uri,
    languageId: "wgsl",
    generation: gen,
    passName: opts.passName,
    stage: opts.stage,
    customUniforms: opts.customUniforms,
    resources: opts.resources,
    ...(opts.commonFile ? { commonFile: opts.commonFile } : {}),
    virtualFiles: [],
  });
  await instance.openDocument({ uri, languageId: "wgsl", version: 1, text });
  const revision = { uri, languageId: "wgsl" as const, version: 1, environmentGeneration: gen };
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
  resources: { name: string; kind: "texture-2d" | "texture-cube" | "storage"; elementType?: string }[];
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
    const commonRel = passes.common?.path ? normalize(join(dir, passes.common.path)) : undefined;
    const commonText = commonRel && existsSync(join(CORPUS, commonRel))
      ? readFileSync(join(CORPUS, commonRel), "utf8")
      : undefined;
    const commonFile = commonRel && commonText !== undefined
      ? { uri: `file:///corpus/${commonRel}`, text: commonText, version: 1 }
      : undefined;
    const resourcesFor = (pass?: ShaPass) => [
      ...Object.entries(pass?.inputs ?? {}).map(([key, inp]) => ({
        name: key,
        kind: (inp.type === "cubemap" ? "texture-cube" : "texture-2d") as "texture-2d" | "texture-cube",
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
      const fileRel = pass.path ? normalize(join(dir, pass.path)) : join(dir, `${stem}.wgsl`);
      if (!existsSync(join(CORPUS, fileRel))) continue;
      const text = readFileSync(join(CORPUS, fileRel), "utf8");
      const stage = stageForPass(cfg as never, passName, fileRel);
      const entry = stage === "compute"
        ? pass.entryPoint ?? firstComputeEntry(text) ?? firstFn(text) ?? "main"
        : firstFn(text) ?? "mainImage";
      docs.push({
        configRel, pass: passName, fileRel, text, stage, entry,
        resources: resourcesFor(pass), customUniforms: uniforms, commonFile,
        commonHelper: commonFile ? referencedHelper(text, commonFile.text) : undefined,
      });
      if (typeof pass.vertex === "string") {
        const vertRel = normalize(join(dir, pass.vertex));
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
  for (const standalone of ["shadertoy.wgsl", "parity/pixel-inspector/gradient.wgsl"]) {
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

describe("WGSL corpus mirrors in the language service", () => {
  it(`opens every mirror document (${DOCS.length} across all configs)`, () => {
    expect(DOCS.length).toBeGreaterThan(100);
  });

  it.each(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`))(
    "parses cleanly and hovers its entry point: %s",
    async (label) => {
      const doc = DOCS.find((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})` === label)!;
      const stage = doc.stage as "fragment" | "vertex" | "compute";
      const parsed = parseWgslDocument(doc.fileRel, doc.text, stage);
      expect(parsed.parsedSuccessfully).toBe(true);
      expect(parsed.diagnostics).toEqual([]);
      const { hoverText } = await openMirror(doc.fileRel, doc.text, {
        stage, passName: doc.pass, resources: doc.resources,
        customUniforms: doc.customUniforms, commonFile: doc.commonFile,
      });
      const hover = await hoverText(doc.entry);
      expect(hover, `${label}: no hover for ${doc.entry}`).not.toBeNull();
      expect(hover).toContain(doc.entry);
      if (doc.commonHelper) {
        const commonHover = await hoverText(doc.commonHelper);
        expect(commonHover, `${label}: no Common hover for ${doc.commonHelper}`).not.toBeNull();
        expect(commonHover).toContain("Common");
      }
    },
  );

  it("documents every exotic builtin used by intellisense.wgsl", async () => {
    const doc = DOCS.find((d) => d.fileRel === "intellisense.wgsl" && d.pass === "Image")!;
    const { hoverText } = await openMirror(doc.fileRel, doc.text, {
      stage: "fragment", passName: doc.pass, resources: doc.resources,
      customUniforms: doc.customUniforms, commonFile: doc.commonFile,
    });
    const builtins = [
      "frexp", "modf", "ldexp", "quantizeToF16",
      "pack2x16float", "unpack2x16float", "pack2x16snorm", "unpack2x16snorm",
      "pack4x8snorm", "unpack4x8snorm", "pack2x16unorm", "unpack2x16unorm",
      "pack4x8unorm", "unpack4x8unorm", "countOneBits", "firstLeadingBit",
      "firstTrailingBit", "reverseBits", "bitcast", "dpdx", "dpdy", "fwidth",
      "determinant", "transpose",
    ];
    for (const name of builtins) {
      const hover = await hoverText(name);
      expect(hover, `no tooltip for ${name}`).not.toBeNull();
      expect(hover).toContain(name);
    }
  });

  it("completes channel resources in a configured image pass", async () => {
    const doc = DOCS.find((d) => d.fileRel === "flow.wgsl" && d.pass === "Image")!;
    const { instance, revision } = await openMirror(doc.fileRel, doc.text, {
      stage: "fragment", passName: doc.pass, resources: doc.resources,
      customUniforms: doc.customUniforms, commonFile: doc.commonFile,
    });
    const lines = doc.text.split("\n");
    const line = lines.findIndex((l) => l.includes("palette(") && !l.trim().startsWith("//"));
    const items = await instance.completion({
      document: revision,
      position: { line, character: lines[line]!.indexOf("palette(") },
    });
    expect(Array.isArray(items)).toBe(true);
    expect(items.map((item) => item.label)).toContain("iChannel0");
  });

  it("still reports diagnostics on broken input (assertions above are not vacuous)", () => {
    const broken = parseWgslDocument(
      "broken.wgsl",
      "var<private> exposure: f32 = 1.0;\nfn shade(c: vec3f) -> vec3f {\n  var x: f32 = c.x;",
      "fragment",
    );
    expect(broken.parsedSuccessfully).toBe(false);
    expect(broken.diagnostics.length).toBeGreaterThan(0);
  });
});
