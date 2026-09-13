import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildWgslChannelAuthoringSource, stageForPass } from "@shader-studio/types";
import { swizzleSelections } from "@shader-studio/language-server-core";
import { parseWgslDocument, tokenizeWgsl, type WgslToken } from "@shader-studio/wgsl-analysis";
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
    if (e.isDirectory()) {
      walkConfigs(p, out);
    } else if (e.name.endsWith(".sha.json")) {
      out.push(p);
    }
  }
  return out.sort();
};

const resolveRef = (configAbs: string, value: string): string => {
  if (value.startsWith("@/")) {
    throw new Error(`unexpected @/ ref in wgsl config: ${value}`);
  }
  return normalize(join(dirname(configAbs), value));
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

// First whole-word `needle` occurrence in code (comments stripped, lines
// preserved). Word boundaries keep `mix` from matching `mixed`, and accept
// generic calls like `bitcast<u32>(x)` as well as plain `frexp(`.
const findWord = (text: string, needle: string, occurrence = 0) => {
  const pattern = new RegExp(`\\b${needle}\\b`);
  let seen = 0;
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    // Attribute names (`@compute`) are syntax, not the symbol of the same name.
    const code = lines[line]!.split("//")[0]!.replace(/@\s*[A-Za-z_]\w*/g, (attribute) => " ".repeat(attribute.length));
    const match = pattern.exec(code);
    if (match && match.index !== undefined) {
      // Occurrence counting across lines is overkill here; first hit wins
      // unless the caller asks for a later one via repeated single hits.
      if (seen === occurrence) {
        return { line, character: match.index };
      }
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
  resources: { name: string; kind: "texture-2d" | "texture-cube" | "storage"; elementType?: string }[];
  customUniforms: { name: string; type: "float" | "vec2" | "vec3" | "vec4" | "bool" }[];
  commonFile?: { uri: string; text: string; version: number };
  commonHelper?: string;
  /** Names Common can only reach through the passes that prepend it, such as their channel helpers. */
  passSuppliedNames?: readonly string[];
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
        const passInputs = Object.entries(passes).filter(([name]) => name !== "common")
          .flatMap(([, pass]) => resourcesFor(pass)).filter((resource) => resource.kind !== "storage");
        const generated = parseWgslDocument("generated.wgsl", buildWgslChannelAuthoringSource(
          passInputs.map((resource, slot) => ({ name: resource.name, kind: resource.kind as "texture-2d" | "texture-cube", slot })), true,
        ), "fragment");
        docs.push({
          configRel, pass: "common", fileRel: commonRel, text: commonText,
          stage: "fragment", entry: helper, resources: [], customUniforms: uniforms,
          passSuppliedNames: [...passInputs.map((resource) => resource.name), ...generated.symbols
            .filter((symbol) => !generated.hostGlobalIds.has(symbol.id)
              && symbol.scopeId === generated.scopes.find((scope) => scope.parentId === undefined)?.id)
            .map((symbol) => symbol.name)],
        });
      }
    }
    for (const [passName, pass] of Object.entries(passes)) {
      if (passName === "common") {
        continue;
      }
      const fileRel = pass.path ? normalize(join(dir, pass.path)) : join(dir, `${stem}.wgsl`);
      if (!existsSync(join(CORPUS, fileRel))) {
        continue;
      }
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

  it.each(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`))(
    "reports no language-service errors on valid corpus source: %s",
    async (label) => {
      const doc = DOCS.find((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})` === label)!;
      const { instance, revision } = await openMirror(doc.fileRel, doc.text, {
        stage: doc.stage, passName: doc.pass, resources: doc.resources,
        customUniforms: doc.customUniforms, commonFile: doc.commonFile,
      });
      const errors = (await instance.diagnostics({ document: revision })).filter((item) => item.severity === 1);
      expect(errors.map((item) => `${item.range.start.line + 1}: ${item.message}`)).toEqual([]);
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

/**
 * Every identifier token an author wrote, classified by what the language
 * service should do there. Declarations and references must hover with their
 * own name; references must also complete; member selections must complete
 * from their owner's type; calls to functions must show signature help at
 * each argument. Positions with no expected result are explicit categories
 * rather than silent skips.
 */
type SiteCategory =
  | "declaration" | "reference" | "member"
  // Builtin values such as `global_invocation_id` may hover their documentation.
  | "attribute-argument"
  // No result expected: WGSL syntax rather than a symbol.
  | "attribute-name" | "directive" | "predeclared-type" | "template-enumerant";

const PREDECLARED_TYPE = /^(?:bool|f16|f32|i32|u32|vec[234][fhiu]?|mat[234]x[234][fh]?|array|atomic|ptr|sampler|sampler_comparison|texture_\w+)$/;
const TEMPLATE_ENUMERANTS = new Set([
  "function", "private", "storage", "uniform", "workgroup", "read", "write", "read_write",
  "rgba8unorm", "rgba8snorm", "rgba8uint", "rgba8sint", "rgba16float", "rgba32float", "r32float", "rg32float", "bgra8unorm",
]);

interface Site {
  readonly token: WgslToken;
  readonly index: number;
  readonly category: SiteCategory;
}

function classifySites(text: string, stage: "fragment" | "vertex" | "compute"): { tokens: WgslToken[]; sites: Site[] } {
  const tokens = tokenizeWgsl(text);
  const declarations = new Set(parseWgslDocument("sweep.wgsl", text, stage).symbols
    .map((symbol) => `${symbol.declaration.start.line}:${symbol.declaration.start.character}`));
  const inAttribute = new Set<number>();
  const inDirective = new Set<number>();
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.kind === "attribute" && tokens[index + 2]?.text === "(") {
      for (let depth = 0, cursor = index + 2; cursor < tokens.length; cursor++) {
        depth += tokens[cursor]!.text === "(" ? 1 : tokens[cursor]!.text === ")" ? -1 : 0;
        inAttribute.add(cursor);
        if (depth === 0) {
          break;
        }
      }
    }
    if (["enable", "requires", "diagnostic"].includes(tokens[index]!.text) && tokens[index - 1]?.kind !== "attribute") {
      for (let cursor = index + 1; cursor < tokens.length && tokens[cursor]!.text !== ";"; cursor++) {
        inDirective.add(cursor);
      }
    }
  }
  const sites: Site[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== "identifier") {
      return;
    }
    const category: SiteCategory = tokens[index - 1]?.kind === "attribute" ? "attribute-name"
      : inAttribute.has(index) ? "attribute-argument"
        : inDirective.has(index) ? "directive"
          : tokens[index - 1]?.text === "." ? "member"
            : declarations.has(`${token.line}:${token.character}`) ? "declaration"
              : TEMPLATE_ENUMERANTS.has(token.text) ? "template-enumerant"
                : PREDECLARED_TYPE.test(token.text) ? "predeclared-type"
                  : "reference";
    sites.push({ token, index, category });
  });
  return { tokens, sites };
}

