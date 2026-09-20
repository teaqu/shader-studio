import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShaderDebugger, SlangDebugEngine, VariableCaptureBuilder, WgslDebugEngine } from "@shader-studio/debug";
import type { DebugAnalysisRequest, ShaderDebugEngine } from "@shader-studio/types";
import projects from "virtual:shader-fixture-corpus";
import {
  createShaderCanvasHarness,
  type ShaderCanvasHarness,
  type ShaderLanguage,
} from "./ShaderCanvasHarness";
import type { CaptureRequest, IVariableCapturer } from "../../capture/VariableCapturer";

const expectedCompileErrors = new Map<string, RegExp>([
  ["slang/foundation/versions/invalid-version/preview.slang", /unknown language version '2024'/],
]);

const slangSpecificRenderProjects = new Set([
  "slang/foundation/includes/include-preview.slang",
  "slang/foundation/modules/import-preview.slang",
  "slang/foundation/versions/invalid-version/preview.slang",
  "slang/foundation/versions/latest/preview.slang",
  "slang/foundation/versions/legacy/preview.slang",
  "slang/foundation/versions/slang-2025/preview.slang",
  "slang/foundation/versions/slang-2026/preview.slang",
  "slang/foundation/versions/version-mismatch/preview.slang",
  "slang/foundation/workspace/foundation.slang",
]);

function expectedCompileError(project: (typeof projects)[number]): RegExp | undefined {
  return expectedCompileErrors.get(project.name);
}

/**
 * Documented compute-replay limits, shared by both plan engines (see compute
 * debugging in docs/features/wgsl-authoring.md). Both replay a compute pass as
 * a fragment shader with read-only storage bindings, and both word the refusal
 * identically after the engine name. A plan that fails ONLY with these
 * diagnostics is pinned as expected, not a failure; anything else fails.
 *
 * Deliberately narrow: storage writes only. Workgroup memory, barriers and
 * subgroup refusals are NOT excused here, so a fixture that starts hitting one
 * fails loudly rather than being absorbed by a wider pattern.
 */
const expectedComputeReplayLimits: RegExp[] = [
  /does not support writes to configured storage/,
];

function mayExceedPortableImageLimit(project: (typeof projects)[number]): boolean {
  const imageInputs = Object.keys(project.config?.passes?.Image?.inputs ?? {}).length;
  return project.language === "glsl" ? imageInputs > 12 : imageInputs > 16;
}

function canvasSize(project: (typeof projects)[number]): number {
  const passes = Object.values(project.config?.passes ?? {});
  const inputs = passes.flatMap((pass) => Object.values(pass?.inputs ?? {}));
  const hasSpatialGeometry = passes.some((pass) =>
    pass && "geometry" in pass && pass.geometry?.type && pass.geometry.type !== "fullscreen");
  const isLargeSimulation = /(?:gravity|particles|two-meshes|fullscreen-vertex)/.test(project.name);
  if (hasSpatialGeometry || isLargeSimulation) {
    return 128;
  }
  if (inputs.some((input) => ["audio", "video", "cubemap"].includes(input.type))) {
    return 96;
  }
  const isSmallContract = /(?:precision|custom-uniforms|versions\/|intellisense|keyboard|test\.)/.test(project.name);
  if (isSmallContract) {
    return 32;
  }
  return 64;
}

function sampleTimes(project: (typeof projects)[number]): number[] {
  const passes = Object.values(project.config?.passes ?? {});
  const hasSpatialGeometry = passes.some((pass) =>
    pass && "geometry" in pass && pass.geometry?.type && pass.geometry.type !== "fullscreen");
  if (hasSpatialGeometry || /(?:two-meshes|fullscreen-vertex)/.test(project.name)) {
    return [1];
  }
  if (/(?:feedback|game-of-life|gravity|particles|repeated-substeps)/.test(project.name)) {
    return [0, 0, 0];
  }
  return [0];
}

function nonBlackPixelCount(bytes: Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 0) {
      count += 1;
    }
  }
  return count;
}

/**
 * A distinctive fill painted before each project. The engine keeps the last
 * frame when a pass draws nothing, and all projects share one engine per
 * language, so without a sentinel a fixture that rasterises no geometry
 * silently inherits the previous fixture's pixels and every output assertion
 * passes vacuously. Ported from the UI transport rig, which asserts full
 * output correctness through the real pipeline; this sweep asserts engine
 * liveness (the project drew something) at the engine layer.
 */
const SENTINEL_RGB: readonly [number, number, number] = [253, 7, 151];

