import { expect, it, vi } from "vitest";
import { renderedBufferInputs } from "../../webgpu/RenderedBufferInputs";
import type { RenderPassChannel } from "../../types/PassGraph";

it("captures a paused compute source's previously rendered bank and selected array layer", () => {
  const current = {} as GPUTexture;
  const previous = {} as GPUTexture;
  const compute = new Map([["Simulation", { getCurrentOutputTexture: () => current, getPreviousOutputTexture: () => previous }]]);
  const channels: RenderPassChannel[] = [{ kind: "buffer", key: "iChannel0", slot: 0, source: "Simulation", readFrom: "current-frame", layer: 3 }];
  expect(renderedBufferInputs(channels, new Map(), compute, new Set()).get(0)).toEqual({ texture: previous, layer: 3 });
  expect(renderedBufferInputs(channels, new Map(), compute, new Set(["Simulation"])).get(0)).toEqual({ texture: current, layer: 3 });
  expect(renderedBufferInputs([{ ...channels[0]!, readFrom: "previous-frame" }], new Map(), compute, new Set(["Simulation"])).get(0)).toEqual({ texture: previous, layer: 3 });
});

it("records independent MRT attachment indices and the original feedback timing", () => {
  const first = {} as GPUTexture;
  const oldSecond = {} as GPUTexture;
  const render = { getCurrentOutputTexture: vi.fn(() => first), getPreviousOutputTexture: vi.fn(() => oldSecond) };
  const channels: RenderPassChannel[] = [
    { kind: "buffer", key: "colour", slot: 0, source: "Scene", readFrom: "current-frame" },
    { kind: "buffer", key: "normal", slot: 1, source: "Scene", readFrom: "previous-frame", output: 1 },
    { kind: "buffer", key: "missing", slot: 2, source: "Missing", readFrom: "current-frame" },
    { kind: "keyboard", key: "keyboard", slot: 3 },
  ];
  expect(renderedBufferInputs(channels, new Map([["Scene", render]]), new Map(), new Set())).toEqual(new Map([[0, { texture: first }], [1, { texture: oldSecond }]]));
  expect(render.getCurrentOutputTexture).toHaveBeenCalledWith(0);
  expect(render.getPreviousOutputTexture).toHaveBeenCalledWith(1);
});
