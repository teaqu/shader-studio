import type { ShaderConfig } from "@shader-studio/types";
import type { RenderingEngine as RenderingEngineContract } from "../../types/RenderingEngine";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";

export const TEST_CANVAS_SIZE = 2;

export type ShaderLanguage = "glsl" | "slang";
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
  return language === "glsl"
    ? new RenderingEngine()
    : new WebGPURenderingEngine({ scriptUrl: slangScriptUrl, wasmUrl: slangWasmUrl });
}

async function waitForPixelRegion(
  engine: RenderingEngineContract,
  requestId: number,
): Promise<ReturnType<RenderingEngineContract["collectPixelRegionResults"]>[number]> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = engine.collectPixelRegionResults().find((candidate) => candidate.requestId === requestId);
    if (result) {
      return result;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for canvas pixel readback");
}

export function createShaderCanvasHarness(language: ShaderLanguage): ShaderCanvasHarness {
  const canvas = createCanvas();
  const engine = createEngine(language);
  engine.initialize(canvas, true);
  let nextRenderTimestamp = performance.now();
  let currentShaderTime = 0;

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
    engine.render(nextRenderTimestamp);
    return waitForPixelRegion(engine, requestId);
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
        throw new Error(`Shader compilation failed: ${result?.errors.join("\n") ?? "no result"}`);
      }
      const timeManager = engine.getTimeManager();
      timeManager.cleanup();
      timeManager.setSpeed(0);
      timeManager.setTime(0);
      nextRenderTimestamp = performance.now();
      currentShaderTime = 0;
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