/** The identifier a member chain starts from, such as `iChannel0Sample` in `iChannel0Sample(uv).rgb`. */
function memberRoot(tokens: readonly WgslToken[], index: number): string | undefined {
  let cursor = index - 2;
  for (;;) {
    const close = tokens[cursor]?.text;
    if (close === ")" || close === "]") {
      const open = close === ")" ? "(" : "[";
      for (let depth = 0; cursor >= 0; cursor--) {
        depth += tokens[cursor]!.text === close ? 1 : tokens[cursor]!.text === open ? -1 : 0;
        if (depth === 0) {
          break;
        }
      }
      cursor -= 1;
      continue;
    }
    if (tokens[cursor]?.kind !== "identifier") {
      return undefined;
    }
    if (tokens[cursor - 1]?.text !== ".") {
      return tokens[cursor]!.text;
    }
    cursor -= 2;
  }
}

/** Swizzles core offers: components and prefix runs, not every permutation such as `yx` or `xyx`. */
const OFFERED_SWIZZLES = new Set(swizzleSelections(4, ["xyzw", "rgba"]));

/** Argument start positions of the call whose `(` is at `open`, stopping at the matching `)`. */
function argumentPositions(tokens: readonly WgslToken[], open: number): { line: number; character: number }[] {
  const positions = [{ line: tokens[open]!.line, character: tokens[open]!.character + 1 }];
  let depth = 0;
  for (let cursor = open; cursor < tokens.length; cursor++) {
    const text = tokens[cursor]!.text;
    if (text === "(" || text === "[") {
      depth += 1;
    } else if (text === ")" || text === "]") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    } else if (text === "," && depth === 1 && tokens[cursor + 1]?.text !== ")") {
      positions.push({ line: tokens[cursor]!.line, character: tokens[cursor]!.character + 1 });
    }
  }
  return positions;
}

