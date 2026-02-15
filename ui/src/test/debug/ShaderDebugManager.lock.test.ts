import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';
import { MessageHandler } from '../../lib/transport/MessageHandler';
import { ShaderLocker } from '../../lib/ShaderLocker';
import type { CursorPositionMessage } from '@shader-studio/types';

// Mock the required dependencies
const mockRenderEngine = {
  stopRenderLoop: vi.fn(),
  startRenderLoop: vi.fn(),
  compileShaderPipeline: vi.fn(() => ({ success: true })),
  cleanup: vi.fn(),
} as any;

const mockTransport = {
  send: vi.fn(),
} as any;

describe('ShaderDebugManager - Lock Integration', () => {
  let manager: ShaderDebugManager;
  let shaderLocker: ShaderLocker;
  let messageHandler: MessageHandler;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled(); // Enable debug mode

    shaderLocker = new ShaderLocker();

    messageHandler = new MessageHandler(
      mockTransport,
      mockRenderEngine,
      shaderLocker,
      manager
    );
  });

  it('should update debug line when no lock is active', () => {
    const message: CursorPositionMessage = {
      type: 'cursorPosition',
      payload: {
        line: 5,
        character: 10,
        lineContent: '  vec2 uv = fragCoord / iResolution.xy;',
        filePath: '/path/to/shader.glsl',
      },
    };

    messageHandler.handleCursorPositionMessage(message);

    const state = manager.getState();
    expect(state.currentLine).toBe(5);
    expect(state.lineContent).toBe('  vec2 uv = fragCoord / iResolution.xy;');
    expect(state.filePath).toBe('/path/to/shader.glsl');
  });

  it('should update debug line when locked shader matches cursor file', () => {
    shaderLocker.toggleLock('/path/to/shader.glsl');

    const message: CursorPositionMessage = {
      type: 'cursorPosition',
      payload: {
        line: 5,
        character: 10,
        lineContent: '  vec2 uv = fragCoord / iResolution.xy;',
        filePath: '/path/to/shader.glsl',
      },
    };

    messageHandler.handleCursorPositionMessage(message);

    const state = manager.getState();
    expect(state.currentLine).toBe(5);
    expect(state.lineContent).toBe('  vec2 uv = fragCoord / iResolution.xy;');
  });

  it('should NOT update debug line when locked shader differs from cursor file', () => {
    shaderLocker.toggleLock('/path/to/shader.glsl');

    manager.updateDebugLine(5, 'vec2 uv = ...', '/path/to/shader.glsl');

    const message: CursorPositionMessage = {
      type: 'cursorPosition',
      payload: {
        line: 10,
        character: 5,
        lineContent: '  float x = 1.0;',
        filePath: '/path/to/different-buffer.glsl',
      },
    };

    messageHandler.handleCursorPositionMessage(message);

    const state = manager.getState();
    expect(state.currentLine).toBe(5);
    expect(state.lineContent).toBe('vec2 uv = ...');
    expect(state.filePath).toBe('/path/to/shader.glsl');
  });

  it('should resume updating debug line after unlock', () => {
    shaderLocker.toggleLock('/path/to/shader.glsl');

    const message1: CursorPositionMessage = {
      type: 'cursorPosition',
      payload: {
        line: 10,
        character: 5,
        lineContent: '  float x = 1.0;',
        filePath: '/path/to/buffer.glsl',
      },
    };

    messageHandler.handleCursorPositionMessage(message1);
    let state = manager.getState();
    expect(state.currentLine).toBeNull();

    shaderLocker.toggleLock();

    messageHandler.handleCursorPositionMessage(message1);
    state = manager.getState();
    expect(state.currentLine).toBe(10);
    expect(state.lineContent).toBe('  float x = 1.0;');
    expect(state.filePath).toBe('/path/to/buffer.glsl');
  });
});
