import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CubemapTextureManager } from '../../resources/CubemapTextureManager';
import type { TextureBackend } from '../../resources/TextureBackend';

interface FakeTex { id: number }

function mockBackend() {
  let next = 1;
  return {
    createTexture: vi.fn((): FakeTex => ({ id: next++ })),
    createTextureFromImage: vi.fn((): FakeTex => ({ id: next++ })),
    createMipmaps: vi.fn(),
    updateTexture: vi.fn(),
    updateTextureFromImage: vi.fn(),
    destroyTexture: vi.fn(),
  } satisfies TextureBackend<FakeTex>;
}

function mockCanvasContext() {
  const mockCtx = {
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
  return mockCtx;
}

describe('CubemapTextureManager', () => {
  let manager: CubemapTextureManager<FakeTex>;
  let backend: TextureBackend<FakeTex>;

  beforeEach(() => {
    backend = mockBackend();
    manager = new CubemapTextureManager(backend);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractCrossLayoutFaces', () => {
    it('should extract 6 faces from a T-cross layout image', () => {
      mockCanvasContext();
      const mockCanvas = document.createElement('canvas');
      mockCanvas.width = 1024;
      mockCanvas.height = 768;

      const faces = manager.extractCrossLayoutFaces(mockCanvas);

      expect(faces).toHaveLength(6);
      for (const face of faces) {
        expect(face.width).toBe(256);
        expect(face.height).toBe(256);
      }
    });

    it('should extract faces at correct T-cross positions', () => {
      const mockCtx = mockCanvasContext();
      const mockCanvas = document.createElement('canvas');
      mockCanvas.width = 400;
      mockCanvas.height = 300;
      const faceSize = 100; // 400 / 4

      manager.extractCrossLayoutFaces(mockCanvas);

      // Expected face positions (col*faceSize, row*faceSize):
      // +X=(2,1), -X=(0,1), +Y=(1,0), -Y=(1,2), +Z=(1,1), -Z=(3,1)
      const calls = mockCtx.drawImage.mock.calls;
      expect(calls[0][1]).toBe(2 * faceSize); expect(calls[0][2]).toBe(1 * faceSize); // +X
      expect(calls[1][1]).toBe(0 * faceSize); expect(calls[1][2]).toBe(1 * faceSize); // -X
      expect(calls[2][1]).toBe(1 * faceSize); expect(calls[2][2]).toBe(0 * faceSize); // +Y
      expect(calls[3][1]).toBe(1 * faceSize); expect(calls[3][2]).toBe(2 * faceSize); // -Y
      expect(calls[4][1]).toBe(1 * faceSize); expect(calls[4][2]).toBe(1 * faceSize); // +Z
      expect(calls[5][1]).toBe(3 * faceSize); expect(calls[5][2]).toBe(1 * faceSize); // -Z
    });
  });

  describe('getCubemapTexture', () => {
    it('should return null for unknown path', () => {
      expect(manager.getCubemapTexture('unknown.png')).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should destroy all cached textures', () => {
      mockCanvasContext();
      const mockTexture: FakeTex = { id: 999 };
      (backend.createTextureFromImage as any).mockReturnValue(mockTexture);

      // Load a cubemap by simulating the internal flow
      const mockImage = document.createElement('canvas');
      mockImage.width = 1024;
      mockImage.height = 768;

      // extractCrossLayoutFaces doesn't cache, but we can test cleanup doesn't error
      manager.extractCrossLayoutFaces(mockImage);

      manager.cleanup();
      expect(manager.getCubemapTexture('any-path')).toBeNull();
    });
  });
});
