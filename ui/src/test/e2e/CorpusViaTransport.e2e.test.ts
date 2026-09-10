import { afterAll, beforeAll, describe, expect, it } from "vitest";
import projects from "virtual:shader-fixture-corpus";
import type { ShaderConfig, ShaderSourceMessage } from "@shader-studio/types";
import {
  createShaderCanvasHarness,
  type ShaderCanvasHarness,
  type ShaderLanguage,
} from "../../../../rendering/src/test/e2e/ShaderCanvasHarness";
import { ShaderPipeline } from "../../lib/ShaderPipeline";
import type { CompilationResult } from "../../lib/ShaderProcessor";
import { ShaderLocker } from "../../lib/ShaderLocker";
import { ShaderDebugManager } from "../../lib/ShaderDebugManager";
import type { Transport } from "../../lib/transport/MessageTransport";
import corpusFiles from "virtual:shader-corpus-files";
import {
  MemoryWorkspaceStore,
  VirtualWorkspace,
} from "../../../../standalone/src/VirtualWorkspace";
import { WebExtensionHost } from "../../../../standalone/src/WebExtensionHost";

const VERTEX_PREFIX = "__shader_studio_vertex__:";

/** Fixtures whose compile failure is the documented expectation. */
const expectedCompileErrors = new Map<string, RegExp>([
  ["slang/foundation/versions/invalid-version/preview.slang", /unknown language version '2024'/],
]);

/** Channel counts above the portable floor fail on conformant devices. */
function mayExceedPortableImageLimit(project: Project): boolean {
  const imageInputs = Object.keys(project.config?.passes?.Image?.inputs ?? {}).length;
  return project.language === "glsl" ? imageInputs > 12 : imageInputs > 16;
}

/**
 * Fixtures whose rendered region is entirely black today. Blackness is not
 * asserted to be correct for these — the list exists so that a shader going
 * black is a visible change rather than a silent pass, and so the set can be
 * investigated and shrunk. Anything not listed must render something.
 */
const knownBlackOutput = new Set<string>([
  // 33 channels exceeds every portable sampler limit; GLSL fails to compile
  // outright while Slang/WGSL compile and render nothing.
  "slang/33channels.slang",
  "wgsl/33channels.wgsl",
  // Listed as unresolved black-output investigations in the handoff notes.
  "slang/compute-lab/raw-workgroups.slang",
  "wgsl/compute-lab/raw-workgroups.wgsl",
  "slang/compute-lab/storage-edit-colours.slang",
  "wgsl/compute-lab/storage-edit-colours.wgsl",
]);

const rawCorpusSources = new Map(corpusFiles.map((file) => [file.path, file.contents]));

function rawCorpusSource(path: string): string | undefined {
  return rawCorpusSources.get(path);
}

/**
 * Capabilities the standalone host does not implement, so a corpus project
 * relying on one cannot compile through it. Each is a real divergence from the
 * extension host, not a test artifact:
 *
 * - script uniforms: `ScriptEvaluator` exists only in `extension/src/app`.
 * - model geometry: only `extension/.../ConfigPathConverter.ts` resolves
 *   `geometry.resolved_path`; the standalone host resolves inputs only.
 * - `@/` source paths: `WebExtensionHost.resolveSourcePath` has no `@/` branch,
 *   though the feature is documented in `docs/features/config-buffers.md`.
 * - Slang imports/includes: inlining lives in the extension's
 *   `SlangDependencyGraph`, not in the standalone host.
 *
 * Expressed as predicates so a new fixture using one of these is excluded
 * automatically, and so each block can be deleted outright when the standalone
 * host gains the capability.
 */
