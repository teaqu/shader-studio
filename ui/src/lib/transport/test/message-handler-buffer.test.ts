import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageHandler } from '../MessageHandler';
import type { RenderingEngine } from '../../../../../rendering/src/types/RenderingEngine';
import type { ShaderLocker } from '../../ShaderLocker';
import type { Transport } from '../MessageTransport';
import type { ShaderSourceMessage } from '@shader-studio/types';

// Mock dependencies
const mockRenderEngine: Partial<RenderingEngine> = {
  stopRenderLoop: vi.fn(),
  startRenderLoop: vi.fn(),
  updateBufferAndRecompile: vi.fn(),
  getPasses: vi.fn(() => [
    { name: 'Image', shaderSrc: 'main shader code' },
    { name: 'BufferA', shaderSrc: 'buffer A code' }
  ]),
  getCurrentConfig: vi.fn(() => ({
    version: '1.0',
    passes: {
      Image: { inputs: {} },
      BufferA: { 
        inputs: {},
        path: 'gol-buffer.glsl' // BufferA uses gol-buffer.glsl file
      }
    }
  }))
};

const mockShaderLocker: Partial<ShaderLocker> = {
  isLocked: vi.fn(() => true),
  getLockedShaderPath: vi.fn(() => 'c:\\path\\to\\main.glsl')
};

const mockTransport: Partial<Transport> = {
  postMessage: vi.fn()
};

describe('MessageHandler Buffer Update Tests', () => {
  let messageHandler: MessageHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock RenderingEngine with buffer config
    (mockRenderEngine.getCurrentConfig as any).mockReturnValue({
      passes: {
        BufferA: { path: 'gol-buffer.glsl' }
      }
    });
    
    (mockRenderEngine.getPasses as any).mockReturnValue([
      { name: 'BufferA' },
      { name: 'Image' }
    ]);

    messageHandler = new MessageHandler(
      mockTransport as Transport,
      mockRenderEngine as RenderingEngine,
      mockShaderLocker as ShaderLocker
    );
  });

  it('should handle buffer file update when shader is locked and buffer matches', async () => {
    // Mock successful buffer update
    (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
      success: true
    });

    // Create message for buffer file update - use the file path from config
    const event: MessageEvent = {
      data: {
        type: 'shaderSource',
        path: 'c:\\path\\to\\gol-buffer.glsl', // Use the file path from config
        code: 'updated buffer A code',
        config: null,
        buffers: {}
      } as ShaderSourceMessage
    } as MessageEvent;

    const result = await messageHandler.handleShaderMessage(event);

    // Verify buffer update was called with resolved buffer name
    expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
      'BufferA', // Resolved from file path
      'updated buffer A code'
    );

    // Verify error was cleared first, then success message was sent
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: [] // Clear previous errors
    });
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'log',
      payload: ['Buffer \'gol-buffer\' updated and pipeline recompiled']
    });

    expect(result).toEqual({ running: true });
  });

  it('should ignore buffer file update when buffer does not match', async () => {
    // Create message for non-matching buffer file
    const event: MessageEvent = {
      data: {
        type: 'shaderSource',
        path: 'c:\\path\\to\\NonExistentBuffer.glsl',
        code: 'some code',
        config: null,
        buffers: {}
      } as ShaderSourceMessage
    } as MessageEvent;

    const result = await messageHandler.handleShaderMessage(event);

    // Verify buffer update was NOT called
    expect(mockRenderEngine.updateBufferAndRecompile).not.toHaveBeenCalled();

    expect(result).toEqual({ running: true });
  });

  it('should resolve buffer name from file path and update correct buffer', async () => {
    // Mock successful buffer update
    (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
      success: true
    });

    // Create message for buffer file update - file name doesn't match buffer name
    const event: MessageEvent = {
      data: {
        type: 'shaderSource',
        path: 'c:\\path\\to\\gol-buffer.glsl', // File is gol-buffer.glsl
        code: 'updated buffer content',
        config: null,
        buffers: {}
      } as ShaderSourceMessage
    } as MessageEvent;

    const result = await messageHandler.handleShaderMessage(event);

    // Verify buffer update was called with the correct buffer name (BufferA, not gol-buffer)
    expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalledWith(
      'BufferA', // Should resolve to actual buffer name
      'updated buffer content'
    );

    // Verify error was cleared first, then success message was sent
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: [] // Clear previous errors
    });
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'log',
      payload: ['Buffer \'gol-buffer\' updated and pipeline recompiled']
    });

    expect(result).toEqual({ running: true });
  });

  it('should handle buffer update compilation failure', async () => {
    // Mock failed buffer update
    (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
      success: false,
      error: 'Compilation failed'
    });

    const event: MessageEvent = {
      data: {
        type: 'shaderSource',
        path: 'c:\\path\\to\\gol-buffer.glsl', // Use matching file path
        code: 'broken code',
        config: null,
        buffers: {}
      } as ShaderSourceMessage
    } as MessageEvent;

    const result = await messageHandler.handleShaderMessage(event);

    // Verify error message was sent
    expect(mockTransport.postMessage).toHaveBeenCalledWith({
      type: 'error',
      payload: ['Compilation failed']
    });

    expect(result).toEqual({ running: true });
  });
});
