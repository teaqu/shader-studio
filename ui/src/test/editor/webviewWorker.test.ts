import { describe, expect, it, vi } from "vitest";
import { createWebviewWorker, type WorkerAsset } from "../../lib/editor/webviewWorker";

const workerAsset: WorkerAsset = { url: "/worker.js", mimeType: "text/javascript", mode: "text" };
const wasmAsset: WorkerAsset = { url: "/compiler.wasm", mimeType: "application/wasm", mode: "binary" };

function fixture(responses: Record<string, { ok: boolean; status?: number; body?: string | ArrayBuffer }>) {
  const listeners = new Set<EventListener>();
  const worker = {
    postMessage: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => listeners.delete(listener)),
    terminate: vi.fn(),
  };
  let nextUrl = 0;
  const runtime = {
    fetch: vi.fn(async (url: string) => {
      const response = responses[url] ?? { ok: false, status: 404 };
      return {
        ok: response.ok,
        status: response.status ?? 200,
        text: async () => String(response.body ?? ""),
        arrayBuffer: async () => response.body instanceof ArrayBuffer
          ? response.body
          : new TextEncoder().encode(String(response.body ?? "")).buffer as ArrayBuffer,
      };
    }),
    createObjectURL: vi.fn(() => `blob:asset-${++nextUrl}`),
    revokeObjectURL: vi.fn(),
    createWorker: vi.fn(() => worker as unknown as Worker),
  };
  return { runtime, worker };
}

describe("createWebviewWorker", () => {
  it("loads the worker and supporting assets into revocable blob URLs", async () => {
    const { runtime, worker } = fixture({
      "/worker.js": { ok: true, body: "worker source" },
      "/compiler.wasm": { ok: true, body: new Uint8Array([0, 97, 115, 109]).buffer },
    });

    const bundle = await createWebviewWorker(workerAsset, [wasmAsset], runtime);

    expect(runtime.createWorker).toHaveBeenCalledWith("blob:asset-1");
    expect(bundle.assetUrls).toEqual(["blob:asset-2"]);
    bundle.port.postMessage({ ready: true });
    expect(worker.postMessage).toHaveBeenCalledWith({ ready: true });
    bundle.port.terminate?.();
    bundle.port.terminate?.();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(runtime.revokeObjectURL.mock.calls).toEqual([["blob:asset-1"], ["blob:asset-2"]]);
  });

  it("revokes already-created URLs when a later asset fails to load", async () => {
    const { runtime } = fixture({
      "/worker.js": { ok: true, body: "worker source" },
      "/compiler.wasm": { ok: false, status: 503 },
    });

    await expect(createWebviewWorker(workerAsset, [wasmAsset], runtime)).rejects.toThrow(/503.*compiler\.wasm/);
    expect(runtime.createWorker).not.toHaveBeenCalled();
    expect(runtime.revokeObjectURL).toHaveBeenCalledWith("blob:asset-1");
  });

  it("revokes every URL when worker construction fails", async () => {
    const { runtime } = fixture({
      "/worker.js": { ok: true, body: "worker source" },
      "/compiler.wasm": { ok: true, body: new ArrayBuffer(1) },
    });
    runtime.createWorker.mockImplementation(() => {
      throw new Error("worker denied");
    });

    await expect(createWebviewWorker(workerAsset, [wasmAsset], runtime)).rejects.toThrow("worker denied");
    expect(runtime.revokeObjectURL.mock.calls).toEqual([["blob:asset-1"], ["blob:asset-2"]]);
  });
});
