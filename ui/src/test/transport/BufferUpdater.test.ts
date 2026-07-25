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
    (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
      passes: {
        Image: { inputs: {} },
      },
    });
      
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

  it('passes a cloned Slang workspace to an incremental buffer recompile', async () => {
    (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({ success: true });
    const workspace = {
      rootUri: 'file:///project',
      files: [{ uri: 'file:///project/image.slang', path: '/workspace/image.slang', source: 'original' }],
    };

    bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, 'direct code', undefined, workspace);
    workspace.files[0].source = 'changed';

    await vi.waitFor(() => {
      expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
        'BufferA', 'direct code', expect.objectContaining({ rootUri: 'file:///project' }),
      );
    });
    const passed = (mockRenderEngine.updateBufferAndRecompile as any).mock.calls[0][2];
    expect(passed).not.toBe(workspace);
    expect(passed.files[0].source).toBe('original');
  });

  it('should handle compilation errors', async () => {
    (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
      success: false,
      errors: ['Compilation failed']
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

  it('should post no message at all for a superseded compile result', async () => {
    // A superseded result means a newer buffer update raced past this one;
    // surfacing it as an error banner would stick over a shader that is
    // rendering fine. The newer update's own completion path owns the
    // messaging and the render loop restart.
    (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
      success: false,
      errors: ['Superseded by a newer compile'],
      superseded: true,
    });

    bufferUpdater.updateBuffer('/buffers/BufferA.glsl', {}, '');

    await vi.waitFor(() => {
      expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalled();
    });

    expect(mockTransport.postMessage).not.toHaveBeenCalled();
    // startRenderLoop stays success-only; the newer update restarts it.
    expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
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
});
