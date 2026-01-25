import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BufferUpdater } from '../../lib/util/BufferUpdater';
import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
import type { Transport } from '../../lib/transport/MessageTransport';

describe('BufferUpdater', () => {
  let bufferUpdater: BufferUpdater;
  let mockRenderEngine: RenderingEngine;
  let mockTransport: Transport;

  beforeEach(() => {
    // Mock transport
    mockTransport = {
      postMessage: vi.fn(),
    } as any;

    // Mock rendering engine with properly typed mock methods
    mockRenderEngine = {
      stopRenderLoop: vi.fn(),
      startRenderLoop: vi.fn(),
      updateBufferAndRecompile: vi.fn(),
      getPasses: vi.fn().mockReturnValue([
        { name: 'BufferA', path: '/buffers/BufferA.glsl' },
        { name: 'BufferB', path: '/buffers/BufferB.glsl' },
        { name: 'gol-buffer', path: '/buffers/BufferA.glsl' }
      ]),
      getCurrentConfig: vi.fn().mockReturnValue({
        passes: {
          BufferA: { path: '/buffers/BufferA.glsl' },
          BufferB: { path: '/buffers/BufferB.glsl' },
          'gol-buffer': { path: '/buffers/BufferA.glsl' }
        }
      }),
      cleanup: vi.fn(),
    } as any;

    bufferUpdater = new BufferUpdater(mockRenderEngine, mockTransport);
  });

  describe('updateBuffer', () => {
    beforeEach(() => {
      (mockRenderEngine.getPasses as any).mockReturnValue([
        { name: 'BufferA' },
      ]);
      
      (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
        passes: {
          BufferA: { path: '/buffers/BufferA.glsl' },
        },
      });
    });

    it('should return early when buffer name cannot be extracted', async () => {
      await bufferUpdater.updateBuffer('', {}, '');
      // Should not throw and should return early
    });

    it('should return early when buffer file does not exist in current shader', async () => {
      await bufferUpdater.updateBuffer('/nonexistent/BufferC.glsl', {}, '');
      // Should not throw and should return early
    });
    });

    it('should return early when actual buffer name cannot be found', async () => {
      (mockRenderEngine.getPasses as any).mockReturnValue([]);
      
      await bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, '');
      // Should not throw and should return early
    });

    it('should successfully update buffer and send success messages', async () => {
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({ success: true });

      bufferUpdater.updateBuffer('/buffers/BufferA.glsl', { BufferA: 'new code' }, '');
      
      // Wait for the async operations to complete
      await vi.waitFor(() => {
        expect(mockRenderEngine.stopRenderLoop).toHaveBeenCalled();
        expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalledWith('BufferA', 'new code');
        expect(mockRenderEngine.startRenderLoop).toHaveBeenCalled();
      });
      
      // Should send success message to clear previous errors
      expect(mockTransport.postMessage).toHaveBeenCalledWith({ 
        type: 'log', 
        payload: ['Buffer \'BufferA\' updated and pipeline recompiled'] 
      });
    });

    it('should use code when buffers object is empty', async () => {
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({ success: true });

      bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, 'direct code');
      
      await vi.waitFor(() => {
        expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalledWith('BufferA', 'direct code');
      });
    });

    it('should handle compilation errors', async () => {
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({ 
        success: false, 
        error: 'Compilation failed' 
      });

      bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, '');
      
      await vi.waitFor(() => {
        expect(mockRenderEngine.stopRenderLoop).toHaveBeenCalled();
      });
      
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
      
      expect(mockTransport.postMessage).toHaveBeenCalledWith({ 
        type: 'error', 
        payload: ['Compilation failed'] 
      });
    });

    it('should handle unknown compilation errors', async () => {
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({ success: false });

      bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, '');
      
      await vi.waitFor(() => {
        expect(mockTransport.postMessage).toHaveBeenCalledWith({ 
          type: 'error', 
          payload: ['Unknown compilation error'] 
        });
      });
    });

    it('should handle exceptions during buffer update', async () => {
      const error = new Error('Test error');
      (mockRenderEngine.updateBufferAndRecompile as any).mockRejectedValue(error);

      bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, '');
      
      await vi.waitFor(() => {
        expect(mockTransport.postMessage).toHaveBeenCalledWith({ 
          type: 'error', 
          payload: ['Buffer update error: Error: Test error'] 
        });
      });
    });

    it('should handle transport errors during error reporting', async () => {
      const error = new Error('Test error');
      (mockRenderEngine.updateBufferAndRecompile as any).mockRejectedValue(error);
      (mockTransport.postMessage as any).mockImplementation(() => {
        throw new Error('Transport error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, '');
      
      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('BufferUpdater: Failed to send error message:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });

    describe('path handling edge cases', () => {
      it('should handle Windows paths correctly', async () => {
      (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
        passes: {
          BufferA: { path: 'C:\\shaders\\BufferA.glsl' },
        },
      });
      
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({ success: true });

      bufferUpdater.updateBuffer('C:\\shaders\\BufferA.glsl', { BufferA: 'code' }, '');
      
      await vi.waitFor(() => {
        expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalled();
      });
    });

      it('should handle paths with multiple dots', async () => {
      (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
        passes: {
          BufferA: { path: '/buffers/BufferA.test.glsl' },
        },
      });
      
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({ success: true });

      bufferUpdater.updateBuffer('/buffers/BufferA.test.glsl', { BufferA: 'code' }, '');
      
      await vi.waitFor(() => {
        expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalled();
      });
    });

      it('should ignore Image pass even if path matches', async () => {
        (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
          passes: {
            Image: { path: '/image.glsl' },
          },
        });

        bufferUpdater.updateBuffer('/image.glsl', {}, '');

        expect(mockRenderEngine.updateBufferAndRecompile).not.toHaveBeenCalled();
      });
    });
  });
