import { describe, expect, it } from "vitest";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";
import type { VrEyeView } from "../../webxr/WebXrFrameData";

describe("desktop mainVR rendering", () => {
  it("does not reserve controller names or change mainImage in imported Shadertoy code", async () => {
    const harness = createShaderCanvasHarness("glsl");
    try {
      await harness.compile({ image: `
        const bool iVRActive = true;
        const float iVRControllerButtons = 1.0;
        uniform float iVRControllerAxes;
        void mainImage(out vec4 c, in vec2 p) {
          c = vec4(iVRActive ? 1.0 : 0.0, iVRControllerButtons, iVRControllerAxes, 1.0);
        }
        void mainVR(out vec4 c, in vec2 p, in vec3 origin, in vec3 direction) {
          c = vec4(0.0, 0.0, 1.0, 1.0);
        }` });
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 255, 0, 255]));
      harness.engine.setVrPreviewEnabled?.(true);
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([0, 0, 255, 255]));
      harness.engine.setVrPreviewEnabled?.(false);
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 255, 0, 255]));
    } finally {
      harness.dispose();
    }
  });
  it("renders normalized rays and responds to desktop camera movement", async () => {
    const harness = createShaderCanvasHarness("glsl");
    try {
      await harness.compile({ image: `
        void mainImage(out vec4 color, in vec2 coord) { color = vec4(1.0, 0.0, 0.0, 1.0); }
        void mainVR(out vec4 color, in vec2 coord, in vec3 origin, in vec3 direction) {
          color = vec4(direction.xy * 0.5 + 0.5, clamp(length(origin), 0.0, 1.0), 1.0);
        }` });
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
      expect(harness.engine.isVrPreviewAvailable?.()).toBe(true);
      harness.engine.setVrPreviewEnabled?.(true);
      const pixels = await harness.renderAndReadPixels();
      expect(pixels[0][0]).not.toBe(pixels[1][0]);
      expect(pixels[0][1]).not.toBe(pixels[2][1]);
      expect(pixels.every((pixel) => pixel[2] === 0 && pixel[3] === 255)).toBe(true);
      const event = new KeyboardEvent("keydown", { key: "w", code: "KeyW" });
      Object.defineProperty(event, "keyCode", { value: 87 });
      window.dispatchEvent(event);
      await harness.renderAndReadPixels();
      const moved = await harness.renderAndReadPixels();
      const release = new KeyboardEvent("keyup", { key: "w", code: "KeyW" });
      Object.defineProperty(release, "keyCode", { value: 87 });
      window.dispatchEvent(release);
      expect(moved.some((pixel) => pixel[2] > 0)).toBe(true);
      harness.engine.setVrPreviewEnabled?.(false);
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
    } finally {
      harness.dispose();
    }
  });
});

const WEBGPU_SOURCES = {
  wgsl: {
    flags: `
      fn mainImage(c: vec2f) -> vec4f { return vec4f(1.0, 1.0, 0.0, 1.0); }
      fn mainVR(c: vec2f, origin: vec3f, direction: vec3f) -> vec4f { return vec4f(0.0, 0.0, 1.0, 1.0); }`,
    rays: `
      fn mainImage(c: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }
      fn mainVR(c: vec2f, origin: vec3f, direction: vec3f) -> vec4f {
        return vec4f(direction.xy * 0.5 + 0.5, clamp(length(origin), 0.0, 1.0), 1.0);
      }`,
    controllers: `
      fn mainImage(c: vec2f) -> vec4f {
        let input = iVRControllerPosition[0] + iVRControllerDirection[1] + iVRControllerButtons[0] + iVRControllerAxes[1]
          + iVRControllerFaceButtons[0] + iVRControllerTouches[1] + iVRControllerFaceTouches[0];
        return select(vec4f(0.0, 1.0, length(input), 1.0), vec4f(1.0, 0.0, 0.0, 1.0), iVRActive);
      }`,
    eye: `
      fn mainImage(c: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }
      fn mainVR(c: vec2f, origin: vec3f, direction: vec3f) -> vec4f {
        if (c.x < 4.0) { return vec4f(origin, 1.0); }
        return vec4f(direction * 0.5 + 0.5, 1.0);
      }`,
  },
  slang: {
    flags: `
      float4 mainImage(float2 c) { return float4(1, 1, 0, 1); }
      float4 mainVR(float2 c, float3 origin, float3 direction) { return float4(0, 0, 1, 1); }`,
    rays: `
      float4 mainImage(float2 c) { return float4(1, 0, 0, 1); }
      float4 mainVR(float2 c, float3 origin, float3 direction) {
        return float4(direction.xy * 0.5 + 0.5, clamp(length(origin), 0.0, 1.0), 1);
      }`,
    controllers: `
      float4 mainImage(float2 c) {
        float4 input = iVRControllerPosition[0] + iVRControllerDirection[1] + iVRControllerButtons[0] + iVRControllerAxes[1]
          + iVRControllerFaceButtons[0] + iVRControllerTouches[1] + iVRControllerFaceTouches[0];
        return iVRActive ? float4(1, 0, 0, 1) : float4(0, 1, length(input), 1);
      }`,
    eye: `
      float4 mainImage(float2 c) { return float4(1, 0, 0, 1); }
      float4 mainVR(float2 c, float3 origin, float3 direction) {
        if (c.x < 4.0) { return float4(origin, 1); }
        return float4(direction * 0.5 + 0.5, 1);
      }`,
  },
} as const;

