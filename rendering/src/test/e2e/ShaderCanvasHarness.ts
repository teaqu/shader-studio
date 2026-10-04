import type { ShaderConfig } from "@shader-studio/types";
import type { RenderingEngine as RenderingEngineContract } from "../../types/RenderingEngine";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { expect } from "vitest";
import {
  compileTimingLine,
  drainTimingLine,
  readbackTimingLine,
  resolveLabel,
  splitWait,
  watchQueueDrain,
  countQueueCallsOutsideRender,
  type DrainableQueue,
  type QueueCallCounter,
} from "./gpuTiming";

export const TEST_CANVAS_SIZE = 2;

export type ShaderLanguage = "glsl" | "slang" | "wgsl";
export type Pixel = [red: number, green: number, blue: number, alpha: number];

export interface ShaderProgram {
  path?: string;
  image: string;
  buffers?: Record<string, string>;
  config?: ShaderConfig | null;
  customUniformDeclarations?: string;
  customUniformInfo?: { name: string; type: string }[];
  customUniformValues?: { name: string; type: string; value: number | number[] | boolean }[];
  slangSourcePath?: string;
  slangSourcePaths?: Record<string, string>;
}

export interface ShaderCanvasHarness {
  canvas: HTMLCanvasElement;
  engine: RenderingEngineContract;
  resize(width: number, height: number): void;
  compile(program: ShaderProgram): Promise<void>;
  /**
   * Takes back frame production after something other than `compile()`
   * installed a shader (e.g. the UI pipeline, which starts the engine's own
   * animation loop on every successful compile, as the app needs). Stops that
   * loop and pins the clock, so only this harness's renders advance frames.
   */
  holdFrames(): void;
  /** Names the fixture in [gpu-timing] lines for slow readbacks and compiles. */
  setTimingLabel(label: string): void;
  /**
   * Logs, without waiting, how long the GPU takes to finish work already
   * submitted. Called when a fixture is done, a slow drain names work that
   * nothing waited for.
   */
  watchQueueDrain(): void;
  renderAndReadPixels(time?: number): Promise<Pixel[]>;
  renderAndReadRegion(time?: number): Promise<Uint8ClampedArray>;
  dispose(): void;
}

const slangScriptUrl = new URL("../../../../ui/src/slang/slang-wasm.js", import.meta.url).href;
const slangWasmUrl = new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url).href;

let nextCaptureId = 1;

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEST_CANVAS_SIZE;
  canvas.height = TEST_CANVAS_SIZE;
  document.body.appendChild(canvas);
  return canvas;
}

function createEngine(language: ShaderLanguage): RenderingEngineContract {
  if (language === "glsl") {
    return new RenderingEngine();
  }
  // WGSL needs no Slang worker/WASM assets; Slang keeps the existing path.
  return language === "wgsl"
    ? new WebGPURenderingEngine(undefined, "wgsl")
    : new WebGPURenderingEngine({ scriptUrl: slangScriptUrl, wasmUrl: slangWasmUrl });
}

/**
 * The WebGPU engine's queue, read for diagnostics only. The engine keeps its
 * device private, and WebGPURenderingEngine is already over the file-size
 * limit, so this reads the field rather than adding an accessor there.
 */
function webgpuQueue(engine: RenderingEngineContract): DrainableQueue | null {
  if (!(engine instanceof WebGPURenderingEngine)) {
    return null;
  }
  const device = Reflect.get(engine, "device") as { queue?: DrainableQueue } | null;
  return device?.queue ?? null;
}

/** Whether the WebGPU engine's animation loop is scheduled; null for WebGL. Diagnostic only. */
function webgpuLoopRunning(engine: RenderingEngineContract): boolean | null {
  return engine instanceof WebGPURenderingEngine ? Reflect.get(engine, "rafId") !== null : null;
}

/** WebGPU readback stage, for failures that must say whether a request was lost or slow. */
function readbackStage(engine: RenderingEngineContract, requestId: number): string {
  return engine instanceof WebGPURenderingEngine
    ? engine.getPixelRegionRequestStage(requestId) ?? "not held"
    : "not tracked";
}

interface PixelRegionWait {
  result: ReturnType<RenderingEngineContract["collectPixelRegionResults"]>[number] | null;
  /** When the request was first seen waiting on the GPU, or null if never. */
  mappingSeenAt: number | null;
  /** When it left "mapping" without a result (the mapping failed), or null. */
  mappingLeftAt: number | null;
  endedAt: number;
}

