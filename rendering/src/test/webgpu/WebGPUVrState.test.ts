import { describe, expect, it } from "vitest";
import type { RenderPassNode } from "../../types/PassGraph";
import { WebGPUVrState } from "../../webgpu/WebGPUVrState";
import { emptyVrControllers } from "../../webxr/WebXrFrameData";

const VR = "fn mainVR(c: vec2f, o: vec3f, d: vec3f) -> vec4f { return vec4f(d, 1); }";

function image(overrides: Partial<RenderPassNode> = {}): RenderPassNode {
  return {
    name: "Image", source: `fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }\n${VR}`, language: "wgsl",
    geometry: "fullscreen", kind: "render", output: "canvas", outputLayers: 1, dispatchCount: 1,
    dispatchOnce: false, workgroupSize: [8, 8, 1], width: 4, height: 4, channels: [], ...overrides,
  } as RenderPassNode;
}

describe("WebGPUVrState", () => {
  it("is available for a fullscreen Image that defines mainVR", () => {
    const state = new WebGPUVrState();
    state.update("/a.wgsl", [image()], "");
    expect(state.available).toBe(true);
  });

  it("detects mainVR from Common", () => {
    const state = new WebGPUVrState();
    state.update("/a.wgsl", [image({ source: "fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }" })], VR);
    expect(state.available).toBe(true);
  });

  it.each([
    ["no Image pass", [] as RenderPassNode[]],
    ["no mainVR", [image({ source: "fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }" })]],
    ["mesh geometry", [image({ geometry: "sphere" })]],
    ["a compute Image", [image({ kind: "compute" })]],
    ["an offscreen Image", [image({ output: "texture" })]],
    ["a cubemap Image", [image({ outputKind: "cubemap" })]],
    ["native stages", [image({ entryPoints: { fragment: "fs" } })]],
  ])("is unavailable with %s", (_label, passes) => {
    const state = new WebGPUVrState();
    state.update("/a.wgsl", passes, "");
    expect(state.available).toBe(false);
  });

  it("only enables while available and keeps the preview across recompiles of one shader", () => {
    const state = new WebGPUVrState();
    state.setEnabled(true);
    expect(state.enabled).toBe(false);
    state.update("/a.wgsl", [image()], "");
    state.setEnabled(true);
    expect(state.enabled).toBe(true);
    state.update("/a.wgsl", [image()], "");
    expect(state.enabled).toBe(true);
    state.update("/b.wgsl", [image()], "");
    expect(state.enabled).toBe(false);
    state.setEnabled(true);
    state.update("/b.wgsl", [image({ geometry: "cube" })], "");
    expect(state.enabled).toBe(false);
  });

  it("clears availability and the preview", () => {
    const state = new WebGPUVrState();
    state.update("/a.wgsl", [image()], "");
    state.setEnabled(true);
    state.clear();
    expect(state.available).toBe(false);
    expect(state.enabled).toBe(false);
    state.update("/a.wgsl", [image()], "");
    expect(state.enabled).toBe(false);
  });

  it("limits the desktop preview to Image, the eye to headset draws, and shares controllers", () => {
    const state = new WebGPUVrState();
    state.update("/a.wgsl", [image()], "");
    state.setEnabled(true);
    state.active = true;
    const controllers = emptyVrControllers();
    state.controllers = controllers;
    expect(state.uniforms("BufferA")).toEqual({ preview: false, immersive: false, active: true, controllers });
    expect(state.uniforms("Image")).toEqual({ preview: true, immersive: false, active: true, controllers });
    const eye = { viewport: { x: 0, y: 0, width: 8, height: 6 }, rayTransform: new Float32Array(16) };
    expect(state.uniforms("Image", eye)).toEqual({ preview: true, immersive: true, active: true, controllers, viewport: eye.viewport, rayTransform: eye.rayTransform });
  });

  it("resets session state on exit", () => {
    const state = new WebGPUVrState();
    state.active = true;
    state.controllers.positions[0] = 4;
    state.resetSession();
    expect(state.active).toBe(false);
    expect(state.controllers).toEqual(emptyVrControllers());
  });
});
