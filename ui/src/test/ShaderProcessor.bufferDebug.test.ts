import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderProcessor } from '../lib/ShaderProcessor';
import type { RenderingEngine } from '../../../rendering/src/types';
import type { ShaderDebugManager } from '../lib/ShaderDebugManager';
import type { ShaderSourceMessage } from '@shader-studio/types';
import type { ShaderConfig } from '@shader-studio/types';
import type { DebugTarget } from '../lib/ShaderDebugManager';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IMAGE_CODE = 'void mainImage(out vec4 f, in vec2 c) { float t = iTime; f = vec4(t); }';
const BUFFER_A_CODE = 'void mainImage(out vec4 f, in vec2 c) { float d = length(c/iResolution.xy-0.5); f = vec4(d); }';
const COMMON_CODE = 'float sdf(vec2 p, float r) { return length(p) - r; }';
const MODIFIED_CODE = 'void mainImage(out vec4 f, in vec2 c) { /* debug modified */ }';
const POST_PROCESSED_CODE = 'void mainImage(out vec4 f, in vec2 c) { /* post processed */ }';

const BUFFER_A_INPUTS = { iChannel0: { type: 'texture' as const, path: 'noise.png' } };
const IMAGE_INPUTS = { iChannel0: { type: 'texture' as const, path: 'bg.png' } };

function makeConfig(): ShaderConfig {
  return {
    version: '1',
    passes: {
      Image: { inputs: IMAGE_INPUTS },
      BufferA: { path: 'bufferA.glsl', inputs: BUFFER_A_INPUTS },
      BufferB: { path: 'bufferB.glsl', inputs: { iChannel0: { type: 'buffer', source: 'BufferA' } } },
    },
  };
}

function makeMessage(overrides: Partial<ShaderSourceMessage> = {}): ShaderSourceMessage {
  return {
    type: 'shaderSource',
    code: IMAGE_CODE,
    config: makeConfig(),
    path: '/shaders/image.glsl',
    buffers: { BufferA: BUFFER_A_CODE, BufferB: 'buffer_b_code' },
    ...overrides,
  };
}

function makeDebugState(overrides: Partial<{
  isEnabled: boolean;
  isActive: boolean;
  currentLine: number | null;
  lineContent: string | null;
  filePath: string | null;
  activeBufferName: string;
}> = {}) {
  return {
    isEnabled: false,
    isActive: false,
    currentLine: null,
    lineContent: null,
    filePath: null,
    activeBufferName: 'Image',
    ...overrides,
  };
}

