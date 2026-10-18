import { describe, expect, it, vi } from "vitest";
import { initialDataFingerprint, loadStorageInitialData } from "../../webgpu/StorageInitialData";
import type { StorageBindingNode } from "../../types/PassGraph";

function node(overrides: Partial<StorageBindingNode> = {}): StorageBindingNode {
  return { name: "values", binding: 0, elementType: "u32", builtin: true, count: 4, stride: 4, ...overrides };
}

function response(bytes: number[], init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as Response;
}

describe("loadStorageInitialData", () => {
  it("leaves zero-initialised storage untouched without fetching", async () => {
    const fetchBytes = vi.fn();
    const zero = node();
    await expect(loadStorageInitialData([zero], fetchBytes)).resolves.toEqual([]);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(zero.initialBytes).toBeUndefined();
  });

  it("fetches the resolved URL and stores the raw bytes", async () => {
    const fetchBytes = vi.fn(async () => response([1, 2, 3]));
    const target = node({ initialDataPath: "data.bin", initialDataUrl: "https://host/data.bin" });
    await expect(loadStorageInitialData([target], fetchBytes)).resolves.toEqual([]);
    expect(fetchBytes).toHaveBeenCalledWith("https://host/data.bin");
    expect(target.initialBytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("accepts a file that exactly fills the buffer and has no fixed size cap", async () => {
    const size = 512 * 1024;
    const big = node({ count: size / 4, initialDataPath: "big.bin", initialDataUrl: "big.bin" });
    const fetchBytes = vi.fn(async () => response(Array.from({ length: size }, (_, i) => i & 0xff)));
    await expect(loadStorageInitialData([big], fetchBytes)).resolves.toEqual([]);
    expect(big.initialBytes?.byteLength).toBe(size);
  });

  it("reports a file larger than the buffer and clears stale bytes", async () => {
    const target = node({ count: 1, initialDataPath: "data.bin", initialDataUrl: "u", initialBytes: new Uint8Array([9]) });
    const errors = await loadStorageInitialData([target], async () => response([1, 2, 3, 4, 5]));
    expect(errors).toEqual(['Storage values: initial data file "data.bin" is 5 bytes but the buffer holds 4 bytes']);
    expect(target.initialBytes).toBeUndefined();
  });

  it("reports HTTP failures with the configured path", async () => {
    const target = node({ initialDataPath: "missing.bin", initialDataUrl: "u" });
    const errors = await loadStorageInitialData([target], async () => response([], { ok: false, status: 404 }));
    expect(errors).toEqual(['Storage values: unable to load initial data file "missing.bin" (HTTP 404)']);
  });

  it("reports thrown and non-Error fetch failures", async () => {
    const a = node({ name: "a", initialDataPath: "a.bin", initialDataUrl: "a" });
    const b = node({ name: "b", initialDataPath: "b.bin", initialDataUrl: "b" });
    const errors = await loadStorageInitialData([a, b], async (url) => {
      if (url === "a") {
        throw new Error("offline");
      }
      // eslint-disable-next-line no-throw-literal -- covers fetch implementations that reject with non-Error values
      throw "denied";
    });
    expect(errors).toEqual([
      'Storage a: unable to load initial data file "a.bin" (offline)',
      'Storage b: unable to load initial data file "b.bin" (denied)',
    ]);
  });

  it("falls back to the URL in messages when no display path is known", async () => {
    const target = node({ initialDataUrl: "blob:abc" });
    const errors = await loadStorageInitialData([target], async () => response([], { ok: false, status: 500 }));
    expect(errors[0]).toContain('"blob:abc"');
  });

  it("uses global fetch by default", async () => {
    const fetchMock = vi.fn(async () => response([7]));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const target = node({ initialDataPath: "d.bin", initialDataUrl: "https://host/d.bin" });
      await expect(loadStorageInitialData([target])).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledWith("https://host/d.bin");
      expect(target.initialBytes).toEqual(new Uint8Array([7]));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("initialDataFingerprint", () => {
  it("is undefined without bytes and changes with content or length", () => {
    expect(initialDataFingerprint(undefined)).toBeUndefined();
    const a = initialDataFingerprint(new Uint8Array([1, 2, 3]));
    expect(initialDataFingerprint(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(initialDataFingerprint(new Uint8Array([1, 2, 4]))).not.toBe(a);
    expect(initialDataFingerprint(new Uint8Array([1, 2, 3, 0]))).not.toBe(a);
    expect(initialDataFingerprint(new Uint8Array([]))).toBe("0:811c9dc5");
  });
});
