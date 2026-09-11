import { afterAll, beforeAll, describe, expect, it } from "vitest";
import projects from "virtual:shader-fixture-corpus";
import { tripletSignatures } from "./triplet-signatures";
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
  // Legitimate: all 33 inputs sample the single shared keyboard texture
  // (SlangBindingPlan dedupes every keyboard channel to one binding, so no
  // device limit is exceeded), which is black until a key is held. Holding a
  // key lights the frame — covered by "pinned black-output fixtures reach
  // their intended visible result". GLSL fails to compile outright (each
  // keyboard input takes a WebGL texture unit) with a surfaced error.
  "slang/33channels.slang",
  "wgsl/33channels.wgsl",
  // Legitimate: the fixture documents a single 1x1x1 dispatch covering one
  // texel ("expect a mostly untouched frame with a single marked texel").
  // The engine writes it — a full-coverage twin of the same kernel renders
  // fully lit — but one corner texel minifies to invisibility at the sweep's
  // 64px canvas, and the sweep reads the center region.
  "slang/compute-lab/raw-workgroups.slang",
  "wgsl/compute-lab/raw-workgroups.wgsl",
  // Legitimate: quadrants read the `colours` storage buffer, which starts
  // zeroed until the user edits it in the Storage panel. Writing values
  // lights the frame — covered by the visible-result test below.
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

  it("pinned black-output fixtures reach their intended visible result", { timeout: 120_000 }, async () => {
    // slang/33channels: black is idle keyboard input, not a broken pipeline.
    // Key 66 ('B') lands on a pixel center at the 64px canvas, so holding it
    // must light the frame through the shared keyboard texture.
    {
      const rig = rigs.get("slang")!;
      rig.harness.resize(64, 64);
      await paintSentinel(rig, "slang");
      await rig.open("/slang/33channels.slang");
      const press = (type: "keydown" | "keyup"): void => {
        const event = new KeyboardEvent(type, { bubbles: true });
        Object.defineProperty(event, "keyCode", { value: 66 });
        window.dispatchEvent(event);
      };
      press("keydown");
      const region = await rig.harness.renderAndReadRegion(0);
      press("keyup");
      // Untoggle so later tests see pristine keyboard state.
      press("keydown");
      press("keyup");
      expect(nonBlackPixelCount(region)).toBeGreaterThan(0);
    }
    // storage-edit-colours: black is the zeroed `colours` buffer. Writing
    // values — the Storage panel path — must light every quadrant.
    {
      const rig = rigs.get("slang")!;
      rig.harness.resize(64, 64);
      await paintSentinel(rig, "slang");
      await rig.open("/slang/compute-lab/storage-edit-colours.slang");
      const colours = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1]);
      await rig.harness.engine.writeStorageBuffer("colours", 0, colours.buffer as ArrayBuffer);
      const region = await rig.harness.renderAndReadRegion(0);
      expect(nonBlackPixelCount(region)).toBeGreaterThan(0);
    }
  });

  it("routes the buffer/vertex arrangement matrix and answers the protocol", { timeout: 120_000 }, async () => {
    const pollTransport = async (
      transport: RecordingTransport,
      since: number,
      predicate: (message: { type: string; payload?: unknown }) => boolean,
      label: string,
    ): Promise<{ type: string; payload?: unknown }> => {
      const deadline = performance.now() + 15_000;
      for (;;) {
        const found = transport.sent.slice(since).find(predicate);
        if (found) {
          return found;
        }
        if (performance.now() > deadline) {
          const tail = transport.sent.slice(since).map((message) =>
            `${message.type}: ${JSON.stringify(message.payload)?.slice(0, 200)}`);
          throw new Error(`Timed out waiting for ${label}; since mark: ${JSON.stringify(tail)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const isLog = (message: { type: string }): boolean => message.type === "log";
    const isRefreshFor = (path: string) => (message: { type: string; payload?: unknown }): boolean =>
      message.type === "refresh" && (message.payload as { path?: string } | undefined)?.path === path;

    const slangRig = rigs.get("slang")!;
    const wgslRig = rigs.get("wgsl")!;
    const gameOfLife = projectNamed("slang/compute-lab/game-of-life.slang");
    const intellisense = projectNamed("wgsl/intellisense.wgsl");
    const gameOfLifePath = `/${gameOfLife.name}`;
    const intellisensePath = `/${intellisense.name}`;
    // Buffer/vertex file paths, derived the way the host resolves them:
    // relative to the shader's directory.
    const computeBufferPath = `/slang/compute-lab/${(gameOfLife.config?.passes?.ComputeLife as { path?: string }).path}`;
    const vertexPath = `/wgsl/${(intellisense.config?.passes?.Image as { vertex?: string }).vertex!.replace(/^\.\//, "")}`;
    const shaderMessage = (
      path: string,
      code: string | undefined,
      language: ShaderLanguage,
    ): ShaderSourceMessage => ({
      type: "shaderSource",
      code: code ?? "",
      config: null,
      path,
      buffers: {},
      ...(language === "glsl" ? {} : { language }),
    }) as ShaderSourceMessage;

    try {
      // Unlocked main: a real compile with a success post back.
      const mainMark = slangRig.transport.sent.length;
      const mainResult = await slangRig.open(gameOfLifePath);
      expect(mainResult?.success).toBe(true);
      await pollTransport(slangRig.transport, mainMark, isLog, "unlocked main success log");

      // Unlocked buffer: no buffer target exists unlocked, so the buffer
      // source routes to main and a compilation verdict comes back.
      expect(slangRig.pipeline.getShaderMessageTarget({ path: computeBufferPath })).toEqual({ kind: "main" });
      const bufferMark = slangRig.transport.sent.length;
      const bufferCode = rawCorpusSource(computeBufferPath);
      const bufferAsMain = await send(slangRig, shaderMessage(computeBufferPath, bufferCode, "slang"));
      expect(bufferAsMain).toBeDefined();
      await pollTransport(
        slangRig.transport,
        bufferMark,
        (message) => message.type === "log" || message.type === "error",
        "unlocked buffer-as-main verdict",
      );

      // Unlocked linked vertex: refreshes the viewed owner, and the host
      // answers the refresh with the owner's source — the round trip.
      await wgslRig.open(intellisensePath);
      expect(wgslRig.pipeline.getShaderMessageTarget({ path: vertexPath })).toEqual({
        kind: "vertex",
        passName: "Image",
      });
      const vertexMark = wgslRig.transport.sent.length;
      const vertexCode = rawCorpusSource(vertexPath);
      const linkedResult = await send(wgslRig, shaderMessage(vertexPath, vertexCode, "wgsl"));
      expect(linkedResult).toBeUndefined();
      const refresh = await pollTransport(wgslRig.transport, vertexMark, isRefreshFor(intellisensePath), "linked vertex refresh");
      await pollTransport(
        wgslRig.transport,
        wgslRig.transport.sent.indexOf(refresh) + 1,
        isLog,
        "linked vertex round-trip success log",
      );

      // Locked main: the locked shader still compiles as main.
      slangRig.locker.toggleLock(gameOfLifePath);
      const lockedMark = slangRig.transport.sent.length;
      const lockedMain = await slangRig.open(gameOfLifePath);
      expect(lockedMain?.success).toBe(true);
      await pollTransport(slangRig.transport, lockedMark, isLog, "locked main success log");

      // Locked buffer: the buffer updater takes it, posts its own verdict,
      // and no full-shader verdict comes back synchronously.
      expect(slangRig.pipeline.getShaderMessageTarget({ path: computeBufferPath })).toEqual({
        kind: "buffer",
        passName: "ComputeLife",
      });
      const lockedBufferMark = slangRig.transport.sent.length;
      const lockedBuffer = await send(slangRig, shaderMessage(computeBufferPath, bufferCode, "slang"));
      expect(lockedBuffer).toBeUndefined();
      await pollTransport(
        slangRig.transport,
        lockedBufferMark,
        // The verdict names the file-derived buffer ('game-of-life'), while
        // the recompile targets the resolved pass (ComputeLife).
        (message) => message.type === "log" && JSON.stringify(message.payload).includes("updated and pipeline recompiled"),
        "locked buffer update log",
      );

      // Locked vertex: refreshes the locked path, not the viewed one.
      wgslRig.locker.toggleLock(intellisensePath);
      expect(wgslRig.pipeline.getShaderMessageTarget({ path: vertexPath })).toEqual({
        kind: "vertex",
        passName: "Image",
      });
      const lockedVertexMark = wgslRig.transport.sent.length;
      const lockedVertex = await send(wgslRig, shaderMessage(vertexPath, vertexCode, "wgsl"));
      expect(lockedVertex).toBeUndefined();
      await pollTransport(wgslRig.transport, lockedVertexMark, isRefreshFor(intellisensePath), "locked vertex refresh");

      // Locked unknown path: no target, nothing posted.
      expect(slangRig.pipeline.getShaderMessageTarget({ path: "/slang/compute-lab/missing.slang" })).toBeNull();
      const unknownMark = slangRig.transport.sent.length;
      const unknown = await send(
        slangRig,
        shaderMessage("/slang/compute-lab/missing.slang", "float4 mainImage(float2 c) { return float4(0); }", "slang"),
      );
      expect(unknown).toBeUndefined();
      expect(slangRig.transport.sent.length).toBe(unknownMark);

      // Locked common: refreshes the locked path and answers synchronously.
      if (slangRig.locker.isLocked()) {
        slangRig.locker.toggleLock();
      }
      const structs = projectNamed("slang/structs/structs.slang");
      const structsPath = `/${structs.name}`;
      await slangRig.open(structsPath);
      slangRig.locker.toggleLock(structsPath);
      const commonPath = `/slang/structs/${((structs.config?.passes ?? {}) as Record<string, { path?: string } | undefined>).common?.path}`;
      expect(slangRig.pipeline.getShaderMessageTarget({ path: commonPath })).toEqual({
        kind: "buffer",
        passName: "common",
      });
      const commonMark = slangRig.transport.sent.length;
      const commonCode = rawCorpusSource(commonPath);
      const commonResult = await send(slangRig, shaderMessage(commonPath, commonCode, "slang"));
      expect(commonResult).toEqual({ success: true });
      await pollTransport(slangRig.transport, commonMark, isRefreshFor(structsPath), "locked common refresh");
    } finally {
      if (slangRig.locker.isLocked()) {
        slangRig.locker.toggleLock();
      }
      if (wgslRig.locker.isLocked()) {
        wgslRig.locker.toggleLock();
      }
    }

    // Cold vertex on a rig that never viewed anything: dropped silently —
    // no refresh, no verdict posts.
    const coldRig = await createRig(createShaderCanvasHarness("wgsl"));
    try {
      const coldCode = rawCorpusSource(vertexPath);
      expect(coldRig.pipeline.getShaderMessageTarget({ path: vertexPath, code: coldCode ?? "" })).toEqual({
        kind: "vertex",
      });
      const coldResult = await coldRig.open(vertexPath);
      expect(coldResult).toBeUndefined();
      expect(coldRig.transport.sent).toEqual([]);
    } finally {
      coldRig.harness.dispose();
    }
  });

  it("renders language triplets with cross-pipeline agreement", { timeout: 240_000 }, async () => {
    const byName = new Map(projects.map((project) => [project.name, project]));
    const triplets: Array<{ slang: Project; glsl: Project; wgsl: Project }> = [];
    for (const project of projects) {
      if (project.language !== "slang" || !project.name.endsWith(".slang")) {
        continue;
      }
      const glsl = byName.get(project.name.replace(/^slang\//, "glsl/").replace(/\.slang$/, "_glsl.glsl"));
      const wgsl = byName.get(project.name.replace(/^slang\//, "wgsl/").replace(/\.slang$/, ".wgsl"));
      if (glsl && wgsl && glsl.language === "glsl" && wgsl.language === "wgsl") {
        triplets.push({ slang: project, glsl, wgsl });
      }
    }

    /** Mean RGB per cell of a coarse 8x8 grid over the region. */
    const grid8x8 = (region: Uint8ClampedArray): number[] => {
      const side = Math.sqrt(region.length / 4);
      const grid: number[] = [];
      for (let gy = 0; gy < 8; gy += 1) {
        for (let gx = 0; gx < 8; gx += 1) {
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let y = Math.floor((gy * side) / 8); y < Math.floor(((gy + 1) * side) / 8); y += 1) {
            for (let x = Math.floor((gx * side) / 8); x < Math.floor(((gx + 1) * side) / 8); x += 1) {
              const offset = (y * side + x) * 4;
              r += region[offset]!;
              g += region[offset + 1]!;
              b += region[offset + 2]!;
              n += 1;
            }
          }
          grid.push(r / n, g / n, b / n);
        }
      }
      return grid;
    };
    const gridDiffs = (a: number[], b: number[]): { max: number; mean: number } => {
      let max = 0;
      let sum = 0;
      for (let i = 0; i < a.length; i += 1) {
        const diff = Math.abs(a[i]! - b[i]!);
        max = Math.max(max, diff);
        sum += diff;
      }
      return { max, mean: sum / a.length };
    };

    /**
     * Triplets whose pipelines legitimately disagree, each with its reason.
     * These still render (a render failure is reported) and still record a
     * signature, but their cross-language grids are not compared.
     */
    const divergentTriplets = new Map<string, string>([
      [
        "slang/intellisense.slang",
        "per-language intrinsic catalogues: each fixture sums its own language's built-ins, so the outputs intentionally differ (slang/wgsl agree at max 1.7)",
      ],
      [
        "slang/parity/pass-timing/b.slang",
        "per-language match colours: slang/wgsl report a match as green, glsl as yellow; all three report match (frame parity is intact)",
      ],
      [
        "slang/parity/pass-timing/timing.slang",
        "same per-language match colours as pass-timing/b, which it displays",
      ],
      [
        "slang/vertex.slang",
        "non-equivalent fixture variants: slang/wgsl pair a compute-init storage transform with a cubemap hook (they agree at max 5.0), glsl is an independent 2D-texture hook",
      ],
    ]);

    // Wall-clock triplets cannot be grid-compared: back-to-back renders
    // later in a session sit on a steep part of their waveforms, so even
    // same-pipeline renders disagree (fullscreen-vertex hit 113, plane 148
    // in a full-file run after agreeing near t=0). They still render here
    // — a failure to compile or draw is reported — and they carry no
    // signature either (see signatureExclusions, same four names).
    const wallClockTriplets = new Set([
      "slang/fullscreen-vertex.slang",
      "slang/plane.slang",
      "slang/vertex.slang",
      "slang/video.slang",
    ]);

    const disagreements: string[] = [];
    const skipped: string[] = [];
    const renderedGrids = new Map<string, number[]>();
    let compared = 0;
    for (const triplet of triplets) {
      const members = [triplet.slang, triplet.glsl, triplet.wgsl] as const;
      const blocker = members.map((member) =>
        unsupportedByStandaloneHost(member)
        ?? (expectedCompileErrors.has(member.name) ? "documents a compile failure" : null)
        ?? (mayExceedPortableImageLimit(member) ? "exceeds the portable image limit" : null));
      if (blocker.some(Boolean)) {
        skipped.push(`${triplet.slang.name}: ${blocker.find(Boolean)}`);
        continue;
      }
      const grids = new Map<ShaderLanguage, number[]>();
      let failed = false;
      for (const member of members) {
        const language = member.language as ShaderLanguage;
        const rig = rigs.get(language)!;
        const size = canvasSize(member);
        rig.harness.resize(size, size);
        await paintSentinel(rig, language);
        const result = await rig.open(`/${member.name}`);
        if (!result?.success) {
          disagreements.push(`${member.name}: triplet render failed: ${result?.errors?.join("; ") ?? "no result"}`);
          failed = true;
          break;
        }
        let region: Awaited<ReturnType<ShaderCanvasHarness["renderAndReadRegion"]>> = new Uint8ClampedArray();
        for (const time of sampleTimes(member)) {
          region = await rig.harness.renderAndReadRegion(time);
        }
        grids.set(language, grid8x8(region));
      }
      if (failed) {
        continue;
      }
      compared += 1;
      renderedGrids.set(triplet.slang.name, grids.get("wgsl")!);
      if (!divergentTriplets.has(triplet.slang.name) && !wallClockTriplets.has(triplet.slang.name)) {
        // Coarse downsample with a per-channel tolerance: a one-pixel divider
        // or strip shift inside a 7.5px cell moves its mean by up to ~34, and
        // Slang-worker rounding reaches ~21, so 40 admits boundary and
        // precision effects while a semantic split (65+) still fails loudly.
        const pairs: Array<[ShaderLanguage, ShaderLanguage]> = [["slang", "glsl"], ["slang", "wgsl"], ["glsl", "wgsl"]];
        for (const [first, second] of pairs) {
          const diff = gridDiffs(grids.get(first)!, grids.get(second)!);
          if (diff.max > 40) {
            disagreements.push(
              `${triplet.slang.name}: ${first}/${second} max cell diff ${diff.max.toFixed(1)} (mean ${diff.mean.toFixed(2)})`,
            );
          }
        }
      }
    }
    // Shared-regression guard: triplet agreement is blind to a drift that
    // hits every pipeline identically, so each compared triplet also carries
    // a coarse committed signature — the WGSL 8x8 grid reduced to a 16-level
    // luma hex string. WGSL is the reference because it renders on the
    // native path without worker rounding jitter. Regenerate with
    // `npm run test:e2e:update-signatures -w ui`, which harvests the
    // TRIPLET_SIGNATURES_JSON line below; never edit the file by hand.
    //
    // Signatures are exact hex matches, so a triplet whose output varies run
    // to run cannot carry one — the guard proved this on fullscreen-vertex
    // (cos(iTime) colours plus an iTime ripple hook) by flagging drift on its
    // first re-run. Agreement still covers it: all three render the same
    // clock within one run.
    const signatureExclusions = new Map<string, string>([
      [
        "slang/fullscreen-vertex.slang",
        "wall-clock output: cos(iTime) colours and an iTime vertex ripple vary run to run (drift observed, not inferred)",
      ],
      [
        "slang/plane.slang",
        "wall-clock output: the vertex hook displaces by sin/cos(iTime); a boundary cell flipped buckets between runs",
      ],
      [
        "slang/vertex.slang",
        "wall-clock output: fragment blue channel is 0.35 + 0.25 * sin(iTime)",
      ],
      [
        "slang/video.slang",
        "wall-clock output: pulse and marker driven by sin(iTime) and frac(iTime)",
      ],
    ]);
    const observed: Record<string, string> = {};
    for (const triplet of triplets) {
      const grid = renderedGrids.get(triplet.slang.name);
      if (grid && !signatureExclusions.has(triplet.slang.name)) {
        let signature = "";
        for (let cell = 0; cell < 64; cell += 1) {
          const luma = Math.round(0.299 * grid[cell * 3]! + 0.587 * grid[cell * 3 + 1]! + 0.114 * grid[cell * 3 + 2]!);
          signature += (luma >> 4).toString(16);
        }
        observed[triplet.slang.name] = signature;
      }
    }
    console.log(`TRIPLET_SIGNATURES_JSON:${JSON.stringify(observed)}`);
    const signatureMismatches: string[] = [];
    for (const [name, signature] of Object.entries(observed)) {
      const expected = (tripletSignatures as Record<string, string>)[name];
      if (expected === undefined) {
        signatureMismatches.push(`${name}: no committed signature (regenerate)`);
      } else if (expected !== signature) {
        signatureMismatches.push(`${name}: signature drift ${expected} -> ${signature}`);
      }
    }
    for (const name of Object.keys(tripletSignatures as Record<string, string>)) {
      if (!(name in observed) && !signatureExclusions.has(name)) {
        signatureMismatches.push(`${name}: stale committed signature (regenerate)`);
      }
    }
    expect(signatureMismatches).toEqual([]);
    expect(disagreements).toEqual([]);
    expect(skipped.sort()).toEqual([
      "slang/33channels.slang: exceeds the portable image limit",
      "slang/custom-uniforms.slang: standalone host has no script evaluator for custom uniforms",
      "slang/feature-coverage.slang: standalone host has no script evaluator for custom uniforms",
      "slang/flow.slang: standalone host does not resolve model geometry assets",
      "slang/foundation/debugging/debug-coverage.slang: standalone host does not inline Slang imports/includes",
      "slang/foundation/debugging/passes/history.slang: standalone host does not inline Slang imports/includes",
      "slang/test.slang: standalone host does not inline Slang imports/includes",
      "slang/texture.slang: standalone host does not inline Slang imports/includes",
      "slang/two-meshes.slang: standalone host does not resolve model geometry assets",
      "slang/uniforms.slang: standalone host has no script evaluator for custom uniforms",
    ]);
    expect(compared).toBe(15);
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