const SENTINEL_SOURCE: Record<ShaderLanguage, string> = {
  glsl: `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(${SENTINEL_RGB.map((c) => (c / 255).toFixed(6)).join(", ")}, 1.0);
}`,
  slang: `float4 mainImage(float2 fragCoord)
{
  return float4(${SENTINEL_RGB.map((c) => (c / 255).toFixed(6)).join(", ")}, 1.0);
}`,
  wgsl: `fn mainImage(coord: vec2f) -> vec4f {
  return vec4f(${SENTINEL_RGB.map((c) => (c / 255).toFixed(6)).join(", ")}, 1.0);
}`,
};

/** True when every pixel is still the sentinel, i.e. the project drew nothing. */
function isUntouched(bytes: Uint8ClampedArray): boolean {
  if (bytes.length === 0) {
    return true;
  }
  for (let offset = 0; offset < bytes.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(bytes[offset + channel]! - SENTINEL_RGB[channel]!) > 2) {
        return false;
      }
    }
  }
  return true;
}

async function paintSentinel(harness: ShaderCanvasHarness, language: ShaderLanguage): Promise<void> {
  await harness.compile({
    path: `/sentinel.${language === "glsl" ? "glsl" : language}`,
    image: SENTINEL_SOURCE[language],
  });
  await harness.renderAndReadRegion(0);
}

/**
 * Fixtures whose rendered center region is intentionally black. The UI transport
 * corpus test proves keyboard and storage fixtures can light up in both languages.
 * Raw-workgroups has a separate workgroup-coverage twin:
 * idle-keyboard 33channels, single-texel raw-workgroups, zeroed-storage
 * storage-edit-colours. Anything not listed must draw a lit pixel.
 */
const knownBlackOutput = new Set<string>([
  "slang/33channels.slang",
  "wgsl/33channels.wgsl",
  "slang/compute-lab/raw-workgroups.slang",
  "wgsl/compute-lab/raw-workgroups.wgsl",
  "slang/compute-lab/storage-edit-colours.slang",
  "wgsl/compute-lab/storage-edit-colours.wgsl",
]);

/** Per-language sweep coverage: how much of the corpus each engine plans. */
interface LanguageTally {
  lines: number;
  inline: number;
  capture: number;
  /** Lines the engine declined to analyse at all — blanks, comments, braces. */
  unanalysed: number;
}

/**
 * Floors pinned to measured coverage with ~5% headroom, like the committed
 * triplet signatures in ui/src/test/e2e/triplet-signatures.ts. Plan counts only
 * rise as the corpus grows, so a drop is a real regression and re-pinning is a
 * deliberate edit. `unanalysed` is a ceiling expressed as a RATIO of that
 * language's lines, so adding fixtures does not force an edit — it exists
 * because an unanalysable line is skipped silently, and a parser regression
 * would otherwise show up as nothing at all.
 *
 * Measured on 12f849ff + Slang compute-replay metadata (2026-09-19):
 *   glsl  1012 lines, 862 inline, 872 capture, 150 unanalysed (0.148)
 *   slang 2302 lines, 885 inline, 1198 capture, 838 unanalysed (0.364)
 *   wgsl  2318 lines, 833 inline, 1153 capture, 916 unanalysed (0.395)
 */
const coverageFloors: Record<ShaderLanguage, {
  lines: number;
  inline: number;
  capture: number;
  unanalysedRatio: number;
}> = {
  glsl: { lines: 960, inline: 818, capture: 828, unanalysedRatio: 0.16 },
  slang: { lines: 2_180, inline: 840, capture: 1_138, unanalysedRatio: 0.39 },
  wgsl: { lines: 2_200, inline: 791, capture: 1_095, unanalysedRatio: 0.42 },
};

interface DebugSweepFailure {
  project: string;
  pass: string;
  line: number;
  stage: "inline" | "capture";
  source: string;
  message: string;
}

function formatDebugSweepFailures(failures: DebugSweepFailure[]): string {
  return failures.map((failure) =>
    `${failure.project} [${failure.pass}] L${failure.line + 1} ${failure.stage}: ${failure.message}\n`
    + `  ${failure.source.trim()}`,
  ).join("\n");
}

function debugSources(project: (typeof projects)[number]): Array<{ pass: string; source: string }> {
  return [
    { pass: "Image", source: project.image },
    ...Object.entries(project.buffers ?? {})
      .filter(([pass]) => !pass.startsWith("__shader_studio_vertex__:"))
      .map(([pass, source]) => ({ pass, source })),
  ];
}

