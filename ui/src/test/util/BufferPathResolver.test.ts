import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferPathResolver } from '../../lib/util/BufferPathResolver';
import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';

describe('BufferPathResolver', () => {
  let resolver: BufferPathResolver;
  let mockRenderEngine: RenderingEngine;

  beforeEach(() => {
    mockRenderEngine = {
      getPasses: vi.fn().mockReturnValue([
        { name: 'BufferA' },
        { name: 'BufferB' },
        { name: 'Image' },
      ]),
      getCurrentConfig: vi.fn().mockReturnValue({
        passes: {
          Image: { inputs: {} },
          BufferA: { path: '/buffers/BufferA.glsl' },
          BufferB: { path: '/buffers/BufferB.glsl' },
        },
      }),
    } as any;

    resolver = new BufferPathResolver(mockRenderEngine);
  });

  describe('bufferFileExistsInCurrentShader', () => {
    it('returns true for a configured buffer path', () => {
      expect(resolver.bufferFileExistsInCurrentShader('/buffers/BufferA.glsl')).toBe(true);
    });

    it('returns false for an unrelated file path', () => {
      expect(resolver.bufferFileExistsInCurrentShader('/buffers/Other.glsl')).toBe(false);
    });

    it('returns false for Image even if the path matches', () => {
      (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
        passes: {
          Image: { path: '/image.glsl' },
        },
      });

      expect(resolver.bufferFileExistsInCurrentShader('/image.glsl')).toBe(false);
    });
  });

  describe('getBufferNameForFilePath', () => {
    it('returns the configured buffer pass name for a matching path', () => {
      expect(resolver.getBufferNameForFilePath('/buffers/BufferB.glsl')).toBe('BufferB');
    });

    it('supports Windows-style paths', () => {
      (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
        passes: {
          BufferA: { path: 'C:\\shaders\\BufferA.glsl' },
        },
      });

      expect(resolver.getBufferNameForFilePath('C:\\shaders\\BufferA.glsl')).toBe('BufferA');
    });

    it('supports paths with multiple dots', () => {
      (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
        passes: {
          BufferA: { path: '/buffers/BufferA.test.glsl' },
        },
      });

      expect(resolver.getBufferNameForFilePath('/buffers/BufferA.test.glsl')).toBe('BufferA');
    });

    it('returns null when no configured buffer matches the path', () => {
      expect(resolver.getBufferNameForFilePath('/buffers/Missing.glsl')).toBeNull();
    });
  });
});
