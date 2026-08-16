import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ShaderDebugger, SlangDebugEngine, VariableCaptureBuilder } from "@shader-studio/debug";
import type { DebugAnalysisRequest } from "@shader-studio/types";
import projects from "virtual:shader-fixture-corpus";
import {
  createShaderCanvasHarness,
  type ShaderCanvasHarness,
  type ShaderLanguage,
} from "./ShaderCanvasHarness";
import type { CaptureRequest, IVariableCapturer } from "../../capture/VariableCapturer";

const expectedCompileErrors = new Map<string, RegExp>([
  ["foundation/versions/invalid-version/preview.slang", /unknown language version '2024'/],
]);

// These exercise Slang's source/module/version system itself. Translating
// them to GLSL would remove the behavior that each fixture exists to test.
const slangSpecificRenderProjects = new Set([
  "foundation/includes/include-preview.slang",
  "foundation/modules/import-preview.slang",
  "foundation/versions/invalid-version/preview.slang",
  "foundation/versions/latest/preview.slang",
  "foundation/versions/legacy/preview.slang",
  "foundation/versions/slang-2025/preview.slang",
  "foundation/versions/slang-2026/preview.slang",
  "foundation/versions/version-mismatch/preview.slang",
  "foundation/workspace/foundation.slang",
]);

function expectedCompileError(project: (typeof projects)[number]): RegExp | undefined {
  const imageInputs = Object.keys(project.config?.passes?.Image?.inputs ?? {}).length;
  if (project.language === "glsl" && imageInputs > 12) {
    return /MAX_TEXTURE_IMAGE_UNITS\(16\)/;
  }
  if (project.language === "slang" && imageInputs > 16) {
    return /samplers \(\d+\).+exceeds the maximum per-stage limit \(16\)/;
  }
  return expectedCompileErrors.get(project.name);
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

async function sha256(bytes: Uint8ClampedArray): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  return {
    workspace: {
      rootUri: rootPath,
      rootPath,
      passName: isCommon ? "Image" : pass,
      contentHash: `${project.name}:${pass}`,
      files,
    },
    sourceUri: selectedPath,
    position: { line, character: Math.max(0, source.split("\n")[line]?.search(/\S/) ?? 0) },
  };
}