function unsupportedByStandaloneHost(project: Project): string | null {
  if (project.config?.script) {
    return "standalone host has no script evaluator for custom uniforms";
  }
  const passes = Object.values(project.config?.passes ?? {});
  if (passes.some((pass) => pass && "geometry" in pass && pass.geometry?.type === "model")) {
    return "standalone host does not resolve model geometry assets";
  }
  if (passes.some((pass) => {
    const candidate = pass as { path?: string; vertex?: string } | undefined;
    return candidate?.path?.startsWith("@/") || candidate?.vertex?.startsWith("@/");
  })) {
    return "standalone host does not resolve @/ source paths";
  }
  // The raw workspace file, not the corpus loader's copy: the loader has
  // already inlined dependencies, so its sources no longer show the imports
  // the host would have to resolve.
  const rawSource = rawCorpusSource(`/${project.name}`);
  if (project.language === "slang"
    && rawSource !== undefined
    && /^\s*(?:__exported\s+)?(?:import|__include|#include)\s/m.test(rawSource)) {
    return "standalone host does not inline Slang imports/includes";
  }
  return null;
}

function canvasSize(project: Project): number {
  const passes = Object.values(project.config?.passes ?? {});
  const hasSpatialGeometry = passes.some((pass) =>
    pass && "geometry" in pass && pass.geometry?.type && pass.geometry.type !== "fullscreen");
  return hasSpatialGeometry || /(?:gravity|particles|two-meshes|fullscreen-vertex)/.test(project.name)
    ? 128
    : 64;
}

/** Frames a fixture needs before its output is meaningful. */
function sampleTimes(project: Project): number[] {
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

/**
 * A distinctive fill painted before each project. The engine keeps the last
 * frame when a pass draws nothing, so without a sentinel a fixture that
 * rasterises no geometry silently inherits the previous fixture's pixels and
 * every output assertion passes vacuously.
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

async function paintSentinel(rig: PipelineRig, language: ShaderLanguage): Promise<void> {
  await send(rig, {
    type: "shaderSource",
    code: SENTINEL_SOURCE[language],
    config: null,
    path: `/sentinel.${language === "glsl" ? "glsl" : language}`,
    buffers: {},
    ...(language === "glsl" ? {} : { language }),
  } as ShaderSourceMessage);
  await rig.harness.renderAndReadRegion(0);
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

type Project = (typeof projects)[number];

/** Collects everything the viewer posts back so tests can assert the protocol. */
class RecordingTransport implements Transport {
  readonly sent: { type: string; payload?: unknown }[] = [];
  private handler: ((event: MessageEvent) => void) | null = null;

  private hostHandler: ((message: { type: string; payload?: unknown }) => void) | null = null;

  postMessage(message: { type: string; payload?: unknown }): void {
    this.sent.push(message);
    this.hostHandler?.(message);
  }

  onHostMessage(handler: (message: { type: string; payload?: unknown }) => void): void {
    this.hostHandler = handler;
  }

  onMessage(handler: (event: MessageEvent) => void): void {
    this.handler = handler;
  }

  deliver(message: unknown): void {
    this.handler?.(new MessageEvent("message", { data: message }));
  }

  dispose(): void {
    this.handler = null;
  }

  getType(): "vscode" | "websocket" | "web" {
    return "web";
  }

  isConnected(): boolean {
    return true;
  }
}

interface PipelineRig {
  harness: ShaderCanvasHarness;
  pipeline: ShaderPipeline;
  transport: RecordingTransport;
  locker: ShaderLocker;
  host: WebExtensionHost;
  /** Resolves once the host's shaderSource for `path` has been compiled. */
  open(path: string): Promise<CompilationResult | undefined>;
}

/**
 * Data URLs for corpus assets, keyed by the path as written in the config.
 * The host resolves assets through its injected resolver, so this is the only
 * corpus-derived value the test supplies; project structure comes from the
 * host reading the seeded workspace.
 */
function assetDataUrls(): Map<string, string> {
  const urls = new Map<string, string>();
  for (const project of projects) {
    for (const pass of Object.values(project.config?.passes ?? {})) {
      for (const input of Object.values(pass?.inputs ?? {})) {
        const candidate = input as { path?: string; resolved_path?: string };
        if (candidate.path && candidate.resolved_path) {
          urls.set(candidate.path, candidate.resolved_path);
        }
      }
    }
  }
  return urls;
}

async function createRig(harness: ShaderCanvasHarness): Promise<PipelineRig> {
  const transport = new RecordingTransport();
  const locker = new ShaderLocker();
  const pipeline = new ShaderPipeline(
    transport,
    harness.engine,
    locker,
    new ShaderDebugManager(),
  );

  const assets = assetDataUrls();
  const workspace = await VirtualWorkspace.open(
    new MemoryWorkspaceStore(),
    corpusFiles.map((file) => ({ ...file, createdAt: 1, modifiedAt: 1 })),
  );
  const host = new WebExtensionHost(workspace, {
    resolveDefaultAsset: (assetPath) => assets.get(assetPath) ?? null,
    prompt: () => null,
    confirm: () => false,
  });

  // Viewer -> host, host -> viewer: the real protocol in both directions.
  transport.onHostMessage((message) => {
    void host.handleViewerMessage(message as never);
  });

  let inFlight: Promise<CompilationResult | undefined> = Promise.resolve(undefined);
  let pendingFlag: (() => void) | null = null;
  host.onViewerMessage((message) => {
    if ((message as { type?: string }).type !== "shaderSource") {
      return;
    }
    pendingFlag?.();
    inFlight = pipeline.handleShaderMessage(
      new MessageEvent("message", { data: message }),
    );
  });

  return {
    harness,
    pipeline,
    transport,
    locker,
    host,
    async open(path: string) {
      let emitted = false;
      inFlight = Promise.resolve(undefined);
      pendingFlag = () => {
        emitted = true;
      };
      // The viewer's own refresh request, which is how it asks the host for a
      // specific shader's current source.
      await host.handleViewerMessage({ type: "refresh", payload: { path } } as never);
      const result = await inFlight;
      pendingFlag = null;
      if (!emitted) {
        throw new Error(`Host emitted no shaderSource for ${path}`);
      }
      return result;
    },
  };
}

async function send(rig: PipelineRig, message: ShaderSourceMessage) {
  return rig.pipeline.handleShaderMessage(
    new MessageEvent("message", { data: message }),
  );
}

function projectNamed(name: string): Project {
  const project = projects.find((candidate) => candidate.name === name);
  if (!project) {
    throw new Error(`Corpus project not found: ${name}`);
  }
  return project;
}

describe("shader corpus through the UI transport layer", () => {
  const rigs = new Map<ShaderLanguage, PipelineRig>();

  beforeAll(async () => {
    for (const language of ["glsl", "slang", "wgsl"] as ShaderLanguage[]) {
      rigs.set(language, await createRig(createShaderCanvasHarness(language)));
    }
  });

  afterAll(() => {
    for (const rig of rigs.values()) {
      rig.harness.dispose();
    }
  });

  it("compiles the whole corpus through the real pipeline", { timeout: 120_000 }, async () => {
    const failures: string[] = [];
    const blackOutput: string[] = [];
    const drewNothing: string[] = [];
    const skipped: string[] = [];
    let compiled = 0;
    let rendered = 0;
    for (const project of projects) {
      const rig = rigs.get(project.language as ShaderLanguage)!;
      const unsupported = unsupportedByStandaloneHost(project);
      if (unsupported) {
        skipped.push(`${project.name}: ${unsupported}`);
        continue;
      }
      const size = canvasSize(project);
      rig.harness.resize(size, size);
      await paintSentinel(rig, project.language as ShaderLanguage);
      const result = await rig.open(`/${project.name}`);
      if (!result) {
        failures.push(`${project.name}: pipeline produced no compilation result`);
        continue;
      }
      const errors = result.errors?.join("; ") ?? "";
      const expectedError = expectedCompileErrors.get(project.name);
      if (expectedError) {
        if (!expectedError.test(errors)) {
          failures.push(`${project.name}: expected ${expectedError}, got ${errors || "success"}`);
        }
        continue;
      }
      if (!result.success) {
        if (mayExceedPortableImageLimit(project)
          && /MAX_TEXTURE_IMAGE_UNITS|samplers|number of sampled textures/.test(errors)) {
          continue;
        }
        failures.push(`${project.name}: ${errors}`);
        continue;
      }
      compiled += 1;

      let region: Awaited<ReturnType<ShaderCanvasHarness["renderAndReadRegion"]>> = new Uint8ClampedArray();
      for (const time of sampleTimes(project)) {
        region = await rig.harness.renderAndReadRegion(time);
      }
      const lit = nonBlackPixelCount(region);
      if (isUntouched(region)) {
        drewNothing.push(project.name);
      } else if (lit === 0 && !knownBlackOutput.has(project.name)) {
        blackOutput.push(project.name);
      }
      rendered += 1;
    }
    expect(failures).toEqual([]);
    expect(drewNothing).toEqual([]);
    expect(blackOutput).toEqual([]);
    expect(compiled).toBeGreaterThan(90);
    expect(rendered).toBeGreaterThan(90);
    // Tracked, not tolerated: shrink as the standalone host gains capabilities.
    expect(skipped.length).toBeLessThanOrEqual(27);
  });

  it("compiles a vertex source activated as the shader itself", async () => {
    const project = projectNamed("wgsl/intellisense.wgsl");
    const vertexConfigured = (project.config?.passes?.Image as { vertex?: string }).vertex!;
    const vertexPath = `/wgsl/${vertexConfigured.replace(/^\.\//, "")}`;
    const rig = rigs.get("wgsl")!;

    // The host is asked to activate the vertex file, exactly as it is when a
    // vertex source becomes the active shader in the app.
    const result = await rig.open(vertexPath);

    expect(result?.errors?.join("\n") ?? "").not.toMatch(/redeclaration of 'mainVertex'/);
  });
});
