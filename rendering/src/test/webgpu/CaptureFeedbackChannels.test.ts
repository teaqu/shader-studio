import { afterEach, expect, it, vi } from "vitest";
import { captureFeedbackChannels } from "../../webgpu/CaptureFeedbackChannels";
import type { SlangPassPipeline } from "../../webgpu/SlangPassPipeline";

function fixture(throwOnCreate = false) {
  const copyTextureToTexture = vi.fn();
  const created: Array<{ createView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const device = {
    createCommandEncoder: vi.fn(() => ({ copyTextureToTexture, finish: vi.fn(() => ({})) })),
    createTexture: vi.fn(() => {
      if (throwOnCreate) {
        throw new Error("allocation failed");
      }
      const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
      created.push(texture);
      return texture;
    }),
    queue: { submit: vi.fn() },
  } as unknown as GPUDevice;
  const source = { width: 8, height: 4, format: "rgba16float" } as GPUTexture;
  const pass = { channels: [{ slot: 0, kind: "buffer", source: "Compute" }, { slot: 1, kind: "buffer", source: "Compute" }] } as any;
  const resources = [{ slot: 0, textureView: {} as GPUTextureView }, { slot: 1, textureView: {} as GPUTextureView }];
  return { device, source, pass, resources, copyTextureToTexture, created };
}

afterEach(() => vi.unstubAllGlobals());

it('handles no resources, non-buffer resources and missing pipelines without GPU copies', () => {
  const { device, pass, resources } = fixture();
  expect(captureFeedbackChannels(device, pass, new Map(), null)).toBeNull();
  pass.channels = [{ slot: 0, kind: 'texture' }];
  const result = captureFeedbackChannels(device, pass, new Map(), resources)!;
  expect(result.resources).toEqual(resources);
  expect(result.textureCount).toBe(0);
  result.destroy();
  expect(device.queue.submit).not.toHaveBeenCalled();
});

it('copies the previous and current rendered banks when no drawn snapshot is supplied', () => {
  const { device, pass, resources, source, copyTextureToTexture } = fixture();
  pass.channels[0].readFrom = 'previous-frame';
  const current = { ...source } as GPUTexture;
  const previous = source;
  const pipeline = { getCurrentOutputTexture: vi.fn(() => current), getPreviousOutputTexture: vi.fn(() => previous) };
  vi.stubGlobal('GPUTextureUsage', undefined);
  const result = captureFeedbackChannels(device, pass, new Map([['Compute', pipeline as unknown as SlangPassPipeline]]), resources)!;
  expect(copyTextureToTexture.mock.calls.map(([from]) => from.texture)).toEqual([previous, current]);
  expect(device.createTexture).toHaveBeenCalledWith(expect.objectContaining({ usage: 6 }));
  expect(result.textureCount).toBe(2);
  result.destroy();
});

it('retains a buffer resource when its output texture is unavailable', () => {
  const { device, pass, resources } = fixture();
  const result = captureFeedbackChannels(device, pass, new Map(), resources)!;
  expect(result.resources).toEqual(resources);
  expect(result.textureCount).toBe(0);
  expect(device.queue.submit).not.toHaveBeenCalled();
});

it("copies distinct compute layers from the recorded source and deduplicates repeated layers", () => {
  const { device, source, pass, resources, copyTextureToTexture, created } = fixture();
  const result = captureFeedbackChannels(device, pass, new Map(), resources, new Map([
    [0, { texture: source, layer: 1 }], [1, { texture: source, layer: 2 }],
  ]))!;
  expect(created).toHaveLength(2);
  expect(copyTextureToTexture.mock.calls.map(([from]) => from.origin)).toEqual([{ z: 1 }, { z: 2 }]);
  result.destroy();
  expect(created.every(texture => texture.destroy.mock.calls.length === 1)).toBe(true);
});

it("uses a recorded render bank even if the pipeline has swapped", () => {
  const { device, source, pass, resources, copyTextureToTexture } = fixture();
  const pipeline = { getCurrentOutputTexture: vi.fn(() => ({ width: 1, height: 1, format: "rgba16float" })) } as any;
  captureFeedbackChannels(device, pass, new Map([["Compute", pipeline]]), resources, new Map([[0, { texture: source }], [1, { texture: source }]]));
  expect(copyTextureToTexture.mock.calls.every(([from]) => from.texture === source)).toBe(true);
  expect(pipeline.getCurrentOutputTexture).not.toHaveBeenCalled();
});

it("cleans already allocated snapshots when a later allocation fails", () => {
  const { device, source, pass, resources, created } = fixture();
  let calls = 0;
  (device.createTexture as ReturnType<typeof vi.fn>).mockImplementation(() => {
    calls++;
    if (calls === 2) {
      throw new Error("allocation failed");
    }
    const texture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
    created.push(texture);
    return texture;
  });
  expect(() => captureFeedbackChannels(device, pass, new Map(), resources, new Map([[0, { texture: source, layer: 0 }], [1, { texture: source, layer: 1 }]]))).toThrow(/allocation/);
  expect(created[0]!.destroy).toHaveBeenCalledOnce();
});