function slangRequest(
  project: (typeof projects)[number],
  pass: string,
  source: string,
  line: number,
): DebugAnalysisRequest {
  const selectedPath = pass === "Image"
    ? project.path ?? `/${project.name}`
    : project.slangSourcePaths?.[pass] ?? `/${project.name}/${pass}.slang`;
  const isCommon = pass === "common";
  const rootPath = isCommon ? project.path ?? `/${project.name}` : selectedPath;
  const rootSource = isCommon ? project.image : source;
  const files = [{
    uri: rootPath,
    path: rootPath,
    source: rootSource,
    version: 1,
    moduleName: "",
    ownerPass: isCommon ? "Image" : pass,
  }];
  if (selectedPath !== rootPath) {
    files.push({
      uri: selectedPath,
      path: selectedPath,
      source,
      version: 1,
      moduleName: "",
      ownerPass: "Image",
    });
  }
  const ownerPass = isCommon ? "Image" : pass;
  const passConfig = project.config?.passes?.[ownerPass];
  const compute = passConfig && "type" in passConfig && passConfig.type === "compute"
    ? {
      ...("entryPoint" in passConfig && passConfig.entryPoint ? { entryPoint: passConfig.entryPoint as string } : {}),
      storageNames: Object.keys(project.config?.storage ?? {}),
    }
    : undefined;
  return {
    workspace: {
      rootUri: rootPath,
      rootPath,
      passName: ownerPass,
      ...(compute ? { compute } : {}),
      contentHash: `${project.name}:${pass}`,
      files,
    },
    sourceUri: selectedPath,
    position: { line, character: Math.max(0, source.split("\n")[line]?.search(/\S/) ?? 0) },
  };
}

