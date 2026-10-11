/// <reference types="vite/client" />
import { ktxVolume } from "../../../../types/test/ktxVolume";
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import type { ConfigInput, ShaderConfig, VolumeConfigInput } from "@shader-studio/types";
import ChannelConfigModal from "../../../../ui/src/lib/components/config/ChannelConfigModal.svelte";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import scriptUrl from "../../../../ui/src/slang/slang-wasm.js?url";
import wasmUrl from "../../../../ui/src/slang/slang-wasm.wasm?url";
import cloudsGlsl from "../../../../tests/fixtures/shader-corpus/glsl/volume-input/clouds.glsl?raw";
import cloudsSlang from "../../../../tests/fixtures/shader-corpus/slang/volume-input/clouds.slang?raw";
import tomographyGlsl from "../../../../tests/fixtures/shader-corpus/glsl/volume-input/tomography.glsl?raw";
import tomographySlang from "../../../../tests/fixtures/shader-corpus/slang/volume-input/tomography.slang?raw";
import densityUrl from "../../../../tests/fixtures/shader-corpus/assets/volume-input/cloud-density.ktx2?url";

import greyNoiseUrl from "../../../../tests/fixtures/shader-corpus/assets/volume-input/noise-grey.ktx2?url";
import rgbaNoiseUrl from "../../../../tests/fixtures/shader-corpus/assets/volume-input/noise-rgba.ktx2?url";
import noiseGlsl from "../../../../tests/fixtures/shader-corpus/glsl/volume-input/noise.glsl?raw";
import noiseSlang from "../../../../tests/fixtures/shader-corpus/slang/volume-input/noise.slang?raw";
import rgbaNoiseGlsl from "../../../../tests/fixtures/shader-corpus/glsl/volume-input/noise-rgba.glsl?raw";
import rgbaNoiseSlang from "../../../../tests/fixtures/shader-corpus/slang/volume-input/noise-rgba.slang?raw";

import cloudsWgsl from "../../../../tests/fixtures/shader-corpus/wgsl/volume-input/clouds.wgsl?raw";
import tomographyWgsl from "../../../../tests/fixtures/shader-corpus/wgsl/volume-input/tomography.wgsl?raw";
import noiseWgsl from "../../../../tests/fixtures/shader-corpus/wgsl/volume-input/noise.wgsl?raw";
import rgbaNoiseWgsl from "../../../../tests/fixtures/shader-corpus/wgsl/volume-input/noise-rgba.wgsl?raw";

function volumeUrl() {
  const data = new Uint8Array(2 * 3 * 4 * 4);
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 2; x++) {
        data.set([x * 255, Math.round(y * 127.5), z * 85, 255], ((z * 3 + y) * 2 + x) * 4);
      }
    }
  }
  return URL.createObjectURL(new Blob([ktxVolume(2, 3, 4, 4, data)]));
}

async function selectVolume(path: string, saved?: ConfigInput) {
  let input = saved;
  const component = render(ChannelConfigModal, { isOpen: true, channelName: "iChannel0", channelInput: saved,
    getWebviewUri: () => undefined, onClose: () => {}, onRemove: () => {}, onSave: (_key: string, value: ConfigInput) => {
      input = value;
    } });
  if (!saved) {
    await fireEvent.click(component.getByRole("tab", { name: "Volumes" }));
    await fireEvent.input(component.getByPlaceholderText("Path to volume .ktx2 file"), { target: { value: path } });
    await fireEvent.change(component.getByLabelText("Wrap X / Y / Z"), { target: { value: "clamp" } });
  }
  expect(component.getByRole("tab", { name: "Volumes" }).getAttribute("aria-selected")).toBe("true");
  expect(component.getByLabelText("Filter")).toHaveProperty("value", "linear");
  expect(component.getByLabelText("Wrap X / Y / Z")).toHaveProperty("value", "clamp");
  await expect.poll(() => component.queryByText("2 × 3 × 4 · RGBA8")).not.toBeNull();
  cleanup();
  return input!;
}

