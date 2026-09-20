import { describe, it, expect, beforeEach, vi } from "vitest";
import { BufferManager } from "../../webgl/BufferManager";
import type { PiRenderer } from '../../types/piRenderer';

// Mock renderer implementation
const createMockRenderer = (): PiRenderer => {
  const mockTextures = new Map<any, any>();
  const mockRenderTargets = new Map<any, any>();
  const mockShaders = new Map<any, any>();

  return {
    FILTER: { LINEAR: 1, NONE: 0 },
    TEXFMT: { C4F32: 5, C4F16: 3 },
    TEXTYPE: { T2D: 0 },
    TEXWRP: { CLAMP: 0 },

    CreateTexture: vi.fn((type, width, height, format, filter, wrap, data) => {
      const texture = {
        mObjectID: {},
        mXres: width,
        mYres: height,
        mFormat: format,
        mType: type,
        mFilter: filter,
        mWrap: wrap,
        mVFlip: false
      };
      mockTextures.set(texture.mObjectID, texture);
      return texture;
    }),

    CreateRenderTarget: vi.fn((tex, depth, stencil, msaa, flipY, autoResize) => {
      const rt = {
        mTex0: tex,
        mDepth: depth,
        mStencil: stencil,
        mMSAA: msaa,
        mFlipY: flipY,
        mAutoResize: autoResize
      };
      mockRenderTargets.set(rt, rt);
      return rt;
    }),

    CreateShader: vi.fn((vs, fs) => {
      const shader = {
        mProgram: {},
        mResult: true,
        mInfo: "Shader compiled successfully",
        mHeaderLines: 0,
        mErrorType: 0
      };
      mockShaders.set(shader.mProgram, shader);
      return shader;
    }),

    DestroyTexture: vi.fn((texture) => {
      mockTextures.delete(texture.mObjectID);
    }),

    DestroyRenderTarget: vi.fn((rt) => {
      mockRenderTargets.delete(rt);
    }),

    DestroyShader: vi.fn((shader) => {
      mockShaders.delete(shader.mProgram);
    }),

    SetRenderTarget: vi.fn(),
    SetViewport: vi.fn(),
    AttachShader: vi.fn(),
    SetShaderTextureUnit: vi.fn(),
    AttachTextures: vi.fn(),
    GetAttribLocation: vi.fn(() => 0),
    DrawUnitQuad_XY: vi.fn(),
    Flush: vi.fn(),

    // Helper methods for testing
    _getMockTextures: () => mockTextures,
    _getMockRenderTargets: () => mockRenderTargets,
    _getMockShaders: () => mockShaders,
  } as any;
};

