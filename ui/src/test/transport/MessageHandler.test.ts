import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageHandler } from '../../lib/transport/MessageHandler';
import type { ShaderPipeline } from '../../lib/rendering/ShaderPipeline';
import type { TimeManager } from '../../lib/util/TimeManager';
import type { FrameRenderer } from '../../lib/rendering/FrameRenderer';
import type { Transport } from '../../lib/transport/MessageTransport';
import type { ShaderSourceMessage } from '@shader-view/types';

const createMockShaderPipeline = () => ({
  compileShaderPipeline: vi.fn(),
  cleanup: vi.fn(),
  getPass: vi.fn(),
  getPasses: vi.fn(),
});

const createMockTimeManager = () => ({
  cleanup: vi.fn(),
  reset: vi.fn(),
  getTime: vi.fn(),
  getDeltaTime: vi.fn(),
});

const createMockFrameRenderer = () => ({
  isRunning: vi.fn(),
  startRenderLoop: vi.fn(),
  stopRenderLoop: vi.fn(),
  render: vi.fn(),
});

const createMockTransport = () => ({
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: vi.fn().mockReturnValue('websocket'),
  isConnected: vi.fn().mockReturnValue(true),
});

describe('MessageHandler', () => {
  let messageHandler: MessageHandler;
  let mockShaderPipeline: ReturnType<typeof createMockShaderPipeline>;
  let mockTimeManager: ReturnType<typeof createMockTimeManager>;
  let mockFrameRenderer: ReturnType<typeof createMockFrameRenderer>;
  let mockTransport: ReturnType<typeof createMockTransport>;

  beforeEach(() => {
    mockShaderPipeline = createMockShaderPipeline();
    mockTimeManager = createMockTimeManager();
    mockFrameRenderer = createMockFrameRenderer();
    mockTransport = createMockTransport();

    messageHandler = new MessageHandler(
      mockShaderPipeline as unknown as ShaderPipeline,
      mockTimeManager as unknown as TimeManager,
      mockFrameRenderer as unknown as FrameRenderer,
      mockTransport as unknown as Transport,
    );

    // Suppress console logs during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('when handling shader messages with different shaders', () => {
    it('should cleanup when shader path changes', async () => {
      // First shader
      const firstShaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader1.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      // Mock successful compilation for first shader
      mockShaderPipeline.compileShaderPipeline.mockResolvedValue({
        success: true,
      });
      mockFrameRenderer.isRunning.mockReturnValue(false);

      // Process first shader
      await messageHandler.handleShaderMessage(firstShaderEvent);

      // Verify first shader was processed without cleanup
      expect(mockShaderPipeline.cleanup).not.toHaveBeenCalled();
      expect(mockTimeManager.cleanup).not.toHaveBeenCalled();

      // Reset mocks
      mockShaderPipeline.cleanup.mockClear();
      mockTimeManager.cleanup.mockClear();

      // Second shader with different path
      const secondShaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader2.glsl', // Different path
          code: 'void mainImage() { gl_FragColor = vec4(0.5); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      // Process second shader
      await messageHandler.handleShaderMessage(secondShaderEvent);

      // Verify cleanup was called when shader path changed
      expect(mockShaderPipeline.cleanup).toHaveBeenCalledTimes(1);
      expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
    });

    it('should cleanup when shader code changes', async () => {
      // First shader
      const firstShaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      // Mock successful compilation
      mockShaderPipeline.compileShaderPipeline.mockResolvedValue({
        success: true,
      });
      mockFrameRenderer.isRunning.mockReturnValue(false);

      // Process first shader
      await messageHandler.handleShaderMessage(firstShaderEvent);

      // Reset mocks
      mockShaderPipeline.cleanup.mockClear();
      mockTimeManager.cleanup.mockClear();

      // Same shader path but different code
      const modifiedShaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl', // Same path
          code: 'void mainImage() { gl_FragColor = vec4(0.5); }', // Different code
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      // Process modified shader
      await messageHandler.handleShaderMessage(modifiedShaderEvent);

      // Verify cleanup was called when shader code changed
      expect(mockShaderPipeline.cleanup).toHaveBeenCalledTimes(1);
      expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
    });

    it('should not cleanup when same shader is processed again', async () => {
      // First shader
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      // Mock successful compilation
      mockShaderPipeline.compileShaderPipeline.mockResolvedValue({
        success: true,
      });
      mockFrameRenderer.isRunning.mockReturnValue(false);

      // Process shader first time
      await messageHandler.handleShaderMessage(shaderEvent);

      // Reset mocks
      mockShaderPipeline.cleanup.mockClear();
      mockTimeManager.cleanup.mockClear();

      // Process the exact same shader again
      await messageHandler.handleShaderMessage(shaderEvent);

      // Verify cleanup was NOT called for identical shader
      expect(mockShaderPipeline.cleanup).not.toHaveBeenCalled();
      expect(mockTimeManager.cleanup).not.toHaveBeenCalled();
    });

    it('should not cleanup on first shader load', async () => {
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      // Mock successful compilation
      mockShaderPipeline.compileShaderPipeline.mockResolvedValue({
        success: true,
      });
      mockFrameRenderer.isRunning.mockReturnValue(false);

      // Process first shader
      await messageHandler.handleShaderMessage(shaderEvent);

      // Verify no cleanup on first load (no previous shader to clean up)
      expect(mockShaderPipeline.cleanup).not.toHaveBeenCalled();
      expect(mockTimeManager.cleanup).not.toHaveBeenCalled();
    });
  });

  describe('when reset is called', () => {
    it('should call cleanup', () => {
      messageHandler.reset();

      expect(mockShaderPipeline.cleanup).toHaveBeenCalledTimes(1);
      expect(mockTimeManager.cleanup).toHaveBeenCalledTimes(1);
    });

    it('should call onReset callback when lastEvent exists', async () => {
      // First set up a shader event
      const shaderEvent = {
        data: {
          type: 'shaderSource',
          path: 'shader.glsl',
          code: 'void mainImage() { gl_FragColor = vec4(1.0); }',
          config: null,
          buffers: {},
        } as ShaderSourceMessage,
      } as MessageEvent;

      mockShaderPipeline.compileShaderPipeline.mockResolvedValue({
        success: true,
      });
      mockFrameRenderer.isRunning.mockReturnValue(false);

      await messageHandler.handleShaderMessage(shaderEvent);

      // Now test reset with callback
      const onResetCallback = vi.fn();
      messageHandler.reset(onResetCallback);

      expect(mockShaderPipeline.cleanup).toHaveBeenCalled();
      expect(mockTimeManager.cleanup).toHaveBeenCalled();
      expect(onResetCallback).toHaveBeenCalledTimes(1);
    });

    it('should send error message when no lastEvent exists', () => {
      messageHandler.reset();

      expect(mockTransport.postMessage).toHaveBeenCalledWith({
        type: 'error',
        payload: ['❌ No shader to reset'],
      });
    });
  });
});