describe("volume inputs in the browser host", () => {
  it.each(["glsl", "slang", "wgsl"] as const)("selects, samples and reloads a known volume in %s", async language => {
    const path = volumeUrl();
    const input = await selectVolume(path);
    const config: ShaderConfig = { version: "1.0", passes: { Image: { inputs: { iChannel0: input } } } };
    const persisted: ShaderConfig = JSON.parse(JSON.stringify(config));
    await selectVolume(path, persisted.passes.Image.inputs!.iChannel0);
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 2;
    document.body.appendChild(canvas);
    const engine = language === "glsl" ? new RenderingEngine() : new WebGPURenderingEngine({ scriptUrl, wasmUrl }, language === "wgsl" ? "wgsl" : "slang");
    try {
      engine.initialize(canvas, true);
      const coords = [
        { point: "0.25, 0.16666667, 0.125", rgb: [0, 0, 0] },
        { point: "0.75, 0.83333333, 0.875", rgb: [255, 255, 255] },
        { point: "0.25, 0.16666667, 0.5", rgb: [0, 0, 128] },
        { point: "0.25, 0.16666667, 0.5", rgb: [0, 0, 170], filter: "nearest" as const },
        { point: "1.25, 0.16666667, 0.125", rgb: [0, 0, 0], wrap: "repeat" as const },
        { point: "1.25, 0.16666667, 0.125", rgb: [255, 0, 0], wrap: "clamp" as const },
      ];
      let id = 0;
      for (const { point, rgb, filter = "linear", wrap = "clamp" } of coords) {
        const channel = persisted.passes.Image.inputs!.iChannel0 as VolumeConfigInput;
        channel.filter = filter;
        channel.wrap = wrap;
        const source = language === "glsl"
          ? `void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, vec3(${point})); if (iCh0.loaded != 1 || any(notEqual(iCh0.size, vec3(2,3,4)))) c = vec4(1,0,1,1); }`
          : language === "slang"
            ? `float4 mainImage(float2 p) { if (!iChannel0.loaded || any(iChannel0.size != uint3(2,3,4))) return float4(1,0,1,1); return iChannel0.SampleLevel(float3(${point}), 0.0); }`
            : `fn mainImage(p: vec2f) -> vec4f { if (!iChannel0Loaded() || any(iChannel0Size() != vec3u(2,3,4))) { return vec4f(1,0,1,1); } return iChannel0SampleLevel(vec3f(${point}), 0.0); }`;
        const result = await engine.compileShaderPipeline(source, persisted, `volume.${language}`);
        expect(result?.errors ?? [], JSON.stringify(result)).toEqual([]);
        expect(result?.success).toBe(true);
        let pixel: number[];
        if (engine instanceof RenderingEngine) {
          engine.renderForCapture();
          const value = engine.readPixel(0, 0)!;
          pixel = [value.r, value.g, value.b];
        } else {
          const requestId = ++id;
          expect(engine.requestPixelRegion(requestId, 0, 0)).toBe(true);
          engine.renderForCapture();
          let rgba: Uint8ClampedArray | undefined;
          await vi.waitFor(() => {
            rgba = engine.collectPixelRegionResults().find(value => value.requestId === requestId)?.rgba;
            expect(rgba).toBeDefined();
          }, { timeout: 10000 });
          // The inspector pads the clipped canvas into a 60 × 60 region.
          const offset = (30 * 60 + 30) * 4;
          pixel = Array.from(rgba!.slice(offset, offset + 3));
        }
        pixel.forEach((value, index) => expect(Math.abs(value - rgb[index]), `${language} ${point}: pixel ${pixel}, expected ${rgb}`).toBeLessThanOrEqual(1));
      }
    } finally {
      engine.dispose(); canvas.remove(); URL.revokeObjectURL(path); cleanup();
    }
  });
});


describe("bundled volume visual samples", () => {
  it.each([
    { name: "clouds", language: "wgsl" as const, code: cloudsWgsl, path: densityUrl, size: 48, wrap: "clamp" as const },
    { name: "tomography", language: "wgsl" as const, code: tomographyWgsl, path: densityUrl, size: 48, wrap: "clamp" as const },
    { name: "clouds", language: "glsl" as const, code: cloudsGlsl, path: densityUrl, size: 48, wrap: "clamp" as const },
    { name: "clouds", language: "slang" as const, code: cloudsSlang, path: densityUrl, size: 48, wrap: "clamp" as const },
    { name: "tomography", language: "glsl" as const, code: tomographyGlsl, path: densityUrl, size: 48, wrap: "clamp" as const },
    { name: "tomography", language: "slang" as const, code: tomographySlang, path: densityUrl, size: 48, wrap: "clamp" as const },
    { name: "noise-grey", language: "glsl" as const, code: noiseGlsl, path: greyNoiseUrl, size: 32, wrap: "repeat" as const },
    { name: "noise-grey", language: "slang" as const, code: noiseSlang, path: greyNoiseUrl, size: 32, wrap: "repeat" as const },
    { name: "noise-rgba", language: "glsl" as const, code: rgbaNoiseGlsl, path: rgbaNoiseUrl, size: 32, wrap: "repeat" as const },
    { name: "noise-rgba", language: "slang" as const, code: rgbaNoiseSlang, path: rgbaNoiseUrl, size: 32, wrap: "repeat" as const },
    { name: "noise", language: "wgsl" as const, code: noiseWgsl, path: greyNoiseUrl, size: 32 },
    { name: "noise-rgba", language: "wgsl" as const, code: rgbaNoiseWgsl, path: rgbaNoiseUrl, size: 32 },
  ])("renders $name in $language from the bundled volume", async ({ name, language, code, path, size, wrap }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    document.body.appendChild(canvas);
    const engine = language === "glsl" ? new RenderingEngine() : new WebGPURenderingEngine({ scriptUrl, wasmUrl }, language === "wgsl" ? "wgsl" : "slang");
    try {
      engine.initialize(canvas, true);
      const config: ShaderConfig = { version: "1.0", passes: { Image: { inputs: { iChannel0: { type: "volume", path, filter: "linear", wrap } } } } };
      const result = await engine.compileShaderPipeline(code, config, `${name}.${language}`);
      expect(result?.errors ?? [], JSON.stringify(result)).toEqual([]);
      expect(result?.success).toBe(true);
      engine.renderForCapture();
      if (engine instanceof RenderingEngine) {
        const value = engine.readPixel(32, 32)!;
        expect(value.r + value.g + value.b).toBeGreaterThan(30);
      } else {
        expect(engine.getCaptureUniforms().channelLoaded?.[0]).toBe(1);
        expect(engine.getCaptureUniforms().channelResolution?.slice(0, 3)).toEqual([size, size, size]);
        expect(engine.requestPixelRegion(1, 32, 32)).toBe(true);
        engine.renderForCapture();
        let pixels: Uint8ClampedArray | undefined;
        await vi.waitFor(() => {
          pixels = engine.collectPixelRegionResults().find(value => value.requestId === 1)?.rgba;
          expect(pixels).toBeDefined();
        }, { timeout: 10000 });
        const offset = (30 * 60 + 30) * 4;
        expect(pixels![offset] + pixels![offset + 1] + pixels![offset + 2]).toBeGreaterThan(30);
      }
    } finally {
      engine.dispose(); canvas.remove();
    }
  });
});