describe('BufferManager', () => {
  let bufferManager: BufferManager;
  let mockRenderer: PiRenderer;

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    bufferManager = new BufferManager(mockRenderer);
  });

  describe('Constructor', () => {
    it('should create copy shader on initialization', () => {
      expect(mockRenderer.CreateShader).toHaveBeenCalledWith(
        expect.stringContaining('in vec2 position'),
        expect.stringContaining('uniform sampler2D srcTex')
      );
    });

    it('should have valid copy shader after construction', () => {
      // Access private copyShader for testing
      const copyShader = (bufferManager as any).copyShader;
      expect(copyShader).toBeTruthy();
      expect(copyShader.mResult).toBe(true);
    });
  });

  describe('Buffer Creation', () => {
    it.each([
      [undefined, 5], ['auto', 5], ['rgba32float', 5], ['rgba16float', 3],
    ] as const)('allocates both textures for output format %s', (format, expected) => {
      const buffer = bufferManager.createPingPongBuffers(32, 24, false, format);
      expect(buffer.front?.mTex0?.mFormat).toBe(expected);
      expect(buffer.back?.mTex0?.mFormat).toBe(expected);
    });

    it.each([1, 2])('cleans up when texture %s cannot be allocated', (failedCall) => {
      const create = vi.mocked(mockRenderer.CreateTexture);
      const implementation = create.getMockImplementation()!;
      create.mockImplementationOnce((...args) => failedCall === 1 ? null : implementation(...args))
        .mockImplementationOnce((...args) => failedCall === 2 ? null : implementation(...args));
      expect(() => bufferManager.createPingPongBuffers(32, 24, false, 'rgba16float'))
        .toThrow('Failed to create ping-pong textures');
      expect(mockRenderer.DestroyTexture).toHaveBeenCalledTimes(1);
    });

    it.each([1, 2])('rejects incomplete render target %s and cleans allocated resources', (failedCall) => {
      const create = vi.mocked(mockRenderer.CreateRenderTarget);
      const implementation = create.getMockImplementation()!;
      create.mockImplementationOnce((...args) => failedCall === 1 ? null : implementation(...args))
        .mockImplementationOnce((...args) => failedCall === 2 ? null : implementation(...args));
      expect(() => bufferManager.createPingPongBuffers(32, 24, false, 'rgba16float'))
        .toThrow('Failed to create rgba16float ping-pong render targets');
      expect(mockRenderer.DestroyTexture).toHaveBeenCalledTimes(2);
      expect(mockRenderer.DestroyRenderTarget).toHaveBeenCalledTimes(1);
    });

    it('resizes mixed formats independently and copies both sides', () => {
      bufferManager.setPassBuffers({
        BufferA: bufferManager.createPingPongBuffers(32, 24, false, 'rgba16float'),
        BufferB: bufferManager.createPingPongBuffers(32, 24, false, 'rgba32float'),
      });
      bufferManager.resizeBuffers(64, 48, { BufferA: { width: 16, height: 12 } });
      const { BufferA, BufferB } = bufferManager.getPassBuffers();
      expect(BufferA?.front?.mTex0).toMatchObject({ mFormat: 3, mXres: 16, mYres: 12 });
      expect(BufferA?.back?.mTex0?.mFormat).toBe(3);
      expect(BufferB?.front?.mTex0).toMatchObject({ mFormat: 5, mXres: 64, mYres: 48 });
      expect(BufferB?.back?.mTex0?.mFormat).toBe(5);
      expect(mockRenderer.DrawUnitQuad_XY).toHaveBeenCalledTimes(4);
    });

    it('preserves half-float storage and depth when resizing', () => {
      bufferManager.setPassBuffers({
        BufferA: bufferManager.createPingPongBuffers(32, 24, true, 'rgba16float'),
      });
      bufferManager.resizeBuffers(64, 48);
      const buffer = bufferManager.getPassBuffers().BufferA!;
      expect(buffer.front?.mTex0?.mFormat).toBe(3);
      expect(buffer.back?.mTex0?.mFormat).toBe(3);
      expect(buffer.requiresDepth).toBe(true);
      expect(buffer.front?.mTex0?.mXres).toBe(64);
    });

    it('should create ping pong buffers with correct dimensions', () => {
      const buffer = bufferManager.createPingPongBuffers(800, 600);
      
      expect(buffer.front).toBeTruthy();
      expect(buffer.back).toBeTruthy();
      expect(buffer.front?.mTex0?.mXres).toBe(800);
      expect(buffer.front?.mTex0?.mYres).toBe(600);
      expect(buffer.back?.mTex0?.mXres).toBe(800);
      expect(buffer.back?.mTex0?.mYres).toBe(600);
    });

    it('creates depth-capable targets when a mesh pass requires depth', () => {
      const buffer = bufferManager.createPingPongBuffers(800, 600, true);

      expect(buffer.requiresDepth).toBe(true);
      expect(mockRenderer.CreateRenderTarget).toHaveBeenNthCalledWith(1, expect.anything(), null, null, null, null, true);
      expect(mockRenderer.CreateRenderTarget).toHaveBeenNthCalledWith(2, expect.anything(), null, null, null, null, true);
    });
  });

  describe('Buffer Resize with Data Preservation', () => {
    beforeEach(() => {
      // Create initial buffers
      const initialBuffer = bufferManager.createPingPongBuffers(400, 300);
      bufferManager.setPassBuffers({ BufferA: initialBuffer });
    });

    it('should preserve copy shader during resize', () => {
      const copyShaderBefore = (bufferManager as any).copyShader;
      expect(copyShaderBefore).toBeTruthy();

      bufferManager.resizeBuffers(800, 600);

      const copyShaderAfter = (bufferManager as any).copyShader;
      expect(copyShaderAfter).toBeTruthy();
      expect(copyShaderAfter.mResult).toBe(true);
    });

    it('should attempt to copy existing buffer data', () => {
      bufferManager.resizeBuffers(800, 600);

      // Verify copy operations were attempted
      expect(mockRenderer.SetRenderTarget).toHaveBeenCalled();
      expect(mockRenderer.AttachShader).toHaveBeenCalled();
      expect(mockRenderer.AttachTextures).toHaveBeenCalled();
      expect(mockRenderer.DrawUnitQuad_XY).toHaveBeenCalled();
    });

    it('should keep the overlap anchored to the bottom-left when growing and shrinking', () => {
      bufferManager.resizeBuffers(800, 600);
      expect(mockRenderer.SetViewport).toHaveBeenCalledWith([0, 0, 400, 300]);

      vi.mocked(mockRenderer.SetViewport).mockClear();
      bufferManager.resizeBuffers(200, 150);
      expect(mockRenderer.SetViewport).toHaveBeenCalledWith([0, 0, 200, 150]);
    });

    it('should create new buffers with correct dimensions', () => {
      bufferManager.resizeBuffers(800, 600);

      const passBuffers = bufferManager.getPassBuffers();
      expect(passBuffers.BufferA).toBeTruthy();
      expect(passBuffers.BufferA?.front?.mTex0?.mXres).toBe(800);
      expect(passBuffers.BufferA?.front?.mTex0?.mYres).toBe(600);
    });

    it('should cleanup old buffers after resize', () => {
      const mockRendererAny = mockRenderer as any;
      const initialTextures = mockRendererAny._getMockTextures().size;
      const initialRenderTargets = mockRendererAny._getMockRenderTargets().size;

      bufferManager.resizeBuffers(800, 600);

      // Should have called destroy methods for old resources
      expect(mockRenderer.DestroyTexture).toHaveBeenCalled();
      expect(mockRenderer.DestroyRenderTarget).toHaveBeenCalled();
    });
  });



  describe('Edge Cases', () => {
    it('should handle resize when no existing buffers exist', () => {
      // Start with empty buffers
      bufferManager.setPassBuffers({});

      expect(() => {
        bufferManager.resizeBuffers(800, 600);
      }).not.toThrow();
    });

    it('should skip Image pass during resize', () => {
      const imageBuffer = bufferManager.createPingPongBuffers(400, 300);
      bufferManager.setPassBuffers({ 
        Image: imageBuffer,
        BufferA: bufferManager.createPingPongBuffers(400, 300)
      });

      bufferManager.resizeBuffers(800, 600);

      const passBuffers = bufferManager.getPassBuffers();
      // Image pass should be skipped, only BufferA should be resized
      expect(passBuffers.BufferA).toBeTruthy();
      expect(passBuffers.BufferA?.front?.mTex0?.mXres).toBe(800);
    });

    it('should skip common pass during resize', () => {
      const commonBuffer = bufferManager.createPingPongBuffers(400, 300);
      bufferManager.setPassBuffers({ 
        common: commonBuffer,
        BufferA: bufferManager.createPingPongBuffers(400, 300)
      });

      bufferManager.resizeBuffers(800, 600);

      const passBuffers = bufferManager.getPassBuffers();
      // common pass should be skipped (removed), only BufferA should be resized
      expect(passBuffers.BufferA).toBeTruthy();
      expect(passBuffers.BufferA?.front?.mTex0?.mXres).toBe(800);
      expect(passBuffers.common).toBeUndefined(); // common should be removed
    });
  });

  describe('Memory Management', () => {
    it('should properly dispose buffer resources on cleanup', () => {
      const buffer = bufferManager.createPingPongBuffers(400, 300);
      bufferManager.setPassBuffers({ BufferA: buffer });

      bufferManager.dispose();

      // Should clean up buffer resources (textures and render targets)
      expect(mockRenderer.DestroyTexture).toHaveBeenCalled();
      expect(mockRenderer.DestroyRenderTarget).toHaveBeenCalled();
      
      // Copy shader is not destroyed by dispose - it's kept for reuse
      expect(bufferManager.getPassBuffers()).toEqual({});
    });
  });
});