function slangPlanKey(request: CaptureRequest): string {
  return request.slangPlan
    ? request.slangPlan.files.map((file) => `${file.uri}\0${file.source}`).join("\0")
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
    expect(projects).toHaveLength(78);
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
      const counterpartName = slangProject.name.replace(/\.slang$/, "_glsl.glsl");
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

  it("assigns feature-appropriate corpus resolutions", () => {
    expect(canvasSize(projects.find((project) => project.name === "cat-glsl.glsl")!)).toBe(128);
    expect(canvasSize(projects.find((project) => project.name === "video.slang")!)).toBe(96);
    expect(canvasSize(projects.find((project) => project.name === "compute-lab/game-of-life.slang")!)).toBe(64);
    expect(canvasSize(projects.find((project) => project.name === "foundation/versions/latest/preview.slang")!)).toBe(32);
    expect(sampleTimes(projects.find((project) => project.name === "two-meshes.slang")!)).toEqual([1]);
    expect(sampleTimes(projects.find((project) => project.name === "particles.slang")!)).toHaveLength(3);
  });

  it("keeps the paired portable feature-coverage contract comprehensive", () => {
    const slang = projects.find((project) => project.name === "feature-coverage.slang")!;
    const glsl = projects.find((project) => project.name === "feature-coverage_glsl.glsl")!;
    for (const project of [slang, glsl]) {
      expect(project.config?.script).toBe("./uniforms.ts");
      expect(Object.keys(project.config?.passes ?? {}).sort()).toEqual(["BufferA", "Image", "common"]);
      expect(project.config?.passes?.Image?.inputs).toMatchObject({
        patternTex: { type: "texture" },
        historyBuffer: { type: "buffer", source: "BufferA" },
      });
      expect(project.buffers).toHaveProperty("BufferA");
      expect(project.buffers).toHaveProperty("common");
      expect(project.buffers).toHaveProperty("__shader_studio_vertex__:Image");
      for (const featureToken of ["CoverageSample", "weights[3]", "iChannelResolution", "uBool", "uint flags"]) {
        expect(project.image).toContain(featureToken);
      }
    }
    expect(slang.image).toContain("ddx(sample.energy)");
    expect(glsl.image).toContain("dFdx(sampleValue.energy)");
    expect(slang.buffers?.["__shader_studio_vertex__:Image"]).toContain("samplePatternTex");
    expect(glsl.buffers?.["__shader_studio_vertex__:Image"]).toContain("samplePatternTex");
  });

  it("plans inline rendering and variable capture across every shader line", { timeout: 30_000 }, () => {
    const failures: DebugSweepFailure[] = [];
    const slangEngine = new SlangDebugEngine();
    let lineCount = 0;
    let inlinePlanCount = 0;
    let capturePlanCount = 0;

    for (const project of projects) {
      for (const { pass, source } of debugSources(project)) {
        const lines = source.split("\n");
        for (let line = 0; line < lines.length; line += 1) {
          lineCount += 1;
          if (project.language === "glsl") {
            try {
              const inline = ShaderDebugger.modifyShaderForLineDebug(source, line, lines[line]);
              if (inline) {
                inlinePlanCount += 1;
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
                capturePlanCount += 1;
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

          const request = slangRequest(project, pass, source, line);
          const analysis = slangEngine.analyze(request);
          if (!analysis.ok) {
            continue;
          }
          if (analysis.analysis.previewValueId) {
            const inline = slangEngine.planPreview(request, {
              normalizeMode: "off",
              stepEdge: null,
            });
            if (inline.ok) {
              inlinePlanCount += 1;
            } else {
              failures.push({
                project: project.name,
                pass,
                line,
                stage: "inline",
                source: lines[line],
                message: inline.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
              });
            }
          }

          const capture = slangEngine.planCapture(
            request,
            analysis.analysis.visibleValues.map((value) => value.id),
            { normalizeMode: "off", stepEdge: null },
          );
          if (capture.ok) {
            capturePlanCount += 1;
          } else {
            failures.push({
              project: project.name,
              pass,
              line,
              stage: "capture",
              source: lines[line],
              message: capture.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
            });
          }
        }
      }
    }

    expect(lineCount).toBeGreaterThan(3_000);
    expect(inlinePlanCount).toBeGreaterThan(500);
    expect(capturePlanCount).toBeGreaterThan(500);
    expect(formatDebugSweepFailures(failures)).toBe("");
  });

  it("compiles and executes every debugger-coverage line on the real backends", { timeout: 60_000 }, async () => {
    const coverageProjects = projects.filter((project) =>
      /foundation\/debugging\/debug-coverage(?:_glsl)?\.(?:glsl|slang)$/.test(project.name));
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
      const key = `${project.language}\0${stage}\0${slangPlanKey(request)}`;
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
      capturer.setCustomUniforms(
        harness.engine.getCustomUniformDeclarations(),
        harness.engine.getCurrentCustomUniforms(),
      );
      try {
        for (const { pass, source } of debugSources(project)) {
          const path = pass === "Image" ? project.path : project.slangSourcePaths?.[pass];
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

            const analysisRequest = slangRequest(project, pass, source, line);
            const slangEngine = new SlangDebugEngine();
            const analysis = slangEngine.analyze(analysisRequest);
            if (!analysis.ok) {
              continue;
            }
            if (analysis.analysis.previewValueId) {
              const inline = slangEngine.planPreview(
                analysisRequest,
                { normalizeMode: "off", stepEdge: null },
              );
              if (inline.ok) {
                const root = inline.plan.files.find((file) => file.uri === inline.plan.rootUri)!;
                await execute(capturer, project, pass, line, lines[line], "inline", {
                  varName: "inline",
                  varType: "float4",
                  captureShader: root.source,
                  selectorIndex: 0,
                  slangPlan: inline.plan,
                });
              }
            }
            const capture = slangEngine.planCapture(
              analysisRequest,
              analysis.analysis.visibleValues.map((value) => value.id),
              { normalizeMode: "off", stepEdge: null },
            );
            if (capture.ok) {
              const root = capture.plan.files.find((file) => file.uri === capture.plan.rootUri)!;
              await execute(capturer, project, pass, line, lines[line], "capture", {
                varName: "capture",
                varType: "float4",
                captureShader: root.source,
                selectorIndex: 0,
                slangPlan: capture.plan,
              });
            }
          }
        }
      } finally {
        capturer.dispose();
      }
    }

    expect(coverageProjects).toHaveLength(2);
    expect(executed).toBeGreaterThan(100);
    expect(formatDebugSweepFailures(failures)).toBe("");
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
      await harness!.compile(project);
      let region = new Uint8ClampedArray();
      for (const time of sampleTimes(project)) {
        region = await harness!.renderAndReadRegion(time);
      }
      const usesModel = Object.values(project.config?.passes ?? {}).some((pass) =>
        pass && "geometry" in pass && pass.geometry?.type === "model");
      if (usesModel) {
        expect(nonBlackPixelCount(region)).toBeGreaterThan(100);
      }
      expect(`${size}:${await sha256(region)}`).toMatchSnapshot();
    });
  }
});
