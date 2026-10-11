import { ktxVolume } from "../../../../types/test/ktxVolume";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VolumeTextureManager } from "../../resources/VolumeTextureManager";
import type { TextureBackend } from "../../resources/TextureBackend";

function setup() {
  const backend = { createVolumeTexture: vi.fn(() => ({})), destroyTexture: vi.fn() };
  const manager = new VolumeTextureManager(backend as unknown as TextureBackend<object>);
  const buffer = ktxVolume(1, 1, 2, 1, new Uint8Array([0, 255]));
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => buffer }));
  vi.stubGlobal("fetch", fetcher);
  return { backend, manager, fetcher };
}
afterEach(() => vi.unstubAllGlobals());
describe("VolumeTextureManager", () => {
  it("deduplicates pending and cached loads, while keeping sampler variants separate", async () => {
    const { manager, backend, fetcher } = setup();
    const pending = manager.load("density.ktx2");
    expect(manager.load("density.ktx2")).toBe(pending);
    const { texture } = await pending;
    await manager.load("density.ktx2");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(manager.get("density.ktx2")).toBe(texture);
    expect(manager.isLoaded("density.ktx2")).toBe(true);
    await manager.load("density.ktx2", { filter: "nearest", wrap: "clamp" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(backend.createVolumeTexture).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 2 }), "nearest", "clamp");
    manager.cleanup();
    expect(backend.destroyTexture).toHaveBeenCalledTimes(2);
    expect(manager.get("density.ktx2")).toBeNull();
  });
  it("reports decoding failures with a native black 3D fallback and allows retry", async () => {
    const { manager, backend, fetcher } = setup();
    fetcher.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    expect((await manager.load("bad.ktx2")).warning).toContain("header");
    expect(manager.isLoaded("bad.ktx2")).toBe(false);
    expect(backend.createVolumeTexture).toHaveBeenCalledWith({ width: 1, height: 1, depth: 1, channels: 4, data: new Uint8Array([0, 0, 0, 255]) }, "linear", "repeat");
    await manager.load("bad.ktx2");
    expect(manager.isLoaded("bad.ktx2")).toBe(true);
    expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
  });
  it("reports HTTP/network failures", async () => {
    const { manager, fetcher } = setup();
    fetcher.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Awaited<ReturnType<typeof fetcher>>);
    expect((await manager.load("missing.ktx2")).warning).toContain("HTTP 404");
    fetcher.mockRejectedValueOnce(new Error("network unavailable"));
    expect((await manager.load("missing.ktx2")).warning).toContain("network unavailable");
  });
  it("falls back when the device rejects the dimensions", async () => {
    const { manager, backend } = setup();
    backend.createVolumeTexture.mockImplementationOnce(() => {
      throw new Error("device limit");
    });
    expect((await manager.load("big.ktx2")).warning).toContain("device limit");
    expect(backend.createVolumeTexture).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 1 }), "nearest", "clamp");
  });
  it("does not allocate late resources after cleanup, or erase a newer pending load", async () => {
    const { manager, backend, fetcher } = setup();
    let resolve!: (response: Awaited<ReturnType<typeof fetcher>>) => void;
    fetcher.mockImplementationOnce(() => new Promise(done => {
      resolve = done;
    }));
    const old = manager.load("late.ktx2");
    manager.cleanup();
    const current = manager.load("late.ktx2");
    await current;
    resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    expect(await old).toEqual({ texture: null });
    expect(backend.createVolumeTexture).toHaveBeenCalledTimes(1);
    expect(manager.isLoaded("late.ktx2")).toBe(true);
  });
});

it("retains the warning when even the fallback cannot be allocated", async () => {
  const { manager, backend } = setup();
  backend.createVolumeTexture.mockImplementation(() => {
    throw new Error("device lost");
  });
  expect(await manager.load("volume.ktx2")).toEqual({ texture: null, warning: "Volume loading failed: volume.ktx2: device lost" });
});