/** Resolve a config-relative pass path against the config directory. */
function resolveCorpusPath(configDir: string, rel: string): string {
  const parts: string[] = configDir.split("/");
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

/** Absolute config-side path of a WGSL pass file (Image resolves to the opened shader). */
function wgslPassPath(project: (typeof projects)[number], pass: string): string {
  const configDir = (project.path ?? "/").split("/").slice(0, -1).join("/");
  if (pass === "Image") {
    return project.path ?? `/${project.name}`;
  }
  if (pass === "common") {
    const commonRel = project.config?.passes?.common?.path;
    return commonRel ? resolveCorpusPath(configDir, commonRel) : `/${project.name}/common.wgsl`;
  }
  const passRel = project.config?.passes?.[pass]?.path;
  return passRel ? resolveCorpusPath(configDir, passRel) : `/${project.name}/${pass}.wgsl`;
}

/**
 * WGSL analogue of slangRequest, mirroring WgslDebugStrategy.buildRequest:
 * the root pass file plus the common file when configured, compute replay
 * metadata for compute passes, and the selected file/line as source.
 */
function wgslRequest(
  project: (typeof projects)[number],
  pass: string,
  source: string,
  line: number,
): DebugAnalysisRequest {
  const isCommon = pass === "common";
  const ownerPass = isCommon ? "Image" : pass;
  const rootPath = ownerPass === "Image" ? project.path ?? `/${project.name}` : wgslPassPath(project, ownerPass);
  const rootSource = ownerPass === "Image" ? project.image : source;
  const files = [{
    uri: rootPath,
    path: rootPath,
    source: rootSource,
    version: 1,
    moduleName: "",
    ownerPass,
  }];
  const commonSource = (project.buffers as Record<string, string> | undefined)?.["common"];
  const commonPath = project.config?.passes?.common?.path
    ? wgslPassPath(project, "common")
    : undefined;
  if (commonPath && commonSource !== undefined && commonPath !== rootPath) {
    files.push({
      uri: commonPath,
      path: commonPath,
      source: commonSource,
      version: 1,
      moduleName: "",
      ownerPass,
    });
  }
  const selectedPath = isCommon && commonPath ? commonPath : rootPath;
  const selectedSource = isCommon && commonSource !== undefined ? commonSource : rootSource;
  const passConfig = project.config?.passes?.[ownerPass];
  const compute = passConfig && "type" in passConfig && passConfig.type === "compute"
    ? {
      ...("entryPoint" in passConfig && passConfig.entryPoint ? { entryPoint: passConfig.entryPoint as string } : {}),
      storageNames: Object.keys(project.config?.storage ?? {}),
    }
    : undefined;
  return {
    workspace: {
      rootUri: rootPath,
      rootPath,
      passName: ownerPass,
      ...(compute ? { compute } : {}),
      files,
      contentHash: `${project.name}:${pass}`,
    },
    sourceUri: selectedPath,
    position: { line, character: Math.max(0, selectedSource.split("\n")[line]?.search(/\S/) ?? 0) },
  };
}

function debugPlanKey(request: CaptureRequest): string {
  return request.debugPlan
    ? request.debugPlan.files.map((file) => `${file.uri}\0${file.source}`).join("\0")
    : request.captureShader;
}

describe("slang-multipass-test shader corpus", () => {
  const harnesses = new Map<ShaderLanguage, ShaderCanvasHarness>();
  const diagnosticGlobal = globalThis as typeof globalThis & { __captureDiag?: boolean };
  let previousCaptureDiagnostics: boolean | undefined;

  beforeAll(() => {
    previousCaptureDiagnostics = diagnosticGlobal.__captureDiag;
    diagnosticGlobal.__captureDiag = false;
    harnesses.set("glsl", createShaderCanvasHarness("glsl"));
    harnesses.set("slang", createShaderCanvasHarness("slang"));
    harnesses.set("wgsl", createShaderCanvasHarness("wgsl"));
  });

  afterAll(() => {
    for (const harness of harnesses.values()) {
      harness.dispose();
    }
    if (previousCaptureDiagnostics === undefined) {
      delete diagnosticGlobal.__captureDiag;
    } else {
      diagnosticGlobal.__captureDiag = previousCaptureDiagnostics;
    }
  });

  it("discovers every configured root shader", () => {
    expect(projects).toHaveLength(123);
  });

  it("provides a GLSL counterpart for every portable Slang project", () => {
    const projectsByName = new Map(projects.map((project) => [project.name, project]));
    const portableSlangProjects = projects
      .filter((project) => project.language === "slang")
      .filter((project) => {
        const passes = Object.values(project.config?.passes ?? {});
        return !project.config?.storage && !passes.some((pass) => pass?.type === "compute");
      })
      .filter((project) => !slangSpecificRenderProjects.has(project.name));
    const violations: string[] = [];

    for (const slangProject of portableSlangProjects) {
      const counterpartName = slangProject.name
        .replace(/^slang\//, "glsl/")
        .replace(/\.slang$/, "_glsl.glsl");
      const glslProject = projectsByName.get(counterpartName);
      if (!glslProject) {
        violations.push(`${slangProject.name}: missing ${counterpartName}`);
        continue;
      }
      const slangPasses = slangProject.config?.passes ?? {};
      const glslPasses = glslProject.config?.passes ?? {};
      if (JSON.stringify(Object.keys(slangPasses).sort()) !== JSON.stringify(Object.keys(glslPasses).sort())) {
        violations.push(`${slangProject.name}: pass names differ`);
        continue;
      }
      for (const [passName, slangPass] of Object.entries(slangPasses)) {
        const glslPass = glslPasses[passName];
        const inputContract = (pass: typeof slangPass) => Object.entries(pass?.inputs ?? {})
          .map(([key, input]) => [key, input.type, "source" in input ? input.source : undefined]);
        const geometryType = (pass: typeof slangPass) =>
          pass && "geometry" in pass ? pass.geometry?.type : undefined;
        const contract = (pass: typeof slangPass) => JSON.stringify({
          inputs: inputContract(pass),
          geometry: geometryType(pass),
          path: Boolean(pass && "path" in pass && pass.path),
          vertex: Boolean(pass && "vertex" in pass && pass.vertex),
        });
        if (contract(slangPass) !== contract(glslPass)) {
          violations.push(`${slangProject.name}: ${passName} contract differs`);
        }
        if (glslPass && "path" in glslPass && glslPass.path && !glslPass.path.endsWith(".glsl")) {
          violations.push(`${counterpartName}: ${passName} path is not GLSL`);
        }
        if (glslPass && "vertex" in glslPass && glslPass.vertex && !glslPass.vertex.endsWith(".glsl")) {
          violations.push(`${counterpartName}: ${passName} vertex is not GLSL`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("provides a WGSL counterpart for every portable Slang project", () => {
    const projectsByName = new Map(projects.map((project) => [project.name, project]));
    const portableSlangProjects = projects
      .filter((project) => project.language === "slang")
      .filter((project) => {
        const passes = Object.values(project.config?.passes ?? {});
        return !project.config?.storage && !passes.some((pass) => pass?.type === "compute");
      })
      .filter((project) => !slangSpecificRenderProjects.has(project.name));
    const violations: string[] = [];

    for (const slangProject of portableSlangProjects) {
      const counterpartName = slangProject.name
        .replace(/^slang\//, "wgsl/")
        .replace(/\.slang$/, ".wgsl");
      const wgslProject = projectsByName.get(counterpartName);
      if (!wgslProject) {
        violations.push(`${slangProject.name}: missing ${counterpartName}`);
        continue;
      }
      const slangPasses = slangProject.config?.passes ?? {};
      const wgslPasses = wgslProject.config?.passes ?? {};
      if (JSON.stringify(Object.keys(slangPasses).sort()) !== JSON.stringify(Object.keys(wgslPasses).sort())) {
        violations.push(`${slangProject.name}: pass names differ`);
        continue;
      }
      for (const [passName, slangPass] of Object.entries(slangPasses)) {
        const wgslPass = wgslPasses[passName];
        const inputContract = (pass: typeof slangPass) => Object.entries(pass?.inputs ?? {})
          .map(([key, input]) => [key, input.type, "source" in input ? input.source : undefined]);
        const geometryType = (pass: typeof slangPass) =>
          pass && "geometry" in pass ? pass.geometry?.type : undefined;
        const contract = (pass: typeof slangPass) => JSON.stringify({
          inputs: inputContract(pass),
          geometry: geometryType(pass),
          path: Boolean(pass && "path" in pass && pass.path),
          vertex: Boolean(pass && "vertex" in pass && pass.vertex),
        });
        if (contract(slangPass) !== contract(wgslPass)) {
          violations.push(`${slangProject.name}: ${passName} contract differs`);
        }
        if (wgslPass && "path" in wgslPass && wgslPass.path && !wgslPass.path.endsWith(".wgsl")) {
          violations.push(`${counterpartName}: ${passName} path is not WGSL`);
        }
        if (wgslPass && "vertex" in wgslPass && wgslPass.vertex && !wgslPass.vertex.endsWith(".wgsl")) {
          violations.push(`${counterpartName}: ${passName} vertex is not WGSL`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("assigns feature-appropriate corpus resolutions", () => {
    expect(canvasSize(projects.find((project) => project.name === "glsl/cat-glsl.glsl")!)).toBe(128);
    expect(canvasSize(projects.find((project) => project.name === "slang/video.slang")!)).toBe(96);
    expect(canvasSize(projects.find((project) => project.name === "slang/compute-lab/game-of-life.slang")!)).toBe(64);
    expect(canvasSize(projects.find((project) => project.name === "slang/foundation/versions/latest/preview.slang")!)).toBe(32);
    expect(sampleTimes(projects.find((project) => project.name === "slang/two-meshes.slang")!)).toEqual([1]);
    expect(sampleTimes(projects.find((project) => project.name === "slang/particles.slang")!)).toHaveLength(3);
  });

  it("keeps the paired portable feature-coverage contract comprehensive", () => {
    const slang = projects.find((project) => project.name === "slang/feature-coverage.slang")!;
    const glsl = projects.find((project) => project.name === "glsl/feature-coverage_glsl.glsl")!;
    for (const project of [slang, glsl]) {
      expect(project.config?.script).toBe("uniforms.ts");
      expect(Object.keys(project.config?.passes ?? {}).sort()).toEqual(["BufferA", "Image", "common"]);
      expect(project.config?.passes?.Image?.inputs).toMatchObject({
        patternTex: { type: "texture" },
        historyBuffer: { type: "buffer", source: "BufferA" },
      });
      expect(project.buffers).toHaveProperty("BufferA");
      expect(project.buffers).toHaveProperty("common");
      expect(project.buffers).toHaveProperty("__shader_studio_vertex__:Image");
      for (const featureToken of ["CoverageSample", "weights[3]", "uBool", "uint flags"]) {
        expect(project.image).toContain(featureToken);
      }
    }
    expect(slang.image).toContain("ddx(sample.energy)");
    expect(glsl.image).toContain("dFdx(sampleValue.energy)");
    expect(slang.buffers?.["__shader_studio_vertex__:Image"]).toContain("patternTex.SampleLevel");
    expect(glsl.buffers?.["__shader_studio_vertex__:Image"]).toContain("samplePatternTex");
  });

  it("keeps the WGSL feature-coverage contract comprehensive", () => {
    const wgsl = projects.find((project) => project.name === "wgsl/feature-coverage.wgsl")!;
    expect(wgsl.config?.script).toBe("uniforms.ts");
    expect(Object.keys(wgsl.config?.passes ?? {}).sort()).toEqual(["BufferA", "Image", "common"]);
    expect(wgsl.config?.passes?.Image?.inputs).toMatchObject({
      patternTex: { type: "texture" },
      historyBuffer: { type: "buffer", source: "BufferA" },
    });
    expect(wgsl.buffers).toHaveProperty("BufferA");
    expect(wgsl.buffers).toHaveProperty("common");
    expect(wgsl.buffers).toHaveProperty("__shader_studio_vertex__:Image");
    for (const featureToken of [
      "CoverageSample",
      "array<f32, 3>",
      "uBool",
      "u32(iFrame)",
      "dpdx(sample.energy)",
      "patternTexSize",
      "coverageGainVec",
    ]) {
      expect(wgsl.image).toContain(featureToken);
    }
    expect(wgsl.buffers?.["__shader_studio_vertex__:Image"]).toContain("patternTexSampleLevel");
  });

  it("plans inline rendering and variable capture across every shader line", { timeout: 60_000 }, () => {
    const failures: DebugSweepFailure[] = [];
    const slangEngine = new SlangDebugEngine();
    const wgslEngine = new WgslDebugEngine();
    const tallies: Record<ShaderLanguage, LanguageTally> = {
      glsl: { lines: 0, inline: 0, capture: 0, unanalysed: 0 },
      slang: { lines: 0, inline: 0, capture: 0, unanalysed: 0 },
      wgsl: { lines: 0, inline: 0, capture: 0, unanalysed: 0 },
    };

    for (const project of projects) {
      const tally = tallies[project.language as ShaderLanguage];
      for (const { pass, source } of debugSources(project)) {
        const lines = source.split("\n");
        for (let line = 0; line < lines.length; line += 1) {
          tally.lines += 1;
          if (project.language === "glsl") {
            try {
              const inline = ShaderDebugger.modifyShaderForLineDebug(source, line, lines[line]);
              if (inline) {
                tally.inline += 1;
              } else {
                // GLSL has no analyse step: a line the rewriter declines is the
                // same signal as analysis.ok === false for the plan engines.
                tally.unanalysed += 1;
              }
            } catch (error) {
              failures.push({
                project: project.name,
                pass,
                line,
                stage: "inline",
                source: lines[line],
                message: error instanceof Error ? error.message : String(error),
              });
            }

            try {
              const variables = VariableCaptureBuilder.getAllInScopeVariables(source, line);
              if (variables.length > 0) {
                const capture = VariableCaptureBuilder.generateMultiCaptureShader(
                  source,
                  line,
                  variables,
                  new Map(),
                  new Map(),
                  true,
                  1,
                  1,
                );
                if (!capture) {
                  throw new Error(`${variables.length} visible variables produced no capture shader`);
                }
                tally.capture += 1;
              }
            } catch (error) {
              failures.push({
                project: project.name,
                pass,
                line,
                stage: "capture",
                source: lines[line],
                message: error instanceof Error ? error.message : String(error),
              });
            }
            continue;
          }

          // Slang and WGSL are planned through one body so the two engines are
          // held to the same contract: same request metadata, same excuse list.
          const isWgsl = project.language === "wgsl";
          const engine: ShaderDebugEngine = isWgsl ? wgslEngine : slangEngine;
          const request = isWgsl
            ? wgslRequest(project, pass, source, line)
            : slangRequest(project, pass, source, line);
          const analysis = engine.analyze(request);
          if (!analysis.ok) {
            tally.unanalysed += 1;
            continue;
          }
          const pushUnlessLimited = (
            stage: "inline" | "capture",
            diagnostics: Array<{ message: string }>,
          ) => {
            // Every diagnostic must be a known replay limit; a real error
            // bundled alongside one still fails.
            if (
              diagnostics.length > 0 &&
              diagnostics.every((diagnostic) =>
                expectedComputeReplayLimits.some((limit) => limit.test(diagnostic.message)))) {
              return;
            }
            failures.push({
              project: project.name,
              pass,
              line,
              stage,
              source: lines[line],
              message: diagnostics.map((diagnostic) => diagnostic.message).join("; "),
            });
          };
          if (analysis.analysis.previewValueId) {
            const inline = engine.planPreview(request, {
              normalizeMode: "off",
              stepEdge: null,
            });
            if (inline.ok) {
              tally.inline += 1;
            } else {
              pushUnlessLimited("inline", inline.diagnostics);
            }
          }

          const capture = engine.planCapture(
            request,
            analysis.analysis.visibleValues.map((value) => value.id),
            { normalizeMode: "off", stepEdge: null },
          );
          if (capture.ok) {
            tally.capture += 1;
          } else {
            pushUnlessLimited("capture", capture.diagnostics);
          }
        }
      }
    }

    expect(formatDebugSweepFailures(failures)).toBe("");
    // Assert per language: aggregates let one engine's coverage collapse while
    // another's growth hides it.
    const shortfalls: string[] = [];
    for (const [language, floor] of Object.entries(coverageFloors) as Array<[ShaderLanguage, typeof coverageFloors[ShaderLanguage]]>) {
      const tally = tallies[language];
      for (const metric of ["lines", "inline", "capture"] as const) {
        if (tally[metric] < floor[metric]) {
          shortfalls.push(`${language}.${metric}: ${tally[metric]} < floor ${floor[metric]}`);
        }
      }
      const ratio = tally.lines === 0 ? 1 : tally.unanalysed / tally.lines;
      if (ratio > floor.unanalysedRatio) {
        shortfalls.push(
          `${language}.unanalysed: ${tally.unanalysed}/${tally.lines} = ${ratio.toFixed(3)}`
          + ` > ceiling ${floor.unanalysedRatio}`,
        );
      }
    }
    expect(shortfalls.join("\n")).toBe("");
  });

  it("compiles and executes every debugger-coverage line on the real backends", { timeout: 60_000 }, async () => {
    const coverageProjects = projects.filter((project) =>
      /foundation\/debugging\/debug-coverage(?:_glsl)?\.(?:glsl|slang|wgsl)$/.test(project.name));
    const failures: DebugSweepFailure[] = [];
    const compiled = new Set<string>();
    let executed = 0;

    async function execute(
      capturer: IVariableCapturer,
      project: (typeof projects)[number],
      pass: string,
      line: number,
      source: string,
      stage: "inline" | "capture",
      request: CaptureRequest,
    ): Promise<void> {
      const key = `${project.language}\0${stage}\0${debugPlanKey(request)}`;
      if (compiled.has(key)) {
        return;
      }
      compiled.add(key);
      capturer.clearLastError();
      const issued = await capturer.issueCaptureAtPixel(
        [request],
        1,
        1,
        32,
        32,
        harnesses.get(project.language)!.engine.getCaptureUniforms(),
      );
      if (issued !== 1) {
        failures.push({
          project: project.name,
          pass,
          line,
          stage,
          source,
          message: capturer.getLastError() ?? "generated shader did not execute",
        });
      } else {
        executed += 1;
      }
      capturer.cancelPendingCaptures();
    }

    for (const project of coverageProjects) {
      const harness = harnesses.get(project.language)!;
      harness.resize(32, 32);
      await harness.compile(project);
      const capturer = harness.engine.createVariableCapturer();
      const wgslEngine = project.language === "wgsl" ? new WgslDebugEngine() : null;
      capturer.setCustomUniforms(
        harness.engine.getCustomUniformDeclarations(),
        harness.engine.getCurrentCustomUniforms(),
      );
      try {
        for (const { pass, source } of debugSources(project)) {
          const path = pass === "Image"
            ? project.path
            : project.language === "wgsl"
              ? wgslPassPath(project, pass)
              : project.slangSourcePaths?.[pass];
          capturer.setCompileContext(
            harness.engine.getVariableCaptureCompileContext(source, pass, path),
          );
          const passConfig = project.config?.passes?.[pass];
          capturer.setInputBindings(passConfig && "inputs" in passConfig ? passConfig.inputs ?? {} : {});
          const lines = source.split("\n");
          for (let line = 0; line < lines.length; line += 1) {
            if (project.language === "glsl") {
              const inline = ShaderDebugger.modifyShaderForLineDebug(source, line, lines[line]);
              if (inline) {
                await execute(capturer, project, pass, line, lines[line], "inline", {
                  varName: "inline",
                  varType: "vec4",
                  captureShader: inline,
                });
              }
              const variables = VariableCaptureBuilder.getAllInScopeVariables(source, line);
              const capture = variables.length > 0
                ? VariableCaptureBuilder.generateMultiCaptureShader(
                  source, line, variables, new Map(), new Map(), true, 1, 1)
                : null;
              if (capture) {
                await execute(capturer, project, pass, line, lines[line], "capture", {
                  varName: variables[0].varName,
                  varType: variables[0].varType,
                  captureShader: capture,
                  selectorIndex: 0,
                });
              }
              continue;
            }

            const analysisRequest = wgslEngine
              ? wgslRequest(project, pass, source, line)
              : slangRequest(project, pass, source, line);
            const debugEngine = wgslEngine ?? new SlangDebugEngine();
            const analysis = debugEngine.analyze(analysisRequest);
            if (!analysis.ok) {
              continue;
            }
            // WGSL previews capture to vec4f; Slang captures to float4.
            const inlineType = wgslEngine ? "vec4f" : "float4";
            if (analysis.analysis.previewValueId) {
              const inline = debugEngine.planPreview(
                analysisRequest,
                { normalizeMode: "off", stepEdge: null },
              );
              if (inline.ok) {
                const root = inline.plan.files.find((file) => file.uri === inline.plan.rootUri)!;
                await execute(capturer, project, pass, line, lines[line], "inline", {
                  varName: "inline",
                  varType: inlineType,
                  captureShader: root.source,
                  selectorIndex: 0,
                  debugPlan: inline.plan,
                });
              }
            }
            const capture = debugEngine.planCapture(
              analysisRequest,
              analysis.analysis.visibleValues.map((value) => value.id),
              { normalizeMode: "off", stepEdge: null },
            );
            if (capture.ok) {
              const root = capture.plan.files.find((file) => file.uri === capture.plan.rootUri)!;
              await execute(capturer, project, pass, line, lines[line], "capture", {
                varName: "capture",
                varType: inlineType,
                captureShader: root.source,
                selectorIndex: 0,
                debugPlan: capture.plan,
              });
            }
          }
        }
      } finally {
        capturer.dispose();
      }
    }

    expect(coverageProjects).toHaveLength(3);
    expect(executed).toBeGreaterThan(100);
    expect(formatDebugSweepFailures(failures)).toBe("");
  });

  it("output assertions are not vacuous", { timeout: 60_000 }, async () => {
    // Each direction of the per-project output check must be able to fail:
    // a broken readback or helper that always reports sentinel, or always
    // reports lit, would let a dead pipeline pass. Constant shaders exercise
    // both outcomes through the same compile/render/readback path.
    const harness = harnesses.get("slang")!;
    harness.resize(64, 64);
    await paintSentinel(harness, "slang");
    const sentinelRegion = await harness.renderAndReadRegion(0);
    expect(isUntouched(sentinelRegion)).toBe(true);
    expect(nonBlackPixelCount(sentinelRegion)).toBeGreaterThan(0);

    await harness.compile({
      path: "/vacuity-red.slang",
      image: "float4 mainImage(float2 fragCoord)\n{\n  return float4(1.0, 0.0, 0.0, 1.0);\n}",
    });
    const redRegion = await harness.renderAndReadRegion(0);
    expect(isUntouched(redRegion)).toBe(false);
    expect(nonBlackPixelCount(redRegion)).toBeGreaterThan(0);

    await harness.compile({
      path: "/vacuity-black.slang",
      image: "float4 mainImage(float2 fragCoord)\n{\n  return float4(0.0, 0.0, 0.0, 1.0);\n}",
    });
    const blackRegion = await harness.renderAndReadRegion(0);
    expect(isUntouched(blackRegion)).toBe(false);
    expect(nonBlackPixelCount(blackRegion)).toBe(0);
  });

  for (const project of projects) {
    it(project.name, { timeout: 30_000 }, async () => {
      const harness = harnesses.get(project.language);
      expect(harness).toBeDefined();
      const size = canvasSize(project);
      harness!.resize(size, size);
      const expectedError = expectedCompileError(project);
      if (expectedError) {
        await expect(harness!.compile(project)).rejects.toThrow(expectedError);
        return;
      }
      await paintSentinel(harness!, project.language as ShaderLanguage);
      try {
        await harness!.compile(project);
      } catch (error) {
        if (!mayExceedPortableImageLimit(project)) {
          throw error;
        }
        expect(String(error)).toMatch(/MAX_TEXTURE_IMAGE_UNITS|samplers|number of sampled textures/);
        return;
      }
      let region = new Uint8ClampedArray();
      for (const time of sampleTimes(project)) {
        region = await harness!.renderAndReadRegion(time);
      }
      // The project drew something: a pass that rasterises nothing leaves the
      // sentinel behind instead of failing.
      expect(isUntouched(region)).toBe(false);
      const usesModel = Object.values(project.config?.passes ?? {}).some((pass) =>
        pass && "geometry" in pass && pass.geometry?.type === "model");
      if (usesModel) {
        expect(nonBlackPixelCount(region)).toBeGreaterThan(100);
      } else if (!knownBlackOutput.has(project.name)) {
        expect(nonBlackPixelCount(region)).toBeGreaterThan(0);
      }
    });
  }
});