async function pollPixelRegion(engine: RenderingEngineContract, requestId: number, deadline: number): Promise<PixelRegionWait> {
  let mappingSeenAt: number | null = null;
  let mappingLeftAt: number | null = null;
  while (performance.now() < deadline) {
    const result = engine.collectPixelRegionResults().find((candidate) => candidate.requestId === requestId);
    if (result) {
      return { result, mappingSeenAt, mappingLeftAt, endedAt: performance.now() };
    }
    const mapping = readbackStage(engine, requestId) === "mapping";
    if (mapping && mappingSeenAt === null) {
      mappingSeenAt = performance.now();
    } else if (!mapping && mappingSeenAt !== null && mappingLeftAt === null) {
      mappingLeftAt = performance.now();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { result: null, mappingSeenAt, mappingLeftAt, endedAt: performance.now() };
}

async function waitForPixelRegion(
  engine: RenderingEngineContract,
  requestId: number,
  report: (wait: PixelRegionWait, finalStage: string) => void,
): Promise<ReturnType<RenderingEngineContract["collectPixelRegionResults"]>[number]> {
  const startedAt = performance.now();
  const wait = await pollPixelRegion(engine, requestId, startedAt + 5_000);
  if (wait.result) {
    report(wait, "completed");
    return wait.result;
  }
  // "mapping" means the GPU had not finished the frame (slow, not lost).
  // "queued" here means the frame did encode the copy (renderAndReadRegion
  // checks that first) but mapping it failed, so the capturer re-queued it
  // for a next frame this harness never renders: lost, and no wait helps.
  const stage = readbackStage(engine, requestId);
  report(wait, stage);
  const meaning = stage === "queued" ? " (its mapping failed and it was re-queued for a frame that never came)" : "";
  throw new Error(
    `Timed out waiting for canvas pixel readback: request ${requestId} still `
    + `${stage}${meaning} after ${Math.round(performance.now() - startedAt)}ms`,
  );
}

export function createShaderCanvasHarness(language: ShaderLanguage): ShaderCanvasHarness {
  const canvas = createCanvas();
  const engine = createEngine(language);
  engine.initialize(canvas, true);
  let nextRenderTimestamp = performance.now();
  let currentShaderTime = 0;
  let timingLabel: string | null = null;
  // The frame count after the harness's own last render (or holdFrames), so a
  // drain can tell how many frames something else rendered since.
  let lastHarnessFrame = 0;
  // Counts queue calls made outside render(), once the WebGPU device exists.
  let renderDepth = 0;
  let queueCounter: QueueCallCounter | null = null;
  function countQueueCalls(): QueueCallCounter | null {
    const queue = webgpuQueue(engine);
    if (!queueCounter && queue) {
      queueCounter = countQueueCallsOutsideRender(queue as unknown as Record<string, unknown>, () => renderDepth > 0);
    }
    return queueCounter;
  }
  const currentLabel = (): string => resolveLabel(timingLabel, expect.getState().currentTestName);

  function holdFrames(): void {
    engine.stopRenderLoop();
    const timeManager = engine.getTimeManager();
    timeManager.cleanup();
    timeManager.setSpeed(0);
    timeManager.setTime(0);
    nextRenderTimestamp = performance.now();
    currentShaderTime = 0;
    lastHarnessFrame = timeManager.getFrame();
  }

  // Vitest does not stop a test body that times out. One still reading back
  // on this shared harness would collect the next test's result along with
  // its own (collecting drains every completed readback), and that test would
  // then time out with its request "not held". Overlap fails fast instead.
  let readbackInFlight = false;

  async function renderAndReadRegion(
    centerX: number,
    centerY: number,
    shaderTime: number,
  ): Promise<ReturnType<RenderingEngineContract["collectPixelRegionResults"]>[number]> {
    if (readbackInFlight) {
      throw new Error(
        `${language} harness already has a readback in flight; an earlier test that timed out `
        + "may still be running on this shared harness",
      );
    }
    readbackInFlight = true;
    try {
      return await readRegionOnce(centerX, centerY, shaderTime);
    } finally {
      readbackInFlight = false;
    }
  }

  async function readRegionOnce(
    centerX: number,
    centerY: number,
    shaderTime: number,
  ): Promise<ReturnType<RenderingEngineContract["collectPixelRegionResults"]>[number]> {
    const requestId = nextCaptureId++;
    if (!engine.requestPixelRegion(requestId, centerX, centerY)) {
      throw new Error(`Could not queue ${language} canvas readback`);
    }
    if (shaderTime !== currentShaderTime) {
      engine.getTimeManager().setTime(shaderTime);
      currentShaderTime = shaderTime;
    }
    nextRenderTimestamp += 1000 / 60;
    const frameBefore = engine.getTimeManager().getFrame();
    countQueueCalls();
    const renderStartedAt = performance.now();
    renderDepth += 1;
    try {
      engine.render(nextRenderTimestamp);
    } finally {
      renderDepth -= 1;
    }
    const renderEndedAt = performance.now();
    // The copy is encoded inside render(). A request still queued afterwards
    // was skipped by that frame (nothing drew to the canvas), and since no
    // further frame is coming it would only surface as a readback timeout.
    if (readbackStage(engine, requestId) === "queued") {
      throw new Error(`${language} frame did not encode canvas readback request ${requestId}`);
    }
    const result = await waitForPixelRegion(engine, requestId, (wait, finalStage) => {
      const line = readbackTimingLine({
        label: currentLabel(),
        language,
        requestId,
        canvas: `${canvas.width}x${canvas.height}`,
        renderMs: renderEndedAt - renderStartedAt,
        ...splitWait(renderEndedAt, wait.mappingSeenAt, wait.mappingLeftAt, wait.endedAt),
        totalMs: wait.endedAt - renderStartedAt,
        finalStage,
      });
      if (line) {
        console.warn(line);
      }
    });
    // Output of feedback and iFrame-driven fixtures depends on the exact frame
    // count, so a frame this harness did not ask for must fail loudly rather
    // than shift a pixel assertion or signature.
    lastHarnessFrame = frameBefore + 1;
    const extraFrames = engine.getTimeManager().getFrame() - frameBefore - 1;
    if (extraFrames > 0) {
      throw new Error(
        `${language} engine rendered ${extraFrames} frame(s) the harness did not request; `
        + "call holdFrames() after installing a shader outside compile()",
      );
    }
    return result;
  }

  return {
    canvas,
    engine,
    resize(width, height): void {
      engine.handleCanvasResize(width, height);
    },
    async compile(program): Promise<void> {
      if (program.customUniformValues) {
        engine.setCustomUniformValues(program.customUniformValues);
      }
      countQueueCalls();
      const compileStartedAt = performance.now();
      const result = await engine.compileShaderPipeline(
        program.image,
        program.config ?? null,
        program.path ?? `/e2e/image.${language}`,
        program.buffers ?? {},
        program.customUniformDeclarations,
        program.customUniformInfo,
        undefined,
        program.slangSourcePath,
        program.slangSourcePaths,
      );
      const compileLine = compileTimingLine({ label: currentLabel(), language, compileMs: performance.now() - compileStartedAt });
      if (compileLine) {
        console.warn(compileLine);
      }
      if (!result?.success) {
        throw new Error(`Shader compilation failed: ${result?.errors?.join("\n") ?? "no result"}`);
      }
      holdFrames();
    },
    holdFrames,
    setTimingLabel(label): void {
      timingLabel = label;
    },
    watchQueueDrain(): void {
      const label = currentLabel();
      const loopRunning = webgpuLoopRunning(engine);
      const outsideRender = countQueueCalls()?.take();
      watchQueueDrain(webgpuQueue(engine), (drainMs) => {
        // Compared with the harness's latest frame, not the one at the call:
        // the drain resolves after the harness may have rendered again.
        const unrequestedFrames = engine.getTimeManager().getFrame() - lastHarnessFrame;
        const line = drainTimingLine({ label, language, drainMs, loopRunning, unrequestedFrames, outsideRender });
        if (line) {
          console.warn(line);
        }
      });
    },
    async renderAndReadPixels(shaderTime = 0): Promise<Pixel[]> {
      const result = await renderAndReadRegion(0, 0, shaderTime);
      const pixels: Pixel[] = [];
      for (let y = 0; y < TEST_CANVAS_SIZE; y += 1) {
        for (let x = 0; x < TEST_CANVAS_SIZE; x += 1) {
          const offset = ((30 + y) * result.width + 30 + x) * 4;
          pixels.push([...result.rgba.slice(offset, offset + 4)] as Pixel);
        }
      }
      return pixels;
    },
    async renderAndReadRegion(shaderTime = 0): Promise<Uint8ClampedArray> {
      const result = await renderAndReadRegion(canvas.width / 2, canvas.height / 2, shaderTime);
      return result.rgba;
    },
    dispose(): void {
      engine.dispose();
      canvas.remove();
    },
  };
}
