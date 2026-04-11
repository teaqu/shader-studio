import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShaderPipeline as MessageHandler } from '../../lib/ShaderPipeline';
import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
import type { Transport } from '../../lib/transport/MessageTransport';
import type { ShaderLocker } from '../../lib/ShaderLocker';
import type { ShaderSourceMessage, CursorPositionMessage } from '@shader-studio/types';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';
import { ShaderProcessor } from '../../lib/ShaderProcessor';

vi.mock('../../lib/ShaderProcessor', () => ({
  ShaderProcessor: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockRenderingEngine = (): RenderingEngine =>
  ({
    compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
    cleanup: vi.fn(),
    getTimeManager: vi.fn().mockReturnValue({ cleanup: vi.fn() }),
    startRenderLoop: vi.fn(),
    stopRenderLoop: vi.fn(),
    updateBufferAndRecompile: vi.fn().mockResolvedValue({ success: true }),
    getPasses: vi.fn().mockReturnValue([
      { name: 'Image' },
      { name: 'BufferA' },
      { name: 'BufferB' },
      { name: 'common' },
    ]),
    getCurrentConfig: vi.fn().mockReturnValue({
      version: '1',
      passes: {
        Image: { inputs: {} },
        BufferA: { path: 'bufferA.glsl', inputs: {} },
        BufferB: { path: 'bufferB.glsl', inputs: {} },
        common: { path: 'common.glsl', inputs: {} },
      },
    }),
  } as any);

const createMockTransport = (): Transport =>
  ({
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    dispose: vi.fn(),
  } as any);

const createMockShaderLocker = () => ({
  isLocked: vi.fn().mockReturnValue(false),
  getLockedShaderPath: vi.fn().mockReturnValue(undefined),
});

function makeShaderMessage(overrides: Partial<ShaderSourceMessage> = {}): MessageEvent {
  return {
    data: {
      type: 'shaderSource',
      path: '/shaders/image.glsl',
      code: 'void mainImage(out vec4 f, in vec2 c) { f = vec4(1.0); }',
      config: {
        version: '1',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
          BufferB: { path: 'bufferB.glsl', inputs: {} },
          common: { path: 'common.glsl', inputs: {} },
        },
      },
      buffers: {
        BufferA: 'void mainImage(out vec4 f, in vec2 c) { f = vec4(0.5); }',
        BufferB: 'void mainImage(out vec4 f, in vec2 c) { f = vec4(0.2); }',
        common: 'float sdf(vec2 p, float r) { return length(p) - r; }',
      },
      ...overrides,
    } as ShaderSourceMessage,
  } as MessageEvent;
}

function makeCursorMessage(filePath: string, line = 5, lineContent = 'float d = 1.0;'): CursorPositionMessage {
  return {
    type: 'cursorPosition',
    payload: { filePath, line, character: 0, lineContent },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessageHandler — buffer cursor handling', () => {
  let handler: MessageHandler;
  let mockRenderingEngine: RenderingEngine;
  let mockTransport: Transport;
  let mockShaderLocker: ReturnType<typeof createMockShaderLocker>;
  let shaderDebugManager: ShaderDebugManager;
  let shaderProcessor: any;

  beforeEach(() => {
    mockRenderingEngine = createMockRenderingEngine();
    mockTransport = createMockTransport();
    mockShaderLocker = createMockShaderLocker();
    shaderDebugManager = new ShaderDebugManager();

    shaderProcessor = {
      processMainShaderCompilation: vi.fn().mockResolvedValue({ success: true }),
      isCurrentlyProcessing: vi.fn().mockReturnValue(false),
      getImageShaderCode: vi.fn().mockReturnValue('void mainImage() {}'),
      debugCompile: vi.fn().mockResolvedValue({ success: true }),
    };

    (ShaderProcessor as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => shaderProcessor,
    );

    handler = new MessageHandler(
      mockTransport,
      mockRenderingEngine,
      mockShaderLocker as unknown as ShaderLocker,
      shaderDebugManager,
    );

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // -------------------------------------------------------------------------
  describe('shader message delegation', () => {
    it('forwards shaderSource messages to the runtime session', async () => {
      const message = makeShaderMessage();

      await handler.handleShaderMessage(message);

      expect(shaderProcessor.processMainShaderCompilation).toHaveBeenCalledWith(
        message.data,
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('cursor position accepted from buffer files when locked', () => {
    beforeEach(async () => {
      // First load the shader so lastEvent is set and context is known
      await handler.handleShaderMessage(makeShaderMessage());
      // Now lock to the Image shader
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('/shaders/image.glsl');
    });

    it('accepts cursor from the locked Image file', () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      handler.handleCursorPositionMessage(makeCursorMessage('/shaders/image.glsl'));
      expect(spy).toHaveBeenCalledWith(5, 'float d = 1.0;', '/shaders/image.glsl');
    });

    it('accepts cursor from BufferA (belongs to current shader)', () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      handler.handleCursorPositionMessage(makeCursorMessage('bufferA.glsl'));
      expect(spy).toHaveBeenCalledWith(5, 'float d = 1.0;', 'bufferA.glsl');
    });

    it('accepts cursor from BufferB (belongs to current shader)', () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      handler.handleCursorPositionMessage(makeCursorMessage('bufferB.glsl'));
      expect(spy).toHaveBeenCalledWith(5, 'float d = 1.0;', 'bufferB.glsl');
    });

    it('accepts cursor from common.glsl (belongs to current shader)', () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      handler.handleCursorPositionMessage(makeCursorMessage('common.glsl'));
      expect(spy).toHaveBeenCalledWith(5, 'float d = 1.0;', 'common.glsl');
    });

    it('accepts cursor from an absolute common file path even when common is not a runtime pass', () => {
      (mockRenderingEngine.getPasses as any).mockReturnValue([
        { name: 'Image' },
        { name: 'BufferA' },
        { name: 'BufferB' },
      ]);
      (mockRenderingEngine.getCurrentConfig as any).mockReturnValue({
        version: '1',
        passes: {
          Image: { inputs: {} },
          BufferA: { path: 'bufferA.glsl', inputs: {} },
          BufferB: { path: 'bufferB.glsl', inputs: {} },
          common: { path: '001_square.common.glsl', inputs: {} },
        },
      });

      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      handler.handleCursorPositionMessage(
        makeCursorMessage('/mock/project/shaders/001_square.common.glsl', 3, 'vec3 green = vec3(0.0, 1.0, 0.0);'),
      );
      expect(spy).toHaveBeenCalledWith(
        3,
        'vec3 green = vec3(0.0, 1.0, 0.0);',
        '/mock/project/shaders/001_square.common.glsl',
      );
    });

    it('rejects cursor from an unrelated file', () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      handler.handleCursorPositionMessage(makeCursorMessage('/mock/other-project/unrelated.glsl'));
      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects cursor from a file that looks similar but is not in the config', () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      handler.handleCursorPositionMessage(makeCursorMessage('/shaders/bufferC.glsl'));
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('cursor position accepted from buffer files when not locked', () => {
    it('accepts cursor from any file when not locked', () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      mockShaderLocker.isLocked.mockReturnValue(false);
      handler.handleCursorPositionMessage(makeCursorMessage('bufferA.glsl'));
      expect(spy).toHaveBeenCalledWith(5, 'float d = 1.0;', 'bufferA.glsl');
    });
  });

  // -------------------------------------------------------------------------
  describe('inline cursor update in handleShaderMessage', () => {
    it('updates debug line from buffer file path in shader message cursorPosition when not locked', async () => {
      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      await handler.handleShaderMessage(makeShaderMessage({
        cursorPosition: { line: 3, lineContent: 'fragColor = vec4(d);', filePath: 'bufferA.glsl' },
      } as any));
      expect(spy).toHaveBeenCalledWith(3, 'fragColor = vec4(d);', 'bufferA.glsl');
    });

    it('updates debug line from buffer file when locked to Image and buffer belongs to shader', async () => {
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('/shaders/image.glsl');

      // Load shader first so context is known
      await handler.handleShaderMessage(makeShaderMessage());

      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      await handler.handleShaderMessage(makeShaderMessage({
        path: '/shaders/image.glsl', // matches locked path so it processes
        cursorPosition: { line: 2, lineContent: 'float d = 0.5;', filePath: 'bufferA.glsl' },
      } as any));
      expect(spy).toHaveBeenCalledWith(2, 'float d = 0.5;', 'bufferA.glsl');
    });

    it('does not update debug line from unrelated file in shader message when locked', async () => {
      await handler.handleShaderMessage(makeShaderMessage());
      mockShaderLocker.isLocked.mockReturnValue(true);
      mockShaderLocker.getLockedShaderPath.mockReturnValue('/shaders/image.glsl');

      const spy = vi.spyOn(shaderDebugManager, 'updateDebugLine');
      await handler.handleShaderMessage(makeShaderMessage({
        path: '/shaders/image.glsl',
        cursorPosition: { line: 0, lineContent: 'line', filePath: '/other/unrelated.glsl' },
      } as any));
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('debug recompile triggered for buffer cursor', () => {
    beforeEach(async () => {
      shaderDebugManager.toggleEnabled();
      await handler.handleShaderMessage(makeShaderMessage());
    });

    it('triggers debug recompile when cursor moves to a buffer line and debug is active', () => {
      // Make debug active
      shaderDebugManager.updateDebugLine(1, 'float d = 0.5;', 'bufferA.glsl');

      shaderProcessor.getImageShaderCode.mockReturnValue('void mainImage() {}');
      handler.handleCursorPositionMessage(makeCursorMessage('bufferA.glsl', 2, 'fragColor = vec4(d);'));

      expect(shaderProcessor.debugCompile).toHaveBeenCalled();
    });
  });
});