function makeDebugTarget(overrides: Partial<DebugTarget> = {}): DebugTarget {
  return {
    passName: 'Image',
    code: IMAGE_CODE,
    config: makeConfig(),
    inputConfig: IMAGE_INPUTS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShaderProcessor — buffer debugging', () => {
  let processor: ShaderProcessor;
  let mockRenderEngine: RenderingEngine;
  let mockDebugManager: ShaderDebugManager;

  beforeEach(() => {
    mockDebugManager = {
      getState: vi.fn().mockReturnValue(makeDebugState()),
      getDebugTarget: vi.fn().mockImplementation((imageCode: string, config: ShaderConfig | null) =>
        makeDebugTarget({ code: imageCode, config }),
      ),
      modifyShaderForDebugging: vi.fn().mockReturnValue(null),
      applyFullShaderPostProcessing: vi.fn().mockReturnValue(null),
      setDebugError: vi.fn(),
      setImageShaderCode: vi.fn(),
    } as any;

    mockRenderEngine = {
      stopRenderLoop: vi.fn(),
      startRenderLoop: vi.fn(),
      cleanup: vi.fn(),
      compileShaderPipeline: vi.fn().mockResolvedValue({ success: true, warnings: [] }),
      updateBufferAndRecompile: vi.fn().mockResolvedValue({ success: true }),
    } as any;

    processor = new ShaderProcessor(mockRenderEngine, mockDebugManager);
  });

  // -------------------------------------------------------------------------
  describe('Image pass debugging (existing behaviour unchanged)', () => {
    it('uses Image code when activeBufferName is Image', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 5,
        lineContent: 'float t = iTime;', activeBufferName: 'Image',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'Image',
        code: IMAGE_CODE,
        config: makeConfig(),
        inputConfig: IMAGE_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      expect(mockDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(IMAGE_CODE, 5);
      const [codeArg, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(codeArg).toBe(MODIFIED_CODE);
      // Config unchanged for Image pass
      expect(configArg.passes.Image.inputs).toEqual(IMAGE_INPUTS);
    });
  });

  // -------------------------------------------------------------------------
  describe('Buffer pass debugging', () => {
    it('uses buffer code (not Image code) when activeBufferName is BufferA', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'float d = length(c/iResolution.xy-0.5);', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      expect(mockDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(BUFFER_A_CODE, 1);
    });

    it('passes modified buffer code as the Image pass code to compileShaderPipeline', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      const [codeArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(codeArg).toBe(MODIFIED_CODE);
    });

    it('replaces Image.inputs with BufferA.inputs in config passed to compileShaderPipeline', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      const [, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(configArg.passes.Image.inputs).toEqual(BUFFER_A_INPUTS);
    });

    it('does not mutate the original config object', async () => {
      const originalConfig = makeConfig();
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage({ config: originalConfig }));

      // Original config should be untouched
      expect(originalConfig.passes.Image.inputs).toEqual(IMAGE_INPUTS);
    });

    it('uses BufferB inputs when activeBufferName is BufferB', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferB',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferB',
        code: 'buffer_b_code',
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA' } } },
          },
        },
        inputConfig: { iChannel0: { type: 'buffer', source: 'BufferA' } },
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      const [, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(configArg.passes.Image.inputs).toEqual({ iChannel0: { type: 'buffer', source: 'BufferA' } });
    });

    it('falls back to original Image code when buffer code is missing', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: IMAGE_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(null); // transpiler returns null

      await processor.processMainShaderCompilation(makeMessage({ buffers: {} }));

      const [codeArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(codeArg).toBe(IMAGE_CODE);
    });

    it('falls back to Image code when transpiler returns null for buffer', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(null);

      await processor.processMainShaderCompilation(makeMessage());

      const [codeArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      // Falls back to Image code since no debug modification succeeded
      expect(codeArg).toBe(IMAGE_CODE);
    });
  });

  // -------------------------------------------------------------------------
  describe('common file debugging', () => {
    it('uses common code as source when activeBufferName is common', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'return length(p) - r;', activeBufferName: 'common',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'common',
        code: COMMON_CODE,
        config: makeConfig(),
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      expect(mockDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(COMMON_CODE, 1);
    });

    it('does not replace Image inputs for common (common has no inputs config)', async () => {
      const config = makeConfig();
      (config.passes as any).common = { path: 'common.glsl', inputs: {} };

      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'common',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'common',
        code: 'common code',
        config,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage({ config }));

      const [, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      // Image inputs should be unchanged for common
      expect(configArg.passes.Image.inputs).toEqual(IMAGE_INPUTS);
    });

    it('removes common from buffers when compiling wrapped common debug code', async () => {
      const config = makeConfig();
      (config.passes as any).common = { path: 'common.glsl', inputs: {} };

      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'return length(p) - r;', activeBufferName: 'common',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'common',
        code: COMMON_CODE,
        config,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage({
        config,
        buffers: { BufferA: BUFFER_A_CODE, common: COMMON_CODE },
      }));

      const [, , , buffersArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(buffersArg).toEqual({ BufferA: BUFFER_A_CODE });
    });
  });

  // -------------------------------------------------------------------------
  describe('post-processing applied to active buffer code', () => {
    it('applies post-processing to buffer code when buffer is active and no line selected', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: false, currentLine: null,
        lineContent: null, activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.applyFullShaderPostProcessing as any).mockReturnValue(POST_PROCESSED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      expect(mockDebugManager.applyFullShaderPostProcessing).toHaveBeenCalledWith(BUFFER_A_CODE);
      const [codeArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(codeArg).toBe(POST_PROCESSED_CODE);
    });

    it('uses buffer input config when post-processing a buffer', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: false, currentLine: null,
        lineContent: null, activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.applyFullShaderPostProcessing as any).mockReturnValue(POST_PROCESSED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      const [, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(configArg.passes.Image.inputs).toEqual(BUFFER_A_INPUTS);
    });

    it('applies post-processing to Image code when Image is active', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: false, currentLine: null,
        lineContent: null, activeBufferName: 'Image',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'Image',
        code: IMAGE_CODE,
        config: makeConfig(),
        inputConfig: IMAGE_INPUTS,
      }));
      (mockDebugManager.applyFullShaderPostProcessing as any).mockReturnValue(POST_PROCESSED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      expect(mockDebugManager.applyFullShaderPostProcessing).toHaveBeenCalledWith(IMAGE_CODE);
    });
  });

  // -------------------------------------------------------------------------
  describe('debugCompile uses active buffer code', () => {
    beforeEach(async () => {
      // Prime the processor with the last event
      await processor.processMainShaderCompilation(makeMessage());
      vi.clearAllMocks();
    });

    it('uses buffer code for debugCompile when BufferA is active', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.debugCompile(makeMessage());

      expect(mockDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(BUFFER_A_CODE, 1);
      const [codeArg, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(codeArg).toBe(MODIFIED_CODE);
      expect(configArg.passes.Image.inputs).toEqual(BUFFER_A_INPUTS);
    });

    it('uses Image code for debugCompile when Image is active', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 5,
        lineContent: 'float t = iTime;', activeBufferName: 'Image',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'Image',
        code: IMAGE_CODE,
        config: makeConfig(),
        inputConfig: IMAGE_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.debugCompile(makeMessage());

      expect(mockDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(IMAGE_CODE, 5);
    });

    it('removes common from buffers for debugCompile when common is active', async () => {
      const config = makeConfig();
      (config.passes as any).common = { path: 'common.glsl', inputs: {} };

      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'return length(p) - r;', activeBufferName: 'common',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'common',
        code: COMMON_CODE,
        config,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.debugCompile(makeMessage({
        config,
        buffers: { BufferA: BUFFER_A_CODE, common: COMMON_CODE },
      }));

      const [, , , buffersArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(buffersArg).toEqual({ BufferA: BUFFER_A_CODE });
    });
  });

  // -------------------------------------------------------------------------
  describe('config preservation', () => {
    it('passes null config through unchanged when config is null', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: null,
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage({ config: null }));

      const [, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      expect(configArg).toBeNull();
    });

    it('preserves all other passes in the config unchanged', async () => {
      (mockDebugManager.getState as any).mockReturnValue(makeDebugState({
        isEnabled: true, isActive: true, currentLine: 1,
        lineContent: 'line', activeBufferName: 'BufferA',
      }));
      (mockDebugManager.getDebugTarget as any).mockReturnValue(makeDebugTarget({
        passName: 'BufferA',
        code: BUFFER_A_CODE,
        config: {
          ...makeConfig(),
          passes: {
            ...makeConfig().passes,
            Image: { inputs: BUFFER_A_INPUTS },
          },
        },
        inputConfig: BUFFER_A_INPUTS,
      }));
      (mockDebugManager.modifyShaderForDebugging as any).mockReturnValue(MODIFIED_CODE);

      await processor.processMainShaderCompilation(makeMessage());

      const [, configArg] = (mockRenderEngine.compileShaderPipeline as any).mock.calls[0];
      // BufferA and BufferB passes should be unchanged
      expect(configArg.passes.BufferA).toEqual(makeConfig().passes.BufferA);
      expect(configArg.passes.BufferB).toEqual(makeConfig().passes.BufferB);
    });
  });
});
