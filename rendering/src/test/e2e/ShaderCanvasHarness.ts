import type { ShaderConfig } from "@shader-studio/types";
import type { RenderingEngine as RenderingEngineContract } from "../../types/RenderingEngine";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";

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

/** Readback stage, for failures that must say whether a request was lost or slow. */
function readbackStage(engine: RenderingEngineContract, requestId: number): string {
  return engine instanceof WebGPURenderingEngine || engine instanceof RenderingEngine
    ? engine.getPixelRegionRequestStage(requestId) ?? "not held"
    : "not tracked";
}

export async function waitForPixelRegion(
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
  // A busy main thread can delay the timer past the deadline while the GPU
  // finishes its copy. Check the current result before reporting stale state;
  // this adds no wait, frame or extension of the existing deadline.
  const finalResult = engine.collectPixelRegionResults().find((candidate) => candidate.requestId === requestId);
  if (finalResult) {
    return finalResult;
  }
  // "mapping" (WebGPU) or "pending" (WebGL) means the copy was issued,
  // but its GPU/driver readback has not completed.
  // "queued" means a copy or mapping failure left the request waiting for
  // another frame. This harness never renders that frame, so no wait helps.
  const stage = readbackStage(engine, requestId);
  const meaning = stage === "queued" ? " (its copy was not issued or was re-queued for a frame that never came)" : "";
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
      const timeManager = engine.getTimeManager();
      timeManager.setTime(shaderTime);
      // setTime anchors frame timing to performance.now(), but this harness
      // drives a synthetic clock. Keep its last frame on that same timeline
      // so a wall-clock coincidence cannot trigger the duplicate-frame guard.
      timeManager.updateFrame(nextRenderTimestamp);
      currentShaderTime = shaderTime;
    }
    nextRenderTimestamp += 1000 / 60;
    const frameBefore = engine.getTimeManager().getFrame();
    engine.render(nextRenderTimestamp);
    // The copy is encoded inside render(). A request still queued afterwards
    // was skipped by that frame (nothing drew to the canvas), and since no
    // further frame is coming it would only surface as a readback timeout.
    if (readbackStage(engine, requestId) === "queued") {
      throw new Error(`${language} frame did not encode canvas readback request ${requestId}`);
    }
    const result = await waitForPixelRegion(engine, requestId);
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
