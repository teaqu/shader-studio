import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { stageForPass } from "@shader-studio/types";
import createSlangModule from "../../../../ui/src/slang/slang-wasm.js";
import { SlangLanguageService } from "../SlangLanguageService";
import {
  collectSlangDependencies,
  resolveSlangIncludes,
} from "../../../../utils/src/slang-dependency-graph";

/**
 * Language-service coverage over every Slang corpus mirror
 * (tests/fixtures/shader-corpus/slang), through the real bundled WASM
 * language server. Each document opens with the environment the extension
 * would build from its sibling config — stage, channel resources (every
 * input maps to a texture kind with a slot, exactly like
 * ShaderAuthoringEnvironmentProvider.resourcesFor), script uniforms, common
 * file, and virtual files resolved with the same SlangDependencyGraph the
 * provider uses — and asserts: zero diagnostics (except the documented
 * invalid-version negative), working hover on the entry point, and working
 * channel-member completion on a real corpus file.
 *
 * Documents use real file:// URIs (not synthetic corpus URIs) because the
 * server resolves sibling imports against document paths, exactly like the
 * extension. `test.hlsl` is excluded: it is a generated HLSL snapshot with
 * no config and no entry point, never opened by the extension.
 */
const CORPUS = normalize(join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "tests", "fixtures", "shader-corpus", "slang",
));
const CORPUS_ROOT = dirname(CORPUS);

