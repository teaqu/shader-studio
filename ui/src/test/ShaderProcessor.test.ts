import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderProcessor } from '../lib/ShaderProcessor';
import type { RenderingEngine } from '../../../rendering/src/types';
import type { ShaderDebugManager } from '../lib/ShaderDebugManager';
import type { ShaderSourceMessage } from '@shader-studio/types';

describe('ShaderProcessor', () => {
  let shaderProcessor: ShaderProcessor;
  let mockRenderEngine: RenderingEngine;
  let mockShaderDebugManager: ShaderDebugManager;

  beforeEach(() => {
    // Mock ShaderDebugManager
    mockShaderDebugManager = {
      getState: vi.fn().mockReturnValue({
        isEnabled: false,
        isActive: false,
        currentLine: null,
        lineContent: null,
        filePath: null,
        activeBufferName: 'Image',
      }),
      modifyShaderForDebugging: vi.fn(),
      applyFullShaderPostProcessing: vi.fn().mockReturnValue(null),
      setDebugError: vi.fn(),
      updateDebugLine: vi.fn(),
      toggleEnabled: vi.fn(),
      setStateCallback: vi.fn(),
      setImageShaderCode: vi.fn(),
      getDebugTarget: vi.fn().mockImplementation((code: string, config: unknown) => ({
        passName: 'Image',
        code,
        config,
      })),
      setShaderContext: vi.fn(),
    } as any;

    // Mock RenderingEngine
    mockRenderEngine = {
      stopRenderLoop: vi.fn(),
      startRenderLoop: vi.fn(),
      cleanup: vi.fn(),
      flagReloadOnNextApply: vi.fn(),
      compileShaderPipeline: vi.fn().mockResolvedValue({
        success: true,
        warnings: [],
      }),
      updateBufferAndRecompile: vi.fn().mockResolvedValue({
        success: true,
      }),
      render: vi.fn(),
    } as any;

    shaderProcessor = new ShaderProcessor(
      mockRenderEngine,
      mockShaderDebugManager
    );
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(shaderProcessor).toBeDefined();
    });
  });

  it('routes a Slang debug plan to the structured rendering entry point', async () => {
    const config = { version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'texture' as const, path: 'current.png' } } } } };
    (mockShaderDebugManager as any).getSlangPreviewPlan = vi.fn().mockReturnValue({
      workspaceHash: 'hash', rootUri: 'file:///main.slang', selectedSourceUri: 'file:///main.slang', executionMarkerSlot: 0, captureSlots: [], files: [],
    });
    (mockRenderEngine as any).compileSlangDebugPlan = vi.fn().mockResolvedValue({ success: true });

    await shaderProcessor.processMainShaderCompilation({ type: 'shaderSource', code: 'float4 mainImage(float2 c) { return 1; }', config, path: '/main.slang', buffers: {} });

    expect((mockRenderEngine as any).compileSlangDebugPlan).toHaveBeenCalledWith(expect.any(Object), config);
    expect(mockRenderEngine.compileShaderPipeline).not.toHaveBeenCalled();
  });

  it('uses the original Slang source to map an editor cursor after dependency expansion', async () => {
    const processedSource = [
      '// expanded dependency',
      'float4 mainImage(float2 c) {',
      '  return 1;',
      '}',
    ].join('\n');
    const originalSource = [
      'float4 mainImage(float2 c) {',
      '  return 1;',
      '}',
    ].join('\n');
    (mockShaderDebugManager as any).getSlangPreviewPlan = vi.fn().mockReturnValue(null);

    await shaderProcessor.processMainShaderCompilation({
      type: 'shaderSource', code: processedSource, originalCode: originalSource,
      config: null, path: '/main.slang', buffers: {}, language: 'slang',
    });

    expect((mockShaderDebugManager as any).getSlangPreviewPlan).toHaveBeenCalledWith(
      processedSource, null, originalSource,
    );
  });

  it('routes a cursor-triggered Slang inline preview through the structured rendering entry point', async () => {
    const plan = {
      workspaceHash: 'cursor-hash', rootUri: 'file:///main.slang', selectedSourceUri: 'file:///main.slang', executionMarkerSlot: 0, captureSlots: [], files: [],
    };
    (shaderProcessor as unknown as { imageShaderCode: string }).imageShaderCode = 'float4 mainImage(float2 c) { return 1; }';
    (mockShaderDebugManager as any).getSlangPreviewPlan = vi.fn().mockReturnValue(plan);
    (mockRenderEngine as any).compileSlangDebugPlan = vi.fn().mockResolvedValue({ success: true });

    const result = await shaderProcessor.debugCompile({ type: 'shaderSource', code: 'float4 mainImage(float2 c) { return 1; }', config: null, path: '/main.slang', buffers: {}, language: 'slang' });

    expect(result).toMatchObject({ success: true });
    expect((mockRenderEngine as any).compileSlangDebugPlan).toHaveBeenCalledWith(plan, null);
    expect(mockRenderEngine.compileShaderPipeline).not.toHaveBeenCalled();
  });

  it('never rebuilds the untouched Slang source while the cursor moves between lines', async () => {
    const planForLine = (line: number) => ({
      workspaceHash: `hash-${line}`, rootUri: 'file:///main.slang', selectedSourceUri: 'file:///main.slang',
      executionMarkerSlot: line, captureSlots: [], files: [],
    });
    const message: ShaderSourceMessage = {
      type: 'shaderSource', code: 'float4 mainImage(float2 c) { return 1; }', config: null,
      path: '/main.slang', buffers: {}, language: 'slang',
    };
    (mockShaderDebugManager as any).getLanguage = vi.fn(() => 'slang');
    (mockShaderDebugManager as any).getSlangPreviewPlan = vi.fn()
      .mockReturnValueOnce(planForLine(3))
      .mockReturnValueOnce(planForLine(4));
    (mockRenderEngine as any).compileSlangDebugPlan = vi.fn().mockResolvedValue({ success: true });
    (shaderProcessor as unknown as { imageShaderCode: string }).imageShaderCode = message.code;

    await shaderProcessor.debugCompile(message);
    await shaderProcessor.debugCompile(message);

    expect((mockRenderEngine as any).compileSlangDebugPlan).toHaveBeenCalledTimes(2);
    // Compiling the untouched source would install it, flashing the whole
    // shader between two debugged lines.
    expect(mockRenderEngine.compileShaderPipeline).not.toHaveBeenCalled();
  });

  it('keeps the last-good Slang render when an imported-module preview fails', async () => {
    const plan = {
      workspaceHash: 'hash', rootUri: 'file:///main.slang', selectedSourceUri: 'file:///helper.slang', executionMarkerSlot: 0, captureSlots: [],
      files: [
        { uri: 'file:///main.slang', path: '/main.slang', source: 'import helper;', version: 1, moduleName: '', ownerPass: 'Image' },
        { uri: 'file:///helper.slang', path: '/helper.slang', source: 'module helper;', version: 2, moduleName: 'helper', ownerPass: 'Image' },
      ],
    };
    (mockShaderDebugManager as any).getSlangPreviewPlan = vi.fn().mockReturnValue(plan);
    (mockRenderEngine as any).compileSlangDebugPlan = vi.fn().mockResolvedValue({ success: false, errors: ['/helper.slang: unexpected token'] });
    (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({ success: true });

    const result = await shaderProcessor.processMainShaderCompilation({ type: 'shaderSource', code: 'float4 mainImage(float2 c) { return 1; }', config: null, path: '/main.slang', buffers: {}, language: 'slang' });

    expect(mockShaderDebugManager.setDebugError).toHaveBeenCalledWith('Debug shader compilation failed: /helper.slang: unexpected token');
    expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledTimes(1);
    expect(mockRenderEngine.startRenderLoop).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, warnings: undefined });
  });

  it('does not fallback or restart rendering for a superseded Slang preview request', async () => {
    (mockShaderDebugManager as any).getSlangPreviewPlan = vi.fn().mockReturnValue({
      workspaceHash: 'old-hash', rootUri: 'file:///main.slang', selectedSourceUri: 'file:///main.slang', executionMarkerSlot: 0, captureSlots: [], files: [],
    });
    (mockRenderEngine as any).compileSlangDebugPlan = vi.fn().mockResolvedValue({ success: false, errors: ['Superseded by a newer compile'], superseded: true });

    const result = await shaderProcessor.processMainShaderCompilation({ type: 'shaderSource', code: 'float4 mainImage(float2 c) { return 1; }', config: null, path: '/main.slang', buffers: {}, language: 'slang' });

    expect(result).toEqual({ success: false, errors: ['Superseded by a newer compile'], superseded: true });
    expect(mockRenderEngine.compileShaderPipeline).not.toHaveBeenCalled();
    expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    expect(mockShaderDebugManager.setDebugError).not.toHaveBeenCalled();
  });

  it('never sends Slang through the GLSL debug modifier when native planning is unavailable', async () => {
    (mockShaderDebugManager as any).getLanguage = vi.fn(() => 'slang');
    (mockShaderDebugManager.getState as any).mockReturnValue({ isEnabled: true, isActive: true, currentLine: 1, lineContent: 'float value = 1.0;', activeBufferName: 'Image' });

    await shaderProcessor.processMainShaderCompilation({ type: 'shaderSource', code: 'float4 mainImage(float2 c) { return 1; }', config: null, path: '/main.slang', buffers: {} });

    expect(mockShaderDebugManager.modifyShaderForDebugging).not.toHaveBeenCalled();
    expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(expect.stringContaining('mainImage'), null, '/main.slang', {}, undefined, undefined);
  });

  it('compiles full-shader Slang normalize output when native line planning is unavailable', async () => {
    (mockShaderDebugManager as any).getLanguage = vi.fn(() => 'slang');
    (mockShaderDebugManager.getState as any).mockReturnValue({
      isEnabled: true, isActive: false, currentLine: null, lineContent: null, activeBufferName: 'Image',
    });
    (mockShaderDebugManager.applyFullShaderPostProcessing as any).mockReturnValue('float4 mainImage(float2 c) { return normalized; }');

    await shaderProcessor.processMainShaderCompilation({
      type: 'shaderSource', code: 'float4 mainImage(float2 c) { return 1; }', config: null, path: '/main.slang', buffers: {},
    });

    expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
      expect.stringContaining('return normalized'), null, '/main.slang', {}, undefined, undefined,
    );
  });

  describe('isCurrentlyProcessing', () => {
    it('should return false initially', () => {
      expect(shaderProcessor.isCurrentlyProcessing()).toBe(false);
    });

    it('should return true while processing', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      // Make compilation take time
      (mockRenderEngine.compileShaderPipeline as any).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
      );

      const processPromise = shaderProcessor.processMainShaderCompilation(message, false);

      // Should be processing
      expect(shaderProcessor.isCurrentlyProcessing()).toBe(true);

      await processPromise;

      // Should be done processing
      expect(shaderProcessor.isCurrentlyProcessing()).toBe(false);
    });
  });

  describe('getImageShaderCode', () => {
    it('should return null initially', () => {
      expect(shaderProcessor.getImageShaderCode()).toBeNull();
    });

    it('should return shader code after processing', async () => {
      const shaderCode = 'void mainImage() {}';
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: shaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(shaderProcessor.getImageShaderCode()).toBe(shaderCode);
    });
  });

  describe('processMainShaderCompilation', () => {
    it('should compile shader successfully', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.stopRenderLoop).not.toHaveBeenCalled();
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
      expect(mockRenderEngine.startRenderLoop).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('reuses the engine declarations for a bare-file preview with no script context', async () => {
      // A common pass or helper with no mainImage carries no config and declares
      // none of the script's uniforms, but it is not saying the shader has none:
      // compiling it with none clears the engine's uniform state, and the host
      // sends only changed values after its first batch, so every constant the
      // script holds would sit at zero for the life of the shader.
      (mockRenderEngine as any).getCustomUniformDeclarations = vi.fn()
        .mockReturnValue('uniform float uStatic;');
      (mockRenderEngine as any).getCustomUniformInfo = vi.fn()
        .mockReturnValue([{ name: 'uStatic', type: 'float' }]);
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'float helper() { return 1.0; }',
        config: null,
        path: 'common.glsl',
        buffers: {},
        scriptContextOmitted: true,
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers,
        'uniform float uStatic;',
        [{ name: 'uStatic', type: 'float' }],
      );
    });

    it('prefers the message declarations when a bare-file preview carries its own', async () => {
      (mockRenderEngine as any).getCustomUniformDeclarations = vi.fn()
        .mockReturnValue('uniform float uStale;');
      (mockRenderEngine as any).getCustomUniformInfo = vi.fn()
        .mockReturnValue([{ name: 'uStale', type: 'float' }]);
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
        customUniformDeclarations: 'uniform float uFresh;',
        customUniformInfo: [{ name: 'uFresh', type: 'float' }],
        scriptContextOmitted: true,
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers,
        'uniform float uFresh;',
        [{ name: 'uFresh', type: 'float' }],
      );
    });

    it('passes resolved Slang paths for every pass to the rendering engine', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'float4 mainImage(float2 c) { return 1; }',
        config: { passes: { ComputeLife: { type: 'compute', path: 'passes/life-step.slang' } } },
        path: '/shaders/image.slang',
        buffers: { ComputeLife: 'void computeMain(uint3 id) {}' },
        bufferPathMap: {
          Image: '/shaders/image.slang',
          ComputeLife: '/shaders/passes/life-step.slang',
        },
      };

      await shaderProcessor.processMainShaderCompilation(message);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
        undefined,
        undefined,
        message.bufferPathMap,
      );
    });

    it('should flag deferred cleanup (not immediate) when reload is true', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, true);

      // Immediate cleanup is skipped to avoid black flash; deferred flag is set instead
      expect(mockRenderEngine.cleanup).not.toHaveBeenCalled();
      expect(mockRenderEngine.flagReloadOnNextApply).toHaveBeenCalled();
    });

    it('should not cleanup when reload is false', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.cleanup).not.toHaveBeenCalled();
    });

    it('should NOT reset time when reload is true', async () => {
      const mockResetTime = vi.fn();
      (mockRenderEngine as any).resetTime = mockResetTime;

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, true);

      expect(mockResetTime).not.toHaveBeenCalled();
    });

    it('should NOT reset time when reload is false', async () => {
      const mockResetTime = vi.fn();
      (mockRenderEngine as any).resetTime = mockResetTime;

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockResetTime).not.toHaveBeenCalled();
    });

    it('should pass only compile inputs to compileShaderPipeline', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it('should pass undefined custom uniform args when not provided', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
    });

    it('should handle compilation errors', async () => {
      const errorMessage = 'Shader compilation failed';
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: false,
        errors: [errorMessage],
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'invalid shader code',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([errorMessage]);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
      expect(mockRenderEngine.render).not.toHaveBeenCalled();
    });

    it('names the failed script when its uniforms are what the shader is missing', async () => {
      // A script that never loaded declares no uniforms, so the shader fails on
      // the identifiers it was meant to provide. Reporting only the GLSL error
      // sends the user hunting a typo in a name that is spelled correctly.
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: false,
        errors: ["ERROR: 0:6: 'iDayOfWeek' : undeclared identifier"],
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage(out vec4 c, in vec2 f) { c = vec4(iDayOfWeek); }',
        config: {},
        path: 'mix.glsl',
        buffers: {},
        scriptBundleError: 'Script file not found: ./mix.uniforms.ts',
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        'Script: Script file not found: ./mix.uniforms.ts',
        "ERROR: 0:6: 'iDayOfWeek' : undeclared identifier",
      ]);
    });

    it('names the failed script when the untouched compile fails under instrumentation', async () => {
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 5,
        lineContent: 'some code',
        filePath: 'mix.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any)
        .mockReturnValue('void mainImage() { /* debug */ }');
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: false,
        errors: ["ERROR: 0:6: 'iDayOfWeek' : undeclared identifier"],
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage(out vec4 c, in vec2 f) { c = vec4(iDayOfWeek); }',
        config: {},
        path: 'mix.glsl',
        buffers: {},
        scriptBundleError: 'Script evaluation error: ctx.iDate is not iterable',
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        'Script: Script evaluation error: ctx.iDate is not iterable',
        "ERROR: 0:6: 'iDayOfWeek' : undeclared identifier",
      ]);
    });

    it('leaves a superseded compile unannotated by the script error', async () => {
      // A superseded result is replaced by the newer compile's report, which
      // carries its own copy of the script error.
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: false,
        errors: ['Superseded by a newer compile'],
        superseded: true,
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'mix.glsl',
        buffers: {},
        scriptBundleError: 'Script file not found: ./mix.uniforms.ts',
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result).toEqual({
        success: false,
        errors: ['Superseded by a newer compile'],
        superseded: true,
      });
    });

    it('keeps the script error a warning when the shader still compiles', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'mix.glsl',
        buffers: {},
        scriptBundleError: 'Script file not found: ./mix.uniforms.ts',
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(['Script: Script file not found: ./mix.uniforms.ts']);
      expect(result.errors).toBeUndefined();
    });

    it('should preserve superseded main compile results without starting the render loop', async () => {
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: false,
        errors: ['Superseded by a newer compile'],
        superseded: true,
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result).toEqual({
        success: false,
        errors: ['Superseded by a newer compile'],
        superseded: true,
      });
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });

    it('should return warnings when compilation succeeds with warnings', async () => {
      const warnings = ['Warning 1', 'Warning 2'];
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: true,
        warnings,
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(warnings);
    });

    it('should compile with debug mode when active', async () => {
      const imageShaderCode = 'void mainImage() {}';
      const modifiedCode = 'void mainImage() { /* debug */ }';

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 5,
        lineContent: 'some code',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockShaderDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(imageShaderCode, 5);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        modifiedCode,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
    });

    it('reports the real shader\'s errors when instrumentation hides them', async () => {
      const imageShaderCode = 'void mainImage() { bad statement }';
      // Instrumentation truncates the body at the inspected line, so a broken
      // statement below it is not in what gets compiled - and the instrumented
      // compile succeeds while the user's shader does not.
      const modifiedCode = 'void mainImage() { /* debug */ }';

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 5,
        lineContent: 'some code',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);
      (mockRenderEngine.compileShaderPipeline as any)
        .mockResolvedValueOnce({ success: false, errors: ["ERROR: 0:1: 'bad' : undeclared identifier"] })
        .mockResolvedValue({ success: true });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(["ERROR: 0:1: 'bad' : undeclared identifier"]);
      // The instrumented variant is never built: there is nothing to debug in a
      // shader that does not compile.
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledTimes(1);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        imageShaderCode, message.config, message.path, message.buffers, undefined, undefined,
      );
    });

    it('compiles the untouched source before the instrumented one', async () => {
      const imageShaderCode = 'void mainImage() {}';
      const modifiedCode = 'void mainImage() { /* debug */ }';

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 5,
        lineContent: 'some code',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(true);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenNthCalledWith(
        1, imageShaderCode, message.config, message.path, message.buffers, undefined, undefined,
      );
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenNthCalledWith(
        2, modifiedCode, message.config, message.path, message.buffers, undefined, undefined,
      );
    });

    it('does not double-compile a shader that needs no instrumentation', async () => {
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: false,
        isActive: false,
        currentLine: null,
        lineContent: '',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledTimes(1);
    });

    it('should fallback to original code if debug compilation fails', async () => {
      const imageShaderCode = 'void mainImage() {}';
      const modifiedCode = 'void mainImage() { /* debug */ }';

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 5,
        lineContent: 'some code',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);

      // First call (untouched source) succeeds, second (instrumented) fails
      (mockRenderEngine.compileShaderPipeline as any)
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, errors: ['Debug compilation failed'] });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      // The untouched source compiles first and stays installed, so a failed
      // instrumented compile needs no second build of the original.
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledTimes(2);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenNthCalledWith(1, imageShaderCode, message.config, message.path, message.buffers, undefined, undefined);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenNthCalledWith(2, modifiedCode, message.config, message.path, message.buffers, undefined, undefined);
      expect(result.success).toBe(true);
      expect(mockShaderDebugManager.setDebugError).toHaveBeenCalledWith(
        expect.stringContaining('Debug shader compilation failed'),
      );
    });

    it('should handle exceptions during compilation', async () => {
      const error = new Error('Unexpected error');
      (mockRenderEngine.compileShaderPipeline as any).mockRejectedValue(error);

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.processMainShaderCompilation(message, false);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([`Shader compilation error: ${error}`]);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });

    it('passes Slang buffer sources through to the rendering engine', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        language: 'slang',
        code: 'float4 mainImage(float2 c) { return float4(0); }',
        config: {
          version: '1',
          passes: {
            Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA' } } },
            BufferA: { path: 'buffer-a.slang', inputs: {} },
          },
        },
        path: 'image.slang',
        buffers: {
          BufferA: 'float4 mainImage(float2 c) { return float4(1); }',
        },
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        message.code,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
    });
  });

  describe('processCommonBufferUpdate', () => {
    it('should update common buffer successfully', async () => {
      const code = 'float common() { return 1.0; }';

      const result = await shaderProcessor.processCommonBufferUpdate(code);

      expect(mockRenderEngine.stopRenderLoop).not.toHaveBeenCalled();
      expect(mockRenderEngine.updateBufferAndRecompile).toHaveBeenCalledWith('common', code);
      expect(mockRenderEngine.startRenderLoop).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should handle common buffer update errors', async () => {
      const errorMessage = 'Common buffer compilation failed';
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
        success: false,
        errors: [errorMessage],
      });

      const code = 'invalid common code';

      const result = await shaderProcessor.processCommonBufferUpdate(code);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([errorMessage]);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });

    it('should preserve superseded common buffer update results', async () => {
      (mockRenderEngine.updateBufferAndRecompile as any).mockResolvedValue({
        success: false,
        errors: ['Superseded by a newer compile'],
        superseded: true,
      });

      const code = 'float common() { return 1.0; }';

      const result = await shaderProcessor.processCommonBufferUpdate(code);

      expect(result).toEqual({
        success: false,
        errors: ['Superseded by a newer compile'],
        superseded: true,
      });
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });

    it('should handle exceptions during common buffer update', async () => {
      const error = new Error('Unexpected error');
      (mockRenderEngine.updateBufferAndRecompile as any).mockRejectedValue(error);

      const code = 'float common() { return 1.0; }';

      const result = await shaderProcessor.processCommonBufferUpdate(code);

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([`Common buffer update error: ${error}`]);
      expect(mockRenderEngine.startRenderLoop).not.toHaveBeenCalled();
    });
  });

  describe('debugCompile', () => {
    it('should return success if no original shader code exists', async () => {
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: 'void mainImage() {}',
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const result = await shaderProcessor.debugCompile(message);

      expect(result.success).toBe(true);
      expect(mockRenderEngine.compileShaderPipeline).not.toHaveBeenCalled();
    });

    it('should compile with original code when debug mode is inactive', async () => {
      const imageShaderCode = 'void mainImage() {}';

      // First compile to set original code
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      // Reset mocks
      vi.clearAllMocks();

      // Debug mode is inactive
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: false,
        isActive: false,
        currentLine: null,
        lineContent: null,
        filePath: null,
        activeBufferName: 'Image',
      });

      const result = await shaderProcessor.debugCompile(message);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        imageShaderCode,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it('should compile with modified code when debug mode is active', async () => {
      const imageShaderCode = 'void mainImage() {}';
      const modifiedCode = 'void mainImage() { /* debug */ }';

      // First compile to set original code
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      // Reset mocks
      vi.clearAllMocks();

      // Debug mode is active
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 10,
        lineContent: 'debug line',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(modifiedCode);

      const result = await shaderProcessor.debugCompile(message);

      expect(mockShaderDebugManager.modifyShaderForDebugging).toHaveBeenCalledWith(imageShaderCode, 10);
      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        modifiedCode,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it('should fallback to original code if modification fails', async () => {
      const imageShaderCode = 'void mainImage() {}';

      // First compile to set original code
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);

      // Reset mocks
      vi.clearAllMocks();

      // Debug mode is active but modification returns null
      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 10,
        lineContent: 'debug line',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue(null);

      const result = await shaderProcessor.debugCompile(message);

      expect(mockRenderEngine.compileShaderPipeline).toHaveBeenCalledWith(
        imageShaderCode,
        message.config,
        message.path,
        message.buffers,
        undefined,
        undefined,
      );
      expect(result.success).toBe(true);
    });

    it('does not rebuild the untouched source when only the debug line moved', async () => {
      const imageShaderCode = 'void mainImage() {}';
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);
      vi.clearAllMocks();

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 10,
        lineContent: 'debug line',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any)
        .mockReturnValueOnce('void mainImage() { /* line 10 */ }')
        .mockReturnValueOnce('void mainImage() { /* line 11 */ }');

      await shaderProcessor.debugCompile(message);
      await shaderProcessor.debugCompile(message);

      // Rebuilding the untouched source installs it, and the render loop shows
      // the whole shader until the instrumented compile lands - a flash of the
      // full image between two debugged lines.
      expect(
        (mockRenderEngine.compileShaderPipeline as any).mock.calls.map((call: any[]) => call[0]),
      ).toEqual([
        'void mainImage() { /* line 10 */ }',
        'void mainImage() { /* line 11 */ }',
      ]);
    });

    it('rebuilds the untouched source when the compile inputs change', async () => {
      const imageShaderCode = 'void mainImage() {}';
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);
      vi.clearAllMocks();

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 4,
        lineContent: 'debug line',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue('instrumented');

      // Same source, new buffers: the verdict from the previous inputs says
      // nothing about whether this one compiles.
      await shaderProcessor.debugCompile({
        ...message,
        buffers: { BufferA: 'void mainImage() {}' },
      });

      expect(
        (mockRenderEngine.compileShaderPipeline as any).mock.calls.map((call: any[]) => call[0]),
      ).toEqual([imageShaderCode, 'instrumented']);
    });

    it('re-checks the untouched source while it fails to compile', async () => {
      const imageShaderCode = 'void mainImage() { bad; }';
      (shaderProcessor as unknown as { imageShaderCode: string }).imageShaderCode = imageShaderCode;

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 3,
        lineContent: 'debug line',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue('instrumented');
      (mockRenderEngine.compileShaderPipeline as any).mockResolvedValue({
        success: false,
        errors: ["ERROR: 0:1: 'bad' : undeclared identifier"],
      });

      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      const first = await shaderProcessor.debugCompile(message);
      const second = await shaderProcessor.debugCompile(message);

      // A source that does not compile is never verified, so the error keeps
      // being reported instead of the instrumented compile hiding it.
      expect(first.success).toBe(false);
      expect(second.success).toBe(false);
      expect(
        (mockRenderEngine.compileShaderPipeline as any).mock.calls.map((call: any[]) => call[0]),
      ).toEqual([imageShaderCode, imageShaderCode]);
    });

    it('falls back to the untouched source when a line move fails to instrument', async () => {
      const imageShaderCode = 'void mainImage() {}';
      const message: ShaderSourceMessage = {
        type: 'shaderSource',
        code: imageShaderCode,
        config: {},
        path: 'test.glsl',
        buffers: {},
      };

      await shaderProcessor.processMainShaderCompilation(message, false);
      vi.clearAllMocks();

      (mockShaderDebugManager.getState as any).mockReturnValue({
        isEnabled: true,
        isActive: true,
        currentLine: 7,
        lineContent: 'debug line',
        filePath: 'test.glsl',
        activeBufferName: 'Image',
      });
      (mockShaderDebugManager.modifyShaderForDebugging as any).mockReturnValue('instrumented');
      (mockRenderEngine.compileShaderPipeline as any)
        .mockResolvedValueOnce({ success: false, errors: ['Debug compilation failed'] })
        .mockResolvedValue({ success: true });

      const result = await shaderProcessor.debugCompile(message);

      // Skipping the verified baseline leaves the previous instrumented program
      // installed, so the failed line still has to restore the original.
      expect(result.success).toBe(true);
      expect(
        (mockRenderEngine.compileShaderPipeline as any).mock.calls.map((call: any[]) => call[0]),
      ).toEqual(['instrumented', imageShaderCode]);
      expect(mockShaderDebugManager.setDebugError).toHaveBeenCalledWith(
        expect.stringContaining('Debug shader compilation failed'),
      );
    });
  });
});
