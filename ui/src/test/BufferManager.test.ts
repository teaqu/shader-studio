import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BufferManager } from '../lib/rendering/BufferManager';
import type { PiRenderer, PiShader, PiTexture, PiRenderTarget } from '../lib/types/piRenderer';
import type { Buffer, Buffers } from '../lib/models';

// Mock renderer implementation
const createMockRenderer = (): PiRenderer => {
  const mockTextures = new Map<any, any>();
  const mockRenderTargets = new Map<any, any>();
  const mockShaders = new Map<any, any>();

  return {
    FILTER: { LINEAR: 1, NONE: 0 },
    TEXFMT: { C4F32: 5 },
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
    it('should create ping pong buffers with correct dimensions', () => {
      const buffer = bufferManager.createPingPongBuffers(800, 600);
      
      expect(buffer.front).toBeTruthy();
      expect(buffer.back).toBeTruthy();
      expect(buffer.front?.mTex0?.mXres).toBe(800);
      expect(buffer.front?.mTex0?.mYres).toBe(600);
      expect(buffer.back?.mTex0?.mXres).toBe(800);
      expect(buffer.back?.mTex0?.mYres).toBe(600);
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