interface ShaInput { type?: string; source?: string }
interface ShaPass {
  type?: string;
  path?: string;
  vertex?: string;
  entryPoint?: string;
  outputLayers?: number;
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

// Workspace-anchored `@/` refs resolve from the corpus root; everything
// else resolves relative to the owning config, like the extension loader.
const resolveRef = (configAbs: string, value: string): string => {
  if (value.startsWith("@/")) {
    return normalize(relative(CORPUS, join(CORPUS_ROOT, value.slice("@/".length))));
  }
  return normalize(relative(CORPUS, join(dirname(configAbs), value)));
};

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

// First whole-word `needle` occurrence in code (line comments stripped,
// lines preserved).
const findWord = (text: string, needle: string, occurrence = 0) => {
  const pattern = new RegExp(`\\b${needle}\\b`);
  let seen = 0;
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const code = lines[line]!.split("//")[0]!;
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

const FN_KEYWORDS = new Set(["if", "for", "while", "switch", "return", "sizeof"]);

// First function definition in a Slang source, skipping imports, attributes,
// preprocessor lines, and struct/interface declarations.
const firstSlangFn = (text: string): string | null => {
  for (const raw of text.split("\n")) {
    const line = raw.split("//")[0]!;
    if (/^\s*(import|module|struct|interface|__exported|#|\[)/.test(line)) {
      continue;
    }
    const match = /^\s*(?:[\w:<>\[\],*&?!\s]+?)\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (match?.[1] && !FN_KEYWORDS.has(match[1])) {
      return match[1];
    }
  }
  return null;
};

// First common function the document actually references (whole word,
// comments stripped); undefined when the doc never names one.
const referencedHelper = (docText: string, commonText: string): string | undefined => {
  const names: string[] = [];
  for (const raw of commonText.split("\n")) {
    const line = raw.split("//")[0]!;
    if (/^\s*(import|module|struct|interface|__exported|#|\[)/.test(line)) {
      continue;
    }
    const match = /^\s*(?:[\w:<>\[\],*&?!\s]+?)\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (match?.[1] && !FN_KEYWORDS.has(match[1]) && !names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  const doc = docText.split("\n").map((line) => line.split("//")[0]).join("\n");
  return names.find((name) => new RegExp(`\\b${name}\\b`).test(doc));
};

const readSource = (absPath: string): string | null => {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
};

interface MirrorDoc {
  configRel: string;
  pass: string;
  fileRel: string;
  text: string;
  stage: "fragment" | "vertex" | "compute";
  entry: string;
  resources: { name: string; kind: "texture-2d" | "texture-cube" | "storage"; slot?: number; elementType?: string }[];
  customUniforms: { name: string; type: "float" | "vec2" | "vec3" | "vec4" | "bool" }[];
  outputLayers?: number;
  commonFile?: { rel: string; text: string };
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
    const commonFile = commonRel && commonText !== undefined ? { rel: commonRel, text: commonText } : undefined;
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
    if (commonFile) {
      const helper = firstSlangFn(commonFile.text);
      if (helper) {
        docs.push({
          configRel, pass: "common", fileRel: commonFile.rel, text: commonFile.text,
          stage: "fragment", entry: helper, resources: [], customUniforms: uniforms,
        });
      }
    }
    for (const [passName, pass] of Object.entries(passes)) {
      if (passName === "common") {
        continue;
      }
      const fileRel = pass.path ? resolveRef(configAbs, pass.path) : join(dir, `${stem}.slang`);
      if (!existsSync(join(CORPUS, fileRel))) {
        continue;
      }
      const text = readFileSync(join(CORPUS, fileRel), "utf8");
      const stage = stageForPass(cfg as never, passName, fileRel);
      const entry = pass.entryPoint ?? firstSlangFn(text) ?? "mainImage";
      docs.push({
        configRel, pass: passName, fileRel, text, stage, entry,
        resources: resourcesFor(pass), customUniforms: uniforms,
        ...(stage === "compute" ? { outputLayers: pass.outputLayers ?? 1 } : {}),
        ...(commonFile ? { commonFile } : {}),
        commonHelper: commonFile ? referencedHelper(text, commonFile.text) : undefined,
      });
      if (typeof pass.vertex === "string") {
        const vertRel = resolveRef(configAbs, pass.vertex);
        if (existsSync(join(CORPUS, vertRel))) {
          const vertText = readFileSync(join(CORPUS, vertRel), "utf8");
          docs.push({
            configRel, pass: passName, fileRel: vertRel, text: vertText,
            stage: "vertex", entry: "mainVertex",
            resources: resourcesFor(pass), customUniforms: uniforms,
            ...(commonFile ? { commonFile } : {}),
          });
        }
      }
    }
  }
  // Config-less sanity shader, opened with an empty environment.
  const standalone = "parity/pixel-inspector/gradient.slang";
  if (existsSync(join(CORPUS, standalone))) {
    docs.push({
      configRel: "(none)", pass: "Image", fileRel: standalone,
      text: readFileSync(join(CORPUS, standalone), "utf8"),
      stage: "fragment", entry: "mainImage", resources: [], customUniforms: [],
    });
  }
  return docs;
};

const DOCS = collectDocs();

let service!: SlangLanguageService;
let generation = 0;
const seenVirtualUris: string[] = [];
const dependencyErrors: { importer: string; message: string }[] = [];

// Virtual files exactly the way the provider builds them: module imports
// plus includes, resolved from disk with the shared dependency graph.
function virtualsFor(absPath: string, text: string, passName: string) {
  const out = new Map<string, { uri: string; text: string; version: number }>();
  const { modules, errors } = collectSlangDependencies({ rootPath: absPath, rootSource: text, ownerPass: passName, readSource });
  for (const error of errors) {
    dependencyErrors.push({ importer: error.importerPath, message: error.message });
  }
  for (const module of modules) {
    out.set(module.path, { uri: pathToFileURL(module.path).toString(), text: module.source, version: 1 });
  }
  const { includedPaths } = resolveSlangIncludes(text, absPath, readSource);
  for (const included of includedPaths) {
    const includedText = readSource(included);
    if (includedText !== null) {
      out.set(included, { uri: pathToFileURL(included).toString(), text: includedText, version: 1 });
    }
  }
  return [...out.values()];
}

async function openMirror(doc: MirrorDoc) {
  const absPath = join(CORPUS, doc.fileRel);
  const uri = pathToFileURL(absPath).toString();
  const gen = ++generation;
  const virtualFiles = [
    ...virtualsFor(absPath, doc.text, doc.pass),
    ...(doc.commonFile ? virtualsFor(join(CORPUS, doc.commonFile.rel), doc.commonFile.text, "common") : []),
  ];
  seenVirtualUris.push(...virtualFiles.map((file) => file.uri));
  await service.syncEnvironment({
    documentUri: uri,
    languageId: "slang",
    generation: gen,
    passName: doc.pass,
    stage: doc.stage,
    ...(doc.outputLayers !== undefined ? { outputLayers: doc.outputLayers } : {}),
    customUniforms: doc.customUniforms,
    resources: doc.resources,
    ...(doc.commonFile
      ? { commonFile: { uri: pathToFileURL(join(CORPUS, doc.commonFile.rel)).toString(), text: doc.commonFile.text, version: 1 } }
      : {}),
    virtualFiles,
  });
  await service.openDocument({ uri, languageId: "slang", version: 1, text: doc.text });
  const revision = { uri, languageId: "slang" as const, version: 1, environmentGeneration: gen };
  const hoverText = async (needle: string, occurrence = 0): Promise<string | null> => {
    const pos = findWord(doc.text, needle, occurrence);
    if (!pos) {
      return null;
    }
    const hover = await service.hover({ document: revision, position: pos });
    return hover ? JSON.stringify(hover.contents) : null;
  };
  return { revision, hoverText };
}

describe("Slang corpus mirrors in the language service", () => {
  beforeAll(async () => {
    const wasmBinary = readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const module = await createSlangModule({ wasmBinary });
    service = new SlangLanguageService(module);
  }, 120_000);

  afterAll(async () => {
    await service.dispose();
  });

  it(`opens every mirror document (${DOCS.length} across all configs)`, () => {
    expect(DOCS.length).toBeGreaterThan(60);
  });

  it.each(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`))(
    "diagnoses and hovers its entry point: %s",
    async (label) => {
      const doc = DOCS.find((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})` === label)!;
      const { hoverText, revision } = await openMirror(doc);
      const diagnostics = await service.diagnostics({ document: revision });
      // Unused-local hints are advisory by design (Hint, Unnecessary tag);
      // errors and warnings must be clean except for the documented
      // invalid-version negative below.
      const problems = diagnostics.filter((d) => (d.severity ?? 1) <= 2);
      if (doc.fileRel === "foundation/versions/invalid-version/preview.slang") {
        // The corpus's one intentional compile error: the render suite
        // expects /unknown language version '2024'/ from the compiler, and
        // the language server must flag it too.
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.some((d) => /2024/.test(d.message))).toBe(true);
      } else {
        expect(problems, `${label}: unexpected diagnostics ${JSON.stringify(problems.map((d) => d.message))}`).toEqual([]);
      }
      const hover = await hoverText(doc.entry);
      expect(hover, `${label}: no hover for ${doc.entry}`).not.toBeNull();
      expect(hover).toContain(doc.entry);
      if (doc.commonHelper) {
        const commonHover = await hoverText(doc.commonHelper);
        expect(commonHover, `${label}: no hover for common helper ${doc.commonHelper}`).not.toBeNull();
        expect(commonHover).toContain(doc.commonHelper);
      }
    },
    20_000,
  );

  it("resolves every corpus import without host errors", () => {
    expect(dependencyErrors).toEqual([]);
  });

  it("leaves no corpus shader unaccounted for", () => {
    const referenced = new Set([
      ...DOCS.map((d) => normalize(d.fileRel)),
      // Struct-only commons open as context, never as their own document.
      ...DOCS.flatMap((d) => (d.commonFile ? [normalize(d.commonFile.rel)] : [])),
    ]);
    const unreferenced: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
        } else if (e.name.endsWith(".slang")) {
          const rel = normalize(relative(CORPUS, p));
          if (!referenced.has(rel)) {
            unreferenced.push(rel);
          }
        }
      }
    };
    walk(CORPUS);
    const virtualRel = new Set(seenVirtualUris.map((uri) => normalize(relative(CORPUS, fileURLToPath(uri)))));
    const unexplained = unreferenced.filter((rel) => !virtualRel.has(rel) && rel !== "test.hlsl");
    expect(unexplained).toEqual([]);
  });

  it("completes channel members on a real corpus file", async () => {
    const doc = DOCS.find((d) => d.fileRel === "flow.slang" && d.pass === "Image")!;
    const { revision } = await openMirror(doc);
    const lines = doc.text.split("\n");
    const line = lines.findIndex((l) => l.includes("inputs.iChannel0.Sample("));
    expect(line).toBeGreaterThanOrEqual(0);
    const items = await service.completion({
      document: revision,
      position: { line, character: lines[line]!.indexOf("inputs.iChannel0.") + "inputs.iChannel0.".length },
    });
    expect(items.map((item) => item.label)).toEqual(expect.arrayContaining(["Sample", "SampleLevel"]));
  }, 20_000);
});