describe("WGSL corpus mirrors: authored identifier sweep", () => {
  it.each(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`))(
    "hovers, completes, and signs every authored identifier: %s",
    async (label) => {
      const doc = DOCS.find((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})` === label)!;
      const { instance, revision } = await openMirror(doc.fileRel, doc.text, {
        stage: doc.stage, passName: doc.pass, resources: doc.resources,
        customUniforms: doc.customUniforms, commonFile: doc.commonFile,
      });
      const { tokens, sites } = classifySites(doc.text, doc.stage);
      const analysis = parseWgslDocument(doc.fileRel, doc.text, doc.stage);
      const commonAnalysis = doc.commonFile ? parseWgslDocument(doc.commonFile.uri, doc.commonFile.text, doc.stage) : undefined;
      const structNames = new Set([...analysis.symbols, ...(commonAnalysis?.symbols ?? [])]
        .filter((symbol) => symbol.kind === "type" && symbol.typeName === undefined).map((symbol) => symbol.name));
      const passSupplied = new Set(doc.passSuppliedNames ?? []);
      const commonNames = new Set(commonAnalysis?.symbols.map((symbol) => symbol.name) ?? []);
      const documentGlobals = new Set(analysis.symbols.map((symbol) => symbol.name));
      const gaps: string[] = [];
      wgslSweptDocs.add(label);
      for (const { token, index, category } of sites) {
        countWgslSite(passSupplied.has(category === "member" ? memberRoot(tokens, index) ?? "" : token.text) ? "pass-supplied" : category);
        const where = `${token.line + 1}:${token.character + 1} ${category} '${token.text}'`;
        const start = { line: token.line, character: token.character };
        const end = { line: token.line, character: token.character + token.text.length };
        const hover = await instance.hover({ document: revision, position: start });
        const contents = hover ? JSON.stringify(hover.contents) : "";
        const suppliedByPass = passSupplied.has(category === "member" ? memberRoot(tokens, index) ?? "" : token.text);
        if (suppliedByPass) {
          // Common cannot know which pass supplies these; every answer must be empty.
          const labels = (await instance.completion({ document: revision, position: category === "member" ? start : end })).map((item) => item.label);
          if (hover || (category === "member" ? labels.length > 0 : labels.includes(token.text))) {
            gaps.push(`${where}: pass-supplied name has a result`);
          }
          continue;
        }
        if (category === "declaration" || category === "reference" || category === "member") {
          if (!contents.includes(token.text)) {
            gaps.push(`${where}: hover ${hover ? `lacks its name: ${contents.slice(0, 80)}` : "missing"}`);
          } else if (category !== "member") {
            // Ownership: a Common helper says so; a document symbol does not claim Common.
            // Hook parameters (mainImage, mainVertex) document their role instead.
            const owner = documentGlobals.has(token.text) ? /Declared in this shader|entry point|lower-left|hook|Mutable/
              : commonNames.has(token.text) ? /Shader Studio Common/ : undefined;
            if (owner && !owner.test(contents) && !/Component selection|Field of/.test(contents)) {
              gaps.push(`${where}: hover names the wrong owner: ${contents.slice(0, 100)}`);
            }
          }
        } else if (category === "attribute-argument") {
          if (hover && (!contents.includes(token.text) || contents.includes("Declared in"))) {
            gaps.push(`${where}: attribute argument hovers an authored symbol: ${contents.slice(0, 80)}`);
          }
        } else if (hover && category !== "predeclared-type") {
          gaps.push(`${where}: unexpected hover ${contents.slice(0, 80)}`);
        }
        if (category === "reference") {
          const labels = (await instance.completion({ document: revision, position: end })).map((item) => item.label);
          if (!labels.includes(token.text)) {
            gaps.push(`${where}: completion lacks it`);
          }
        }
        if (category === "member") {
          const labels = (await instance.completion({ document: revision, position: start })).map((item) => item.label);
          const permutation = /^(?:[xyzw]{1,4}|[rgba]{1,4})$/.test(token.text) && !OFFERED_SWIZZLES.has(token.text);
          // A permutation is valid WGSL but outside the offered runs: its owner must still resolve.
          const expected = permutation ? token.text[0]! : token.text;
          if (!labels.includes(expected)) {
            gaps.push(`${where}: member completion lacks ${expected} (${labels.length} items)`);
          }
        }
        const isCall = tokens[index + 1]?.text === "(";
        if (isCall && (category === "reference" || category === "predeclared-type")) {
          const constructor = category === "predeclared-type" || structNames.has(token.text);
          for (const [argument, position] of argumentPositions(tokens, index + 1).entries()) {
            countWgslSite(constructor ? "constructor-argument" : "call-argument");
            const help = await instance.signatureHelp({ document: revision, position });
            if (constructor) {
              if (help) {
                gaps.push(`${where}: constructor has signature help`);
              }
            } else if (!help?.signatures[help.activeSignature ?? 0]?.label.includes(`fn ${token.text}(`) || help.activeParameter !== argument) {
              gaps.push(`${where}: argument ${argument} signature ${help ? `${help.signatures[0]?.label} @${help.activeParameter}` : "missing"}`);
            }
          }
        }
      }
      expect(gaps, label).toEqual([]);
    },
  );

  it("visited every mirror document and every site category", () => {
    expect([...wgslSweptDocs].sort()).toEqual(DOCS.map((d) => `${d.configRel} :: ${d.pass} (${d.fileRel})`).sort());
    const totals = Object.fromEntries(wgslSweepTotals);
    // No WGSL corpus file uses enable/requires/diagnostic directives, so the
    // directive category is covered by parser tests rather than this guard.
    for (const category of ["declaration", "reference", "member", "attribute-name", "attribute-argument", "predeclared-type", "template-enumerant", "pass-supplied", "call-argument", "constructor-argument"]) {
      expect(totals[category] ?? 0, `${category} in ${JSON.stringify(totals)}`).toBeGreaterThan(0);
    }
    expect(wgslSweepTotals.get("declaration")).toBeGreaterThan(400);
    expect(wgslSweepTotals.get("reference")).toBeGreaterThan(800);
    expect(wgslSweepTotals.get("member")).toBeGreaterThan(300);
    expect(wgslSweepTotals.get("call-argument")).toBeGreaterThan(500);
  });
});

const wgslSweepTotals = new Map<string, number>();
const wgslSweptDocs = new Set<string>();
const countWgslSite = (key: string) => wgslSweepTotals.set(key, (wgslSweepTotals.get(key) ?? 0) + 1);
