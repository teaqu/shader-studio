import type { ShaderConfig } from "@shader-studio/types";
import type { RenderingEngine as RenderingEngineContract } from "../../types/RenderingEngine";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { expect as soakExpect } from "vitest";
import { gpuLiveSummary, installGpuTrace, timeQueueDrain } from "./soakGpuTrace";

installGpuTrace();

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

/** WebGPU readback stage, for failures that must say whether a request was lost or slow. */
function readbackStage(engine: RenderingEngineContract, requestId: number): string {
  return engine instanceof WebGPURenderingEngine
    ? engine.getPixelRegionRequestStage(requestId) ?? "not held"
    : "not tracked";
}

async function waitForPixelRegion(
  engine: RenderingEngineContract,
  requestId: number,
): Promise<ReturnType<RenderingEngineContract["collectPixelRegionResults"]>[number]> {
  const startedAt = performance.now();
  const deadline = startedAt + 5_000;
  while (performance.now() < deadline) {
    const result = engine.collectPixelRegionResults().find((candidate) => candidate.requestId === requestId);
    if (result) {
      return result;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  // "mapping" means the GPU had not finished the frame (slow, not lost).
  // "queued" here means the frame did encode the copy (renderAndReadRegion
  // checks that first) but mapping it failed, so the capturer re-queued it
  // for a next frame this harness never renders: lost, and no wait helps.
  const stage = readbackStage(engine, requestId);
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

  function holdFrames(): void {
    engine.stopRenderLoop();
    const timeManager = engine.getTimeManager();
    timeManager.cleanup();
    timeManager.setSpeed(0);
    timeManager.setTime(0);
    nextRenderTimestamp = performance.now();
    currentShaderTime = 0;
  }

  async function renderAndReadRegion(
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- soak-only diagnostic reaching the private device
    const soakDevice = engine instanceof WebGPURenderingEngine ? (engine as any).device as GPUDevice | null : null;
    const soakStart = performance.now();
    engine.render(nextRenderTimestamp);
    const soakDrain = timeQueueDrain(soakDevice);
    // The copy is encoded inside render(). A request still queued afterwards
    // was skipped by that frame (nothing drew to the canvas), and since no
    // further frame is coming it would only surface as a readback timeout.
    if (readbackStage(engine, requestId) === "queued") {
      throw new Error(`${language} frame did not encode canvas readback request ${requestId}`);
    }
    let result: Awaited<ReturnType<typeof waitForPixelRegion>>;
    try {
      result = await waitForPixelRegion(engine, requestId);
    } catch (error) {
      const drain = await Promise.race([soakDrain, new Promise<number>((r) => setTimeout(() => r(-3), 20_000))]);
      console.log(`[soak] TIMEOUT t=${Date.now()} ${language} req=${requestId} queueDrainMs=${drain.toFixed(0)} ${gpuLiveSummary()} test=${soakExpect.getState().currentTestName ?? "?"}`);
      throw new Error(`${(error as Error).message} [soak queueDrainMs=${drain.toFixed(0)} ${gpuLiveSummary()}]`);
    }
    if (soakDevice) {
      const readbackMs = performance.now() - soakStart;
      const drain = await soakDrain;
      console.log(`[soak] t=${Date.now()} ${language} req=${requestId} readbackMs=${readbackMs.toFixed(1)} queueDrainMs=${drain.toFixed(1)} ${gpuLiveSummary()} test=${soakExpect.getState().currentTestName ?? "?"}`);
    }
    // Output of feedback and iFrame-driven fixtures depends on the exact frame
    // count, so a frame this harness did not ask for must fail loudly rather
    // than shift a pixel assertion or signature.
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
      if (!result?.success) {
        throw new Error(`Shader compilation failed: ${result?.errors?.join("\n") ?? "no result"}`);
      }
      holdFrames();
    },
    holdFrames,
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
