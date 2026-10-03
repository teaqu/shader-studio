import { expect, it } from "vitest";
import { RenderedCaptureState } from "../../webgpu/RenderedCaptureState";

it("freezes mutable frame data while retaining GPU resource identities", () => {
  const state = new RenderedCaptureState();
  const texture = {} as GPUTexture;
  const view = {} as GPUTextureView;
  const mesh = new Float32Array([1, 2, 3]);
  const resources = [{ slot: 0, textureView: view }];
  const inputs = new Map([[0, { texture, layer: 2 }]]);
  state.record("BufferA", {
    time: 1, timeDelta: .1, frameRate: 60, frame: 7, res: [4, 3, 1], mouse: [1, 2, 3, 4], date: [2026, 1, 2, 3], cameraPos: [1, 2, 3], cameraDir: [0, 0, -1], channelTime: [2],
  }, mesh, resources, inputs);
  mesh[0] = 99;
  resources[0]!.slot = 3;
  inputs.clear();
  const frame = state.get("BufferA")!;
  expect(frame.uniforms).toMatchObject({ frame: 7, res: [4, 3, 1], channelTime: [2] });
  expect(frame.meshData).toEqual(new Float32Array([1, 2, 3]));
  expect(frame.channelResources).toEqual([{ slot: 0, textureView: view }]);
  expect(frame.bufferInputs).toEqual(new Map([[0, { texture, layer: 2 }]]));
  state.clear();
  expect(state.get("BufferA")).toBeUndefined();
});
