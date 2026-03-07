import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VolumeTextureManager } from "../../resources/VolumeTextureManager";
import type { PiRenderer, PiTexture } from "../../types/piRenderer";

const createMockRenderer = (): PiRenderer => {
  let textureId = 0;
  return {
    FILTER: { LINEAR: 1, NONE: 0, MIPMAP: 2 },
    TEXFMT: { C4I8: 1 },
    TEXTYPE: { T2D: 0, T3D: 2 },
    TEXWRP: { CLAMP: 0, REPEAT: 1 },

    CreateTexture: vi.fn(() => ({
      mObjectID: { id: ++textureId },
      mXres: 0,
      mYres: 0,
      mFormat: 1,
      mType: 2,
      mFilter: 1,
      mWrap: 1,
      mVFlip: true,
    })),
    DestroyTexture: vi.fn(),
    CreateTextureFromImage: vi.fn(),
    UpdateTexture: vi.fn(),
    UpdateTextureFromImage: vi.fn(),
    CreateRenderTarget: vi.fn(),
    CreateShader: vi.fn(),
    DestroyRenderTarget: vi.fn(),
    DestroyShader: vi.fn(),
    SetRenderTarget: vi.fn(),
    SetViewport: vi.fn(),
    AttachShader: vi.fn(),
    SetShaderTextureUnit: vi.fn(),
    AttachTextures: vi.fn(),
    GetAttribLocation: vi.fn(() => 0),
    DrawUnitQuad_XY: vi.fn(),
    Flush: vi.fn(),
  } as unknown as PiRenderer;
};

// Helper to create binary volume data with header
const createVolumeDataWithHeader = (w: number, h: number, d: number): ArrayBuffer => {
  const dataSize = w * h * d * 4; // RGBA
  const buffer = new ArrayBuffer(12 + dataSize);
  const view = new DataView(buffer);
  view.setUint32(0, w, true);
  view.setUint32(4, h, true);
  view.setUint32(8, d, true);
  // Fill pixel data with pattern
  const pixels = new Uint8Array(buffer, 12);
  for (let i = 0; i < dataSize; i++) {
    pixels[i] = i % 256;
  }
  return buffer;
};

// Helper to create cubic volume data without header
const createCubicVolumeData = (size: number): ArrayBuffer => {
  const dataSize = size * size * size * 4; // RGBA
  const buffer = new ArrayBuffer(dataSize);
  const data = new Uint8Array(buffer);
  for (let i = 0; i < dataSize; i++) {
    data[i] = i % 256;
  }
  return buffer;
};

describe("VolumeTextureManager", () => {
  let mockRenderer: PiRenderer;
  let manager: VolumeTextureManager;

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    manager = new VolumeTextureManager(mockRenderer);

    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
  });

  describe("loadVolumeTexture with header", () => {
    it("should load volume texture from binary data with header", async () => {
      const volumeData = createVolumeDataWithHeader(8, 8, 8);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      const texture = await manager.loadVolumeTexture("volume.bin");

      expect(texture).toBeDefined();
      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T3D,
        8,       // width
        8 * 8,   // height * depth
        mockRenderer.TEXFMT.C4I8,
        mockRenderer.FILTER.LINEAR,  // default filter
        mockRenderer.TEXWRP.REPEAT,  // default wrap
        expect.any(Uint8Array),
      );
    });
  });

  describe("loadVolumeTexture with cubic data", () => {
    it("should infer cubic dimensions from data size", async () => {
      const volumeData = createCubicVolumeData(4); // 4x4x4

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      const texture = await manager.loadVolumeTexture("cube.bin");

      expect(texture).toBeDefined();
      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        mockRenderer.TEXTYPE.T3D,
        4,       // width
        4 * 4,   // height * depth
        mockRenderer.TEXFMT.C4I8,
        expect.any(Number),
        expect.any(Number),
        expect.any(Uint8Array),
      );
    });
  });

  describe("caching", () => {
    it("should return cached texture for same path", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      const texture1 = await manager.loadVolumeTexture("volume.bin");
      const texture2 = await manager.loadVolumeTexture("volume.bin");

      expect(texture1).toBe(texture2);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getVolumeTexture", () => {
    it("should return null for unloaded path", () => {
      expect(manager.getVolumeTexture("nonexistent.bin")).toBeNull();
    });

    it("should return texture after loading", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      const loaded = await manager.loadVolumeTexture("test.bin");
      const retrieved = manager.getVolumeTexture("test.bin");

      expect(retrieved).toBe(loaded);
    });
  });

  describe("filter options", () => {
    it("should use LINEAR filter by default", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      await manager.loadVolumeTexture("volume.bin");

      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.anything(),
        mockRenderer.FILTER.LINEAR,
        expect.anything(), expect.anything(),
      );
    });

    it("should use NONE filter for nearest", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      await manager.loadVolumeTexture("volume.bin", { filter: "nearest" });

      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.anything(),
        mockRenderer.FILTER.NONE,
        expect.anything(), expect.anything(),
      );
    });

    it("should use MIPMAP filter for mipmap", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      await manager.loadVolumeTexture("volume.bin", { filter: "mipmap" });

      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.anything(),
        mockRenderer.FILTER.MIPMAP,
        expect.anything(), expect.anything(),
      );
    });
  });

  describe("wrap options", () => {
    it("should use REPEAT wrap by default", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      await manager.loadVolumeTexture("volume.bin");

      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), expect.anything(),
        mockRenderer.TEXWRP.REPEAT,
        expect.anything(),
      );
    });

    it("should use CLAMP wrap when specified", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      await manager.loadVolumeTexture("volume.bin", { wrap: "clamp" });

      expect(mockRenderer.CreateTexture).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), expect.anything(),
        mockRenderer.TEXWRP.CLAMP,
        expect.anything(),
      );
    });
  });

  describe("error handling", () => {
    it("should throw when fetch fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await expect(manager.loadVolumeTexture("bad.bin")).rejects.toThrow(
        "Failed to fetch volume data"
      );
    });

    it("should throw when dimensions cannot be inferred", async () => {
      // 100 bytes doesn't match any cubic dimension
      const badData = new ArrayBuffer(100);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(badData),
      } as Response);

      await expect(manager.loadVolumeTexture("bad.bin")).rejects.toThrow(
        "Cannot infer 3D texture dimensions"
      );
    });

    it("should throw when texture creation fails", async () => {
      const volumeData = createCubicVolumeData(4);
      (mockRenderer.CreateTexture as any).mockReturnValueOnce(null);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      await expect(manager.loadVolumeTexture("volume.bin")).rejects.toThrow(
        "Failed to create 3D texture"
      );
    });
  });

  describe("cleanup", () => {
    it("should destroy all loaded textures", async () => {
      const volumeData = createCubicVolumeData(4);

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(volumeData),
      } as Response);

      await manager.loadVolumeTexture("vol1.bin");
      await manager.loadVolumeTexture("vol2.bin");

      manager.cleanup();

      expect(mockRenderer.DestroyTexture).toHaveBeenCalledTimes(2);
      expect(manager.getVolumeTexture("vol1.bin")).toBeNull();
      expect(manager.getVolumeTexture("vol2.bin")).toBeNull();
    });

    it("should handle cleanup when no textures loaded", () => {
      expect(() => manager.cleanup()).not.toThrow();
    });
  });
});