interface EyeRenderer {
  renderVrEye(view: VrEyeView, eye: number): HTMLCanvasElement | null;
}

/**
 * Reads the eye texture through WebGPU. Headless Chromium returns blank
 * snapshots of WebGPU canvases to 2D and WebGL (even for a bare clear),
 * while headed browsers, where headsets run, copy them correctly.
 */
async function readEye(canvas: HTMLCanvasElement, device: GPUDevice): Promise<Uint8Array> {
  const texture = (canvas.getContext("webgpu") as GPUCanvasContext).getCurrentTexture();
  const bytesPerRow = 256;
  const buffer = device.createBuffer({ size: bytesPerRow * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width: texture.width, height: texture.height });
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const rows = new Uint8Array(buffer.getMappedRange());
  const rgba = new Uint8Array(texture.width * texture.height * 4);
  for (let y = 0; y < texture.height; y++) {
    for (let x = 0; x < texture.width; x++) {
      const from = y * bytesPerRow + x * 4;
      const [r, g, b, a] = rows.slice(from, from + 4);
      // Normalise BGRA presentation formats to RGBA.
      rgba.set(texture.format.startsWith("bgra") ? [b, g, r, a] : [r, g, b, a], (y * texture.width + x) * 4);
    }
  }
  buffer.unmap();
  buffer.destroy();
  return rgba;
}

describe.each(["wgsl", "slang"] as const)("%s desktop and headset mainVR rendering", (language) => {
  const sources = WEBGPU_SOURCES[language];

  it("switches the Image between mainImage and mainVR", async () => {
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ image: sources.flags });
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 255, 0, 255]));
      expect(harness.engine.isVrPreviewAvailable?.()).toBe(true);
      harness.engine.setVrPreviewEnabled?.(true);
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([0, 0, 255, 255]));
      harness.engine.setVrPreviewEnabled?.(false);
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 255, 0, 255]));
    } finally {
      harness.dispose();
    }
  });

  it("renders normalized rays and responds to desktop camera movement", async () => {
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ image: sources.rays });
      harness.engine.setVrPreviewEnabled?.(true);
      const pixels = await harness.renderAndReadPixels();
      expect(pixels[0][0]).not.toBe(pixels[1][0]);
      expect(pixels[0][1]).not.toBe(pixels[2][1]);
      expect(pixels.every((pixel) => pixel[2] === 0 && pixel[3] === 255)).toBe(true);
      const event = new KeyboardEvent("keydown", { key: "w", code: "KeyW" });
      Object.defineProperty(event, "keyCode", { value: 87 });
      window.dispatchEvent(event);
      await harness.renderAndReadPixels();
      const moved = await harness.renderAndReadPixels();
      const release = new KeyboardEvent("keyup", { key: "w", code: "KeyW" });
      Object.defineProperty(release, "keyCode", { value: 87 });
      window.dispatchEvent(release);
      expect(moved.some((pixel) => pixel[2] > 0)).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it("supplies zeroed controller inputs outside a headset session", async () => {
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ image: sources.controllers });
      expect(harness.engine.isVrPreviewAvailable?.()).toBe(false);
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([0, 255, 0, 255]));
    } finally {
      harness.dispose();
    }
  });

  it("renders a headset eye from its tracked origin and ray basis", async () => {
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ image: sources.eye });
      await harness.renderAndReadPixels();
      // Identity orientation looking down -z from (0.2, 0.4, 0.6), as buildVrEyeView encodes it.
      const rayTransform = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0.2, 0.4, 0.6, 1]);
      const eye = (harness.engine as unknown as EyeRenderer).renderVrEye({ viewport: { x: 0, y: 0, width: 8, height: 8 }, rayTransform }, 0);
      expect(eye).not.toBeNull();
      const rgba = await readEye(eye!, (harness.engine as unknown as { device: GPUDevice }).device);
      const pixel = (x: number, y: number) => Array.from(rgba.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4));
      expect(pixel(1, 4)).toEqual([51, 102, 153, 255]);
      const ray = pixel(6, 4);
      // Right of centre looks right (+x) and forward (-z), level with the eye.
      expect(ray[0]).toBeGreaterThan(140);
      expect(Math.abs(ray[1] - 128)).toBeLessThan(40);
      expect(ray[2]).toBeLessThan(40);
      // The desktop canvas is untouched by the eye draw.
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([255, 0, 0, 255]));
    } finally {
      harness.dispose();
    }
  });
});
