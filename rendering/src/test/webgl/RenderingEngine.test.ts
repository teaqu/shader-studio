import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderingEngine } from "../../webgl/RenderingEngine";
import { ConfigValidator } from "../../util/ConfigValidator";
import type { ShaderConfig } from "@shader-studio/types";
import type { PixelRegionResult } from "../../types/PixelRegion";

// Mock the ConfigValidator
vi.mock("../../util/ConfigValidator", () => ({
  ConfigValidator: {
    validateConfig: vi.fn()
  }
}));

describe("RenderingEngine", () => {
  let renderingEngine: RenderingEngine;
  let mockFrameRenderer: any;

  beforeEach(() => {
    renderingEngine = new RenderingEngine();
    vi.spyOn(console, "log").mockImplementation(() => { });

    mockFrameRenderer = {
      startRenderLoop: vi.fn(),
      stopRenderLoop: vi.fn(),
      setFPSLimit: vi.fn(),
      setCustomUniformManager: vi.fn(),
    };

    Object.defineProperty(renderingEngine, 'frameRenderer', {
      value: mockFrameRenderer,
      writable: true,
      configurable: true
    });
    Object.defineProperty(renderingEngine, 'customUniformManager', {
      value: { clear: vi.fn(), loadDeclarations: vi.fn(), hasUniforms: vi.fn().mockReturnValue(false), getValues: vi.fn().mockReturnValue([]) },
      writable: true,
      configurable: true
    });
  });

  describe("config validation", () => {
    let mockPipeline: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
        setCustomUniformManager: vi.fn(),
        resetTime: vi.fn(),
        getPasses: vi.fn(() => []),
      };
      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: { getCurrentTime: vi.fn().mockReturnValue(0), isPaused: vi.fn().mockReturnValue(false) },
        writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: { syncAllVideosToTime: vi.fn(), pauseAllVideos: vi.fn(), resumeAllVideos: vi.fn(), syncAllAudioToTime: vi.fn(), pauseAllAudio: vi.fn(), resumeAllAudio: vi.fn(), muteAllAudio: vi.fn(), unmuteAllAudio: vi.fn() },
        writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should validate config before processing", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({ isValid: true, errors: [] });

      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        config,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).toHaveBeenCalledWith(config);
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
    });

    it("should reject compilation when config validation fails", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({
        isValid: false,
        errors: ['Test validation error']
      });

      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {}
        }
      };

      const result = await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        config,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).toHaveBeenCalledWith(config);
      expect(result!.success).toBe(false);
      expect(result!.errors![0]).toContain('Invalid shader configuration: Test validation error');
      expect(mockPipeline.compileShaderPipeline).not.toHaveBeenCalled();
    });

    it("should not validate null config", async () => {
      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);

      await renderingEngine.compileShaderPipeline(
        "void mainImage() {}",
        null,
        "test.glsl",
        {}
      );

      expect(mockValidateConfig).not.toHaveBeenCalled();
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
    });

    it("should serialize overlapping shader compilations", async () => {
      let resolveFirst!: (value: { success: boolean }) => void;
      let resolveSecond!: (value: { success: boolean }) => void;
      mockPipeline.compileShaderPipeline
        .mockImplementationOnce(() => new Promise(resolve => {
          resolveFirst = resolve;
        }))
        .mockImplementationOnce(() => new Promise(resolve => {
          resolveSecond = resolve;
        }));

      const firstCompile = renderingEngine.compileShaderPipeline(
        "void mainImage() { first(); }",
        null,
        "shader.glsl",
        {},
      );
      const secondCompile = renderingEngine.compileShaderPipeline(
        "void mainImage() { second(); }",
        null,
        "shader.glsl",
        {},
      );

      await Promise.resolve();

      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(1);
      expect(mockPipeline.compileShaderPipeline).toHaveBeenNthCalledWith(
        1,
        "void mainImage() { first(); }",
        null,
        "shader.glsl",
        {},
      );

      resolveFirst({ success: true });

      await vi.waitFor(() => {
        expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(2);
      });
      expect(mockPipeline.compileShaderPipeline).toHaveBeenNthCalledWith(
        2,
        "void mainImage() { second(); }",
        null,
        "shader.glsl",
        {},
      );

      resolveSecond({ success: true });

      await expect(firstCompile).resolves.toEqual({ success: true });
      await expect(secondCompile).resolves.toEqual({ success: true });
    });
  });

  describe('Buffer Update Tests', () => {
    let mockPipeline: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
        setCustomUniformManager: vi.fn(),
        getPasses: vi.fn(() => [
          { name: 'Image', shaderSrc: 'void main() {}' },
          { name: 'BufferA', shaderSrc: 'original buffer content' }
        ]),
        getShaderPath: vi.fn(() => 'test.glsl')
      };


      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: { getCurrentTime: vi.fn().mockReturnValue(0), isPaused: vi.fn().mockReturnValue(false) },
        writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: { syncAllVideosToTime: vi.fn(), pauseAllVideos: vi.fn(), resumeAllVideos: vi.fn(), syncAllAudioToTime: vi.fn(), pauseAllAudio: vi.fn(), resumeAllAudio: vi.fn(), muteAllAudio: vi.fn(), unmuteAllAudio: vi.fn() },
        writable: true, configurable: true,
      });

      const mockValidateConfig = vi.mocked(ConfigValidator.validateConfig);
      mockValidateConfig.mockReturnValue({ isValid: true, errors: [] });

      vi.clearAllMocks();
    });

    it('should return current config via getCurrentConfig', () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Set the config by calling compileShaderPipeline
      renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        {}
      );

      const currentConfig = renderingEngine.getCurrentConfig();
      expect(currentConfig).toEqual(testConfig);
    });

    it('should update buffer and recompile via updateBufferAndRecompile', async () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Initialize with a config
      await renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        { BufferA: 'original buffer content' }
      );

      // Mock the pipeline compilation for buffer update
      const mockCompileResult = { success: true };
      mockPipeline.compileShaderPipeline.mockResolvedValue(mockCompileResult);

      // Update buffer
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'updated buffer content'
      );

      expect(result).toEqual({ success: true });
      
      // Check the second call (buffer update) specifically
      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledTimes(2);
      const bufferUpdateCall = mockPipeline.compileShaderPipeline.mock.calls[1];
      expect(bufferUpdateCall).toEqual([
        'void main() {}', // imagePass.shaderSrc
        testConfig,
        'test.glsl',
        { BufferA: 'updated buffer content' }, // updated buffers
      ]);
    });

    it('should handle buffer update compilation failure', async () => {
      const testConfig: ShaderConfig = {
        version: '1.0',
        passes: {
          Image: { inputs: {} },
          BufferA: { 
            inputs: {},
            path: 'buffer-a.glsl'
          }
        }
      };

      // Initialize with a config
      await renderingEngine.compileShaderPipeline(
        'void main() {}',
        testConfig,
        'test.glsl',
        { BufferA: 'original content' }
      );

      // Mock compilation failure
      const mockCompileResult = {
        success: false,
        errors: ['Buffer compilation failed']
      };
      mockPipeline.compileShaderPipeline.mockResolvedValue(mockCompileResult);

      // Update buffer
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'broken buffer content'
      );

      expect(result).toEqual({
        success: false,
        errors: ['Buffer compilation failed']
      });
    });

    it('should handle buffer update when no config is set', async () => {
      // Don't initialize with any config - but set up mock pipeline
      mockPipeline.getPasses.mockReturnValue([]);
      
      const result = await renderingEngine.updateBufferAndRecompile(
        'BufferA',
        'some content'
      );

      expect(result).toEqual({
        success: false,
        errors: ["Buffer 'BufferA' not found in current shader"]
      });
    });
  });

  describe("getVariableCaptureCompileContext", () => {
    it("does not include commonCode when the active capture code is the common pass itself", () => {
      const mockPipeline = {
        getPasses: vi.fn(() => [
          { name: 'common', shaderSrc: 'vec3 dddd = vec3(1.0);' },
          { name: 'Image', shaderSrc: 'void mainImage() {}', inputs: {} },
        ]),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });

      const result = renderingEngine.getVariableCaptureCompileContext('vec3 dddd = vec3(1.0);');

      expect(result.commonCode).toBe('');
      expect(result.slotAssignments).toEqual([]);
      expect(result.channelTypes).toEqual(['2D', '2D', '2D', '2D']);
    });

    it("includes commonCode when capturing a non-common pass", () => {
      const mockPipeline = {
        getPasses: vi.fn(() => [
          { name: 'common', shaderSrc: 'vec3 dddd = vec3(1.0);' },
          { name: 'Image', shaderSrc: 'void mainImage() {}', inputs: {} },
        ]),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });

      const result = renderingEngine.getVariableCaptureCompileContext('void mainImage() {}');

      expect(result.commonCode).toBe('vec3 dddd = vec3(1.0);');
    });

    it("declares cubemap channels as Cube so capture shaders compile", () => {
      const mockPipeline = {
        getPasses: vi.fn(() => [
          {
            name: 'Image',
            shaderSrc: 'void mainImage() {}',
            inputs: { iChannel0: { type: 'cubemap', path: 'sky/' } },
          },
        ]),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });

      const result = renderingEngine.getVariableCaptureCompileContext('void mainImage() {}');

      expect(result.channelTypes).toEqual(['Cube', '2D', '2D', '2D']);
      expect(result.slotAssignments).toEqual([{ slot: 0, key: 'iChannel0', isCustomName: false }]);
    });

    it("keeps non-cubemap channels 2D", () => {
      const mockPipeline = {
        getPasses: vi.fn(() => [
          {
            name: 'Image',
            shaderSrc: 'void mainImage() {}',
            inputs: {
              iChannel0: { type: 'texture', path: 'noise.png' },
              iChannel1: { type: 'buffer', source: 'BufferA' },
            },
          },
        ]),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });

      expect(renderingEngine.getVariableCaptureCompileContext('void mainImage() {}').channelTypes)
        .toEqual(['2D', '2D', '2D', '2D']);
    });
  });

  describe("getVariableCaptureTextureBindings", () => {
    const defaultTexture = { id: 'default' };
    const cubemapTexture = { id: 'cubemap' };
    const keyboardTexture = { id: 'keyboard' };
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockResourceManager = {
        getDefaultTexture: vi.fn(() => defaultTexture),
        getImageTextureCache: vi.fn(() => ({ 'noise.png': { id: 'noise' } })),
        getCubemapTexture: vi.fn((path: string) => (path === 'sky/resolved/' ? cubemapTexture : null)),
        getKeyboardTexture: vi.fn(() => keyboardTexture),
        updateKeyboardTexture: vi.fn(),
        getVideoTexture: vi.fn(() => null),
        getAudioTexture: vi.fn(() => null),
      };
      mockTimeManager = { isPaused: vi.fn(() => false) };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'bufferManager', {
        value: { getPassBuffers: vi.fn(() => ({})) }, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'keyboardManager', {
        value: {
          getKeyHeld: vi.fn(() => new Uint8Array([1])),
          getKeyPressed: vi.fn(() => new Uint8Array([2])),
          getKeyToggled: vi.fn(() => new Uint8Array([3])),
        },
        writable: true, configurable: true,
      });
    });

    const bindingsFor = (inputs: any) =>
      (renderingEngine as any).getVariableCaptureTextureBindings(inputs);

    it("binds the cubemap texture for a cubemap input", () => {
      const bindings = bindingsFor({
        iChannel0: { type: 'cubemap', path: 'sky/', resolved_path: 'sky/resolved/' },
      });

      expect(bindings[0]).toBe(cubemapTexture);
      expect(bindings.slice(1)).toEqual([defaultTexture, defaultTexture, defaultTexture]);
    });

    it("falls back to the unresolved cubemap path", () => {
      mockResourceManager.getCubemapTexture = vi.fn((path: string) => (path === 'sky/' ? cubemapTexture : null));

      expect(bindingsFor({ iChannel0: { type: 'cubemap', path: 'sky/', resolved_path: 'sky/missing/' } })[0])
        .toBe(cubemapTexture);
    });

    it("leaves a cubemap slot unbound rather than binding a 2D default", () => {
      expect(bindingsFor({ iChannel0: { type: 'cubemap', path: 'unknown/' } })[0]).toBeNull();
    });

    it("still binds 2D inputs from the image cache", () => {
      expect(bindingsFor({ iChannel0: { type: 'texture', path: 'noise.png' } })[0]).toEqual({ id: 'noise' });
    });

    it("refreshes the keyboard texture while the shader is running", () => {
      const bindings = bindingsFor({ iChannel0: { type: 'keyboard' } });

      expect(mockResourceManager.updateKeyboardTexture).toHaveBeenCalledWith(
        new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]),
      );
      expect(bindings[0]).toBe(keyboardTexture);
    });

    it("captures the paused keyboard texture rather than keys pressed since", () => {
      mockTimeManager.isPaused = vi.fn(() => true);

      const bindings = bindingsFor({ iChannel0: { type: 'keyboard' } });

      expect(mockResourceManager.updateKeyboardTexture).not.toHaveBeenCalled();
      expect(bindings[0]).toBe(keyboardTexture);
    });
  });

  describe("FPS limiting", () => {
    it("should delegate setFPSLimit to FrameRenderer", () => {
      renderingEngine.setFPSLimit(30);
      expect(mockFrameRenderer.setFPSLimit).toHaveBeenCalledWith(30);
    });
  });

  describe("setInputEnabled", () => {
    it("should delegate input enable state to keyboard, mouse, and camera managers", () => {
      const mockKeyboardManager = { setEnabled: vi.fn() };
      const mockMouseManager = { setEnabled: vi.fn() };
      const mockCameraManager = { setEnabled: vi.fn() };

      Object.defineProperty(renderingEngine, "keyboardManager", {
        value: mockKeyboardManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "mouseManager", {
        value: mockMouseManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "cameraManager", {
        value: mockCameraManager, writable: true, configurable: true,
      });

      renderingEngine.setInputEnabled(false);

      expect(mockKeyboardManager.setEnabled).toHaveBeenCalledWith(false);
      expect(mockMouseManager.setEnabled).toHaveBeenCalledWith(false);
      expect(mockCameraManager.setEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe("handleCanvasResize", () => {
    it("uses the resized canvas size directly when resolution scale is already applied by the UI", () => {
      const canvas = { width: 320, height: 180 };
      const imagePass = { name: "Image", shaderSrc: "void mainImage() {}", inputs: {} };
      const mockBufferManager = { resizeBuffers: vi.fn() };
      const mockPipeline = { getPass: vi.fn().mockReturnValue(imagePass) };
      mockFrameRenderer.isRunning = vi.fn().mockReturnValue(false);
      mockFrameRenderer.renderSinglePass = vi.fn();

      Object.defineProperty(renderingEngine, "glCanvas", {
        value: canvas, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "bufferManager", {
        value: mockBufferManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "shaderPipeline", {
        value: mockPipeline, writable: true, configurable: true,
      });

      renderingEngine.handleCanvasResize(160, 90);

      expect(canvas).toEqual({ width: 160, height: 90 });
      expect(mockBufferManager.resizeBuffers).toHaveBeenCalledWith(160, 90);
      expect(mockPipeline.getPass).toHaveBeenCalledWith("Image");
      expect(mockFrameRenderer.renderSinglePass).not.toHaveBeenCalled();
    });

    it("resizes each buffer pass using its configured resolution", () => {
      const canvas = { width: 320, height: 180 };
      const imagePass = { name: "Image", shaderSrc: "void mainImage() {}", inputs: {} };
      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {},
          BufferA: { path: "buffer-a.glsl", inputs: {} },
          BufferB: { path: "buffer-b.glsl", resolution: { scale: 0.5 }, inputs: {} },
          BufferC: { path: "buffer-c.glsl", resolution: { width: 64, height: 32 }, inputs: {} },
        },
      };
      const mockBufferManager = { resizeBuffers: vi.fn() };
      const mockPipeline = { getPass: vi.fn().mockReturnValue(imagePass) };
      mockFrameRenderer.isRunning = vi.fn().mockReturnValue(false);
      mockFrameRenderer.renderSinglePass = vi.fn();

      Object.defineProperty(renderingEngine, "currentConfig", {
        value: config, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "glCanvas", {
        value: canvas, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "bufferManager", {
        value: mockBufferManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "shaderPipeline", {
        value: mockPipeline, writable: true, configurable: true,
      });

      renderingEngine.handleCanvasResize(160, 90);

      expect(mockBufferManager.resizeBuffers).toHaveBeenCalledWith(160, 90, {
        BufferA: { width: 160, height: 90 },
        BufferB: { width: 80, height: 45 },
        BufferC: { width: 64, height: 32 },
      });
    });

    it("clamps canvas and buffer pass sizes to WebGL render limits", () => {
      const canvas = { width: 320, height: 180 };
      const imagePass = { name: "Image", shaderSrc: "void mainImage() {}", inputs: {} };
      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {},
          BufferA: { path: "buffer-a.glsl", inputs: {} },
          BufferB: { path: "buffer-b.glsl", resolution: { scale: 0.5 }, inputs: {} },
          BufferC: { path: "buffer-c.glsl", resolution: { width: 10_000, height: 5_000 }, inputs: {} },
        },
      };
      const gl = {
        MAX_TEXTURE_SIZE: 0x0D33,
        MAX_RENDERBUFFER_SIZE: 0x84E8,
        MAX_VIEWPORT_DIMS: 0x0D3A,
        getParameter: vi.fn((param: number) => {
          if (param === 0x0D33) {
            return 16_384;
          }
          if (param === 0x84E8) {
            return 12_288;
          }
          if (param === 0x0D3A) {
            return [8_192, 4_096];
          }
          return undefined;
        }),
      };
      const mockBufferManager = { resizeBuffers: vi.fn() };
      const mockPipeline = { getPass: vi.fn().mockReturnValue(imagePass) };
      mockFrameRenderer.isRunning = vi.fn().mockReturnValue(false);
      mockFrameRenderer.renderSinglePass = vi.fn();

      Object.defineProperty(renderingEngine, "currentConfig", {
        value: config, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "glCanvas", {
        value: canvas, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "gl", {
        value: gl, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "bufferManager", {
        value: mockBufferManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "shaderPipeline", {
        value: mockPipeline, writable: true, configurable: true,
      });

      renderingEngine.handleCanvasResize(12_000, 9_000);

      expect(canvas).toEqual({ width: 8_192, height: 4_096 });
      expect(mockBufferManager.resizeBuffers).toHaveBeenCalledWith(8_192, 4_096, {
        BufferA: { width: 8_192, height: 4_096 },
        BufferB: { width: 4_096, height: 2_048 },
        BufferC: { width: 8_192, height: 4_096 },
      });
    });

    it("uses the actual WebGL drawing buffer size when the browser clamps the default framebuffer", () => {
      const canvas = { width: 320, height: 180 };
      const imagePass = { name: "Image", shaderSrc: "void mainImage() {}", inputs: {} };
      const config: ShaderConfig = {
        version: "1.0",
        passes: {
          Image: {},
          BufferA: { path: "buffer-a.glsl", inputs: {} },
          BufferB: { path: "buffer-b.glsl", resolution: { scale: 0.5 }, inputs: {} },
        },
      };
      const gl = {
        drawingBufferWidth: 6_448,
        drawingBufferHeight: 8_192,
      };
      const mockBufferManager = { resizeBuffers: vi.fn() };
      const mockPipeline = { getPass: vi.fn().mockReturnValue(imagePass) };
      mockFrameRenderer.isRunning = vi.fn().mockReturnValue(false);
      mockFrameRenderer.renderSinglePass = vi.fn();

      Object.defineProperty(renderingEngine, "currentConfig", {
        value: config, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "glCanvas", {
        value: canvas, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "gl", {
        value: gl, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "renderLimits", {
        value: { maxWidth: 16_384, maxHeight: 16_384 }, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "bufferManager", {
        value: mockBufferManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, "shaderPipeline", {
        value: mockPipeline, writable: true, configurable: true,
      });

      renderingEngine.handleCanvasResize(6_448, 10_192);

      expect(canvas).toEqual({ width: 6_448, height: 8_192 });
      expect(mockBufferManager.resizeBuffers).toHaveBeenCalledWith(6_448, 8_192, {
        BufferA: { width: 6_448, height: 8_192 },
        BufferB: { width: 3_224, height: 4_096 },
      });
    });
  });

  describe("video sync on compilation", () => {
    let mockPipeline: any;
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
        setCustomUniformManager: vi.fn(),
        resetTime: vi.fn(),
        getPasses: vi.fn(() => []),
      };
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'cameraManager', {
        value: { reset: vi.fn() }, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should sync and resume videos on successful compilation when not paused", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(7.5);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(7.5);
      expect(mockResourceManager.resumeAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.pauseAllVideos).not.toHaveBeenCalled();
    });

    it("should sync and pause videos on successful compilation when paused", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(3.0);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(3.0);
      expect(mockResourceManager.pauseAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });

    it("should hold videos during all reset compilations so audio and video restart together", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(0);

      renderingEngine.resetTime();
      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});
      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(0);
      expect(mockResourceManager.pauseAllVideos).toHaveBeenCalledTimes(2);
      expect(mockResourceManager.resumeAllVideos).not.toHaveBeenCalled();

      renderingEngine.resumeAllVideos();
      mockResourceManager.pauseAllVideos.mockClear();
      mockResourceManager.resumeAllVideos.mockClear();

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.pauseAllVideos).not.toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).toHaveBeenCalledTimes(1);
    });

    it("should leave videos untouched on failed compilation", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: false, error: "syntax error" });

      await renderingEngine.compileShaderPipeline("bad code", null, "test.glsl", {});

      expect(mockResourceManager.pauseAllVideos).not.toHaveBeenCalled();
      expect(mockResourceManager.syncAllVideosToTime).not.toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });
  });

  describe("video sync on togglePause", () => {
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should sync videos and pause them when pausing shader", () => {
      // Was not paused -> toggling will pause
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(10.0);

      renderingEngine.togglePause();

      expect(mockTimeManager.togglePause).toHaveBeenCalled();
      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(10.0);
      expect(mockResourceManager.pauseAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).not.toHaveBeenCalled();
    });

    it("should sync videos and resume them when unpausing shader", () => {
      // Was paused -> toggling will unpause
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(2.0);

      renderingEngine.togglePause();

      expect(mockTimeManager.togglePause).toHaveBeenCalled();
      expect(mockResourceManager.syncAllVideosToTime).toHaveBeenCalledWith(2.0);
      expect(mockResourceManager.resumeAllVideos).toHaveBeenCalled();
      expect(mockResourceManager.pauseAllVideos).not.toHaveBeenCalled();
    });
  });

  describe("readPixel", () => {
    it("should return null when canvas is not initialized", () => {
      const result = renderingEngine.readPixel(0, 0);
      expect(result).toBeNull();
    });

    it("should return null when WebGL context is not available", () => {
      const mockCanvas = document.createElement("canvas");
      mockCanvas.getContext = vi.fn().mockReturnValue(null);

      Object.defineProperty(renderingEngine, "glCanvas", {
        value: mockCanvas,
        writable: true,
        configurable: true,
      });

      const result = renderingEngine.readPixel(0, 0);
      expect(result).toBeNull();
    });

    it("should read pixel data correctly", () => {
      const mockCanvas = document.createElement("canvas");
      mockCanvas.width = 100;
      mockCanvas.height = 100;

      const mockGl = {
        readPixels: vi.fn().mockImplementation(
          (x: number, y: number, width: number, height: number, format: number, type: number, pixels: Uint8Array) => {
            pixels[0] = 255; // R
            pixels[1] = 128; // G
            pixels[2] = 64;  // B
            pixels[3] = 255; // A
          }
        ),
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
      };

      mockCanvas.getContext = vi.fn().mockReturnValue(mockGl);

      Object.defineProperty(renderingEngine, "glCanvas", {
        value: mockCanvas,
        writable: true,
        configurable: true,
      });

      const result = renderingEngine.readPixel(50, 30);

      expect(result).toEqual({
        r: 255,
        g: 128,
        b: 64,
        a: 255,
      });
    });

    it("should flip Y coordinate for WebGL (bottom-left origin)", () => {
      const mockCanvas = document.createElement("canvas");
      mockCanvas.width = 100;
      mockCanvas.height = 100;

      const mockGl = {
        readPixels: vi.fn(),
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
      };

      mockCanvas.getContext = vi.fn().mockReturnValue(mockGl);

      Object.defineProperty(renderingEngine, "glCanvas", {
        value: mockCanvas,
        writable: true,
        configurable: true,
      });

      // Read at y=30 on a 100px tall canvas
      // Should flip to glY = 100 - 30 - 1 = 69
      renderingEngine.readPixel(50, 30);

      expect(mockGl.readPixels).toHaveBeenCalledWith(
        50,    // x
        69,    // flipped y (100 - 30 - 1)
        1,     // width
        1,     // height
        mockGl.RGBA,
        mockGl.UNSIGNED_BYTE,
        expect.any(Uint8Array)
      );
    });
  });

  describe("pixel region capture", () => {
    it("returns safe fallbacks before initialization", () => {
      expect(renderingEngine.requestPixelRegion(1, 20, 30)).toBe(false);
      expect(renderingEngine.collectPixelRegionResults()).toEqual([]);
      expect(() => renderingEngine.cancelPixelRegionRequests()).not.toThrow();
    });

    it("delegates region requests and collected results to the capturer", () => {
      const result: PixelRegionResult = {
        requestId: 3,
        centerX: 20,
        centerY: 30,
        width: 60,
        height: 60,
        rgba: new Uint8ClampedArray(60 * 60 * 4),
      };
      const capturer = {
        queue: vi.fn(() => true),
        collectResults: vi.fn(() => [result]),
        cancelPendingCaptures: vi.fn(),
        dispose: vi.fn(),
      };
      Object.defineProperty(renderingEngine, "pixelRegionCapturer", {
        value: capturer,
        writable: true,
        configurable: true,
      });

      expect(renderingEngine.requestPixelRegion(3, 20, 30)).toBe(true);
      expect(renderingEngine.collectPixelRegionResults()).toEqual([result]);
      renderingEngine.cancelPixelRegionRequests();

      expect(capturer.queue).toHaveBeenCalledWith({ requestId: 3, centerX: 20, centerY: 30 });
      expect(capturer.collectResults).toHaveBeenCalledOnce();
      expect(capturer.cancelPendingCaptures).toHaveBeenCalledOnce();
    });

    it("cancels region requests during cleanup", () => {
      const capturer = { cancelPendingCaptures: vi.fn() };
      Object.defineProperty(renderingEngine, "pixelRegionCapturer", {
        value: capturer,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(renderingEngine, "shaderPipeline", {
        value: { cleanup: vi.fn() },
        writable: true,
        configurable: true,
      });

      renderingEngine.cleanup();

      expect(capturer.cancelPendingCaptures).toHaveBeenCalledOnce();
    });
  });

  describe("resetTime", () => {
    it("should delegate to shaderPipeline.resetTime", () => {
      const mockPipeline = {
        resetTime: vi.fn(),
      };
      const mockCamera = { reset: vi.fn() };
      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'cameraManager', {
        value: mockCamera, writable: true, configurable: true,
      });

      renderingEngine.resetTime();

      expect(mockPipeline.resetTime).toHaveBeenCalledTimes(1);
      expect(mockCamera.reset).toHaveBeenCalledTimes(1);
    });
  });

  describe("audio sync on compilation", () => {
    let mockPipeline: any;
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
        setCustomUniformManager: vi.fn(),
      };
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should not resume audio on successful compilation (audio only plays on reset)", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(7.5);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      // Audio should NOT be resumed or synced on compilation
      expect(mockResourceManager.resumeAllAudio).not.toHaveBeenCalled();
      expect(mockResourceManager.syncAllAudioToTime).not.toHaveBeenCalled();
      expect(mockResourceManager.pauseAllAudio).not.toHaveBeenCalled();
    });

    it("should not touch audio on successful compilation when paused", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(3.0);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      // Audio should NOT be touched on compilation regardless of pause state
      expect(mockResourceManager.resumeAllAudio).not.toHaveBeenCalled();
      expect(mockResourceManager.syncAllAudioToTime).not.toHaveBeenCalled();
      expect(mockResourceManager.pauseAllAudio).not.toHaveBeenCalled();
    });

    it("should leave audio untouched on failed compilation", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: false, error: "syntax error" });

      await renderingEngine.compileShaderPipeline("bad code", null, "test.glsl", {});

      expect(mockResourceManager.pauseAllAudio).not.toHaveBeenCalled();
      expect(mockResourceManager.syncAllAudioToTime).not.toHaveBeenCalled();
      expect(mockResourceManager.resumeAllAudio).not.toHaveBeenCalled();
    });

    it("should compile without threading audio options into shaderPipeline.compileShaderPipeline", async () => {
      mockPipeline.compileShaderPipeline.mockResolvedValue({ success: true });
      mockTimeManager.isPaused.mockReturnValue(false);

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockPipeline.compileShaderPipeline).toHaveBeenCalledWith(
        "void mainImage() {}",
        null,
        "test.glsl",
        {},
      );
    });
  });

  describe("audio sync on togglePause", () => {
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should sync audio and pause it when pausing shader", () => {
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(10.0);

      renderingEngine.togglePause();

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(10.0);
      expect(mockResourceManager.pauseAllAudio).toHaveBeenCalled();
      expect(mockResourceManager.resumeAllAudio).not.toHaveBeenCalled();
    });

    it("should sync audio and resume it when unpausing shader", () => {
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(2.0);

      renderingEngine.togglePause();

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(2.0);
      expect(mockResourceManager.resumeAllAudio).toHaveBeenCalled();
      expect(mockResourceManager.pauseAllAudio).not.toHaveBeenCalled();
    });
  });

  describe("audio pause/resume distinction on togglePause", () => {
    let mockResourceManager: any;
    let mockTimeManager: any;

    beforeEach(() => {
      mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
        syncAllAudioToTime: vi.fn(),
        pauseAllAudio: vi.fn(),
        resumeAllAudio: vi.fn(),
        muteAllAudio: vi.fn(),
        unmuteAllAudio: vi.fn(),
      };
      mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(5.0),
        isPaused: vi.fn().mockReturnValue(false),
        togglePause: vi.fn(),
      };

      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });

      vi.clearAllMocks();
    });

    it("should use pauseAll (not pauseAudio) so userPaused is not set", () => {
      mockTimeManager.isPaused.mockReturnValue(false);
      renderingEngine.togglePause();

      expect(mockResourceManager.pauseAllAudio).toHaveBeenCalled();
    });

    it("should use resumeAll (not forceResumeAll) so user-paused audio stays paused", () => {
      mockTimeManager.isPaused.mockReturnValue(true);
      renderingEngine.togglePause();

      expect(mockResourceManager.resumeAllAudio).toHaveBeenCalled();
    });

    it("pause → unpause cycle syncs audio time both ways", () => {
      // Pause
      mockTimeManager.isPaused.mockReturnValue(false);
      mockTimeManager.getCurrentTime.mockReturnValue(10.0);
      renderingEngine.togglePause();

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(10.0);

      vi.clearAllMocks();

      // Unpause
      mockTimeManager.isPaused.mockReturnValue(true);
      mockTimeManager.getCurrentTime.mockReturnValue(10.0);
      renderingEngine.togglePause();

      expect(mockResourceManager.syncAllAudioToTime).toHaveBeenCalledWith(10.0);
      expect(mockResourceManager.resumeAllAudio).toHaveBeenCalled();
    });
  });

  describe("resumeAudioContext", () => {
    it("should delegate to resourceManager.resumeAudioContext", async () => {
      const mockResourceManager = {
        resumeAudioContext: vi.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      await renderingEngine.resumeAudioContext();

      expect(mockResourceManager.resumeAudioContext).toHaveBeenCalledTimes(1);
    });
  });

  describe("resumeAllAudio", () => {
    it("should resume audio without clearing user-paused state", () => {
      const mockResourceManager = {
        resumeAllAudio: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.resumeAllAudio();

      expect(mockResourceManager.resumeAllAudio).toHaveBeenCalledTimes(1);
    });
  });

  describe("resumeAllVideos", () => {
    it("should resume all videos via resourceManager", () => {
      const mockResourceManager = {
        resumeAllVideos: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.resumeAllVideos();

      expect(mockResourceManager.resumeAllVideos).toHaveBeenCalledTimes(1);
    });
  });

  describe("releaseMediaResetHold", () => {
    it("should release reset video hold without resuming videos", async () => {
      const mockPipeline = {
        compileShaderPipeline: vi.fn().mockResolvedValue({ success: true }),
        setCustomUniformManager: vi.fn(),
        resetTime: vi.fn(),
        getPasses: vi.fn(() => []),
      };
      const mockResourceManager = {
        syncAllVideosToTime: vi.fn(),
        pauseAllVideos: vi.fn(),
        resumeAllVideos: vi.fn(),
      };
      const mockTimeManager = {
        getCurrentTime: vi.fn().mockReturnValue(0),
        isPaused: vi.fn().mockReturnValue(false),
      };
      Object.defineProperty(renderingEngine, 'shaderPipeline', {
        value: mockPipeline, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'timeManager', {
        value: mockTimeManager, writable: true, configurable: true,
      });
      Object.defineProperty(renderingEngine, 'cameraManager', {
        value: { reset: vi.fn() }, writable: true, configurable: true,
      });

      renderingEngine.resetTime();
      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});
      renderingEngine.releaseMediaResetHold();
      mockResourceManager.pauseAllVideos.mockClear();
      mockResourceManager.resumeAllVideos.mockClear();

      await renderingEngine.compileShaderPipeline("void mainImage() {}", null, "test.glsl", {});

      expect(mockResourceManager.pauseAllVideos).not.toHaveBeenCalled();
      expect(mockResourceManager.resumeAllVideos).toHaveBeenCalledTimes(1);
    });
  });

  describe("controlVideo", () => {
    let mockResourceManager: any;

    beforeEach(() => {
      mockResourceManager = {
        controlVideo: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
    });

    it("should delegate play action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "play");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "play");
    });

    it("should delegate pause action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "pause");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "pause");
    });

    it("should delegate mute action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "mute");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "mute");
    });

    it("should delegate unmute action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "unmute");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "unmute");
    });

    it("should delegate reset action to resourceManager", () => {
      renderingEngine.controlVideo("video.mp4", "reset");
      expect(mockResourceManager.controlVideo).toHaveBeenCalledWith("video.mp4", "reset");
    });
  });

  describe("getVideoState", () => {
    it("should delegate to resourceManager.getVideoState", () => {
      const mockState = { paused: false, muted: true, currentTime: 5.0, duration: 120.0 };
      const mockResourceManager = {
        getVideoState: vi.fn().mockReturnValue(mockState),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getVideoState("video.mp4");

      expect(mockResourceManager.getVideoState).toHaveBeenCalledWith("video.mp4");
      expect(result).toEqual(mockState);
    });

    it("should return null when video is not found", () => {
      const mockResourceManager = {
        getVideoState: vi.fn().mockReturnValue(null),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getVideoState("nonexistent.mp4");
      expect(result).toBeNull();
    });
  });

  describe("controlAudio", () => {
    let mockResourceManager: any;

    beforeEach(() => {
      mockResourceManager = {
        controlAudio: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });
    });

    it("should delegate play action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "play");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "play");
    });

    it("should delegate pause action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "pause");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "pause");
    });

    it("should delegate mute action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "mute");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "mute");
    });

    it("should delegate unmute action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "unmute");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "unmute");
    });

    it("should delegate reset action to resourceManager", () => {
      renderingEngine.controlAudio("music.mp3", "reset");
      expect(mockResourceManager.controlAudio).toHaveBeenCalledWith("music.mp3", "reset");
    });
  });

  describe("getAudioState", () => {
    it("should delegate to resourceManager.getAudioState", () => {
      const mockState = { paused: false, muted: false, currentTime: 10.0, duration: 200.0 };
      const mockResourceManager = {
        getAudioState: vi.fn().mockReturnValue(mockState),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioState("music.mp3");

      expect(mockResourceManager.getAudioState).toHaveBeenCalledWith("music.mp3");
      expect(result).toEqual(mockState);
    });

    it("should return null when audio is not found", () => {
      const mockResourceManager = {
        getAudioState: vi.fn().mockReturnValue(null),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioState("nonexistent.mp3");
      expect(result).toBeNull();
    });
  });

  describe("seekAudio", () => {
    it("should delegate to resourceManager.seekAudio", () => {
      const mockResourceManager = {
        seekAudio: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.seekAudio("music.mp3", 15.5);

      expect(mockResourceManager.seekAudio).toHaveBeenCalledWith("music.mp3", 15.5);
    });
  });

  describe("updateAudioLoopRegion", () => {
    it("should delegate to resourceManager.updateAudioLoopRegion with both times", () => {
      const mockResourceManager = {
        updateAudioLoopRegion: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.updateAudioLoopRegion("music.mp3", 5.0, 30.0);

      expect(mockResourceManager.updateAudioLoopRegion).toHaveBeenCalledWith("music.mp3", 5.0, 30.0);
    });

    it("should delegate with undefined times", () => {
      const mockResourceManager = {
        updateAudioLoopRegion: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      renderingEngine.updateAudioLoopRegion("music.mp3");

      expect(mockResourceManager.updateAudioLoopRegion).toHaveBeenCalledWith("music.mp3", undefined, undefined);
    });
  });

  describe("getAudioFFTData", () => {
    it("should return FFT data for audio type with path", () => {
      const mockFFTData = new Uint8Array([10, 20, 30]);
      const mockResourceManager = {
        getAudioFFTData: vi.fn().mockReturnValue(mockFFTData),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioFFTData("audio", "music.mp3");

      expect(mockResourceManager.getAudioFFTData).toHaveBeenCalledWith("music.mp3");
      expect(result).toBe(mockFFTData);
    });

    it("should return null for non-audio type", () => {
      const mockResourceManager = {
        getAudioFFTData: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioFFTData("video");

      expect(mockResourceManager.getAudioFFTData).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("should return null for audio type without path", () => {
      const mockResourceManager = {
        getAudioFFTData: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceManager, writable: true, configurable: true,
      });

      const result = renderingEngine.getAudioFFTData("audio");

      expect(mockResourceManager.getAudioFFTData).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe("setGlobalVolume", () => {
    it("should propagate global mute state", () => {
      const mockResourceMgr = {
        setGlobalAudioState: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceMgr, writable: true, configurable: true,
      });

      renderingEngine.setGlobalVolume(0.8, true);

      expect(mockResourceMgr.setGlobalAudioState).toHaveBeenCalledWith(0.8, true);
    });

    it("should propagate global unmute state", () => {
      const mockResourceMgr = {
        setGlobalAudioState: vi.fn(),
      };
      Object.defineProperty(renderingEngine, 'resourceManager', {
        value: mockResourceMgr, writable: true, configurable: true,
      });

      renderingEngine.setGlobalVolume(0.8, false);

      expect(mockResourceMgr.setGlobalAudioState).toHaveBeenCalledWith(0.8, false);
    });
  });

  describe("frame time history delegation", () => {
    it("should delegate getFrameTimeHistory to FrameRenderer", () => {
      const mockHistory = [16.5, 16.7, 16.6];
      mockFrameRenderer.getFrameTimeHistory = vi.fn().mockReturnValue(mockHistory);

      const result = renderingEngine.getFrameTimeHistory();

      expect(mockFrameRenderer.getFrameTimeHistory).toHaveBeenCalledOnce();
      expect(result).toBe(mockHistory);
    });

    it("should return empty array when FrameRenderer returns empty", () => {
      mockFrameRenderer.getFrameTimeHistory = vi.fn().mockReturnValue([]);

      expect(renderingEngine.getFrameTimeHistory()).toEqual([]);
    });
  });

  describe("gpu frame time history delegation", () => {
    it("should delegate getGpuFrameTimeHistory to FrameRenderer", () => {
      const mockHistory = [12.5, 47.1];
      mockFrameRenderer.getGpuFrameTimeHistory = vi.fn().mockReturnValue(mockHistory);

      const result = renderingEngine.getGpuFrameTimeHistory();

      expect(mockFrameRenderer.getGpuFrameTimeHistory).toHaveBeenCalledOnce();
      expect(result).toBe(mockHistory);
    });

    it("should return empty array when FrameRenderer returns empty", () => {
      mockFrameRenderer.getGpuFrameTimeHistory = vi.fn().mockReturnValue([]);

      expect(renderingEngine.getGpuFrameTimeHistory()).toEqual([]);
    });

  });


  describe("frame time count delegation", () => {
    it("should delegate getFrameTimeCount to FrameRenderer", () => {
      mockFrameRenderer.getFrameTimeCount = vi.fn().mockReturnValue(500);

      const result = renderingEngine.getFrameTimeCount();

      expect(mockFrameRenderer.getFrameTimeCount).toHaveBeenCalledOnce();
      expect(result).toBe(500);
    });

    it("should return 0 when FrameRenderer returns 0", () => {
      mockFrameRenderer.getFrameTimeCount = vi.fn().mockReturnValue(0);

      expect(renderingEngine.getFrameTimeCount()).toBe(0);
    });

    it("should return count greater than history length when capped", () => {
      mockFrameRenderer.getFrameTimeHistory = vi.fn().mockReturnValue(
        Array.from({ length: 3600 }, () => 16.6)
      );
      mockFrameRenderer.getFrameTimeCount = vi.fn().mockReturnValue(5000);

      const history = renderingEngine.getFrameTimeHistory();
      const count = renderingEngine.getFrameTimeCount();

      expect(history).toHaveLength(3600);
      expect(count).toBe(5000);
      expect(count).toBeGreaterThan(history.length);
    });
  });

  describe("render() running state preservation", () => {
    beforeEach(() => {
      mockFrameRenderer.isRunning = vi.fn();
      mockFrameRenderer.setRunning = vi.fn();
      mockFrameRenderer.render = vi.fn();
    });

    it("should not set running to false when loop is already running", () => {
      // Simulate main RAF loop already running
      mockFrameRenderer.isRunning.mockReturnValue(true);

      renderingEngine.render(performance.now());

      // Collect all setRunning calls
      const calls = mockFrameRenderer.setRunning.mock.calls.map((c: [boolean]) => c[0]);
      // Must not end with false — that would kill the RAF loop
      expect(calls[calls.length - 1]).not.toBe(false);
    });

    it("should restore false running state after one-shot render when loop was stopped", () => {
      // Simulate loop stopped (e.g. before first startRenderLoop call)
      mockFrameRenderer.isRunning.mockReturnValue(false);

      renderingEngine.render(performance.now());

      const calls = mockFrameRenderer.setRunning.mock.calls.map((c: [boolean]) => c[0]);
      // Should restore to false after the one-shot render
      expect(calls[calls.length - 1]).toBe(false);
    });
  });

  describe("dispose()", () => {
    it("continues input and pipeline teardown after an earlier stage throws", () => {
      const stopError = new Error("stop failed");
      const bufferManager = { dispose: vi.fn() };
      const frameRenderer = { stopRenderLoop: vi.fn(() => {
        throw stopError;
      }) };
      const cameraManager = { dispose: vi.fn() };
      const mouseManager = { dispose: vi.fn() };
      const keyboardManager = { dispose: vi.fn() };
      const shaderPipeline = { dispose: vi.fn() };
      Object.assign(renderingEngine as any, {
        bufferManager,
        frameRenderer,
        cameraManager,
        mouseManager,
        keyboardManager,
        shaderPipeline,
      });

      expect(() => renderingEngine.dispose()).toThrow(stopError);
      expect(bufferManager.dispose).toHaveBeenCalledOnce();
      expect(cameraManager.dispose).toHaveBeenCalledOnce();
      expect(mouseManager.dispose).toHaveBeenCalledOnce();
      expect(keyboardManager.dispose).toHaveBeenCalledOnce();
      expect(shaderPipeline.dispose).toHaveBeenCalledOnce();
    });

    it("clears the post-image callback and disposes region capture before renderer resources", () => {
      const calls: string[] = [];
      const capturer = { dispose: vi.fn(() => calls.push("capturer")) };
      const frameRenderer = {
        setPostImageCallback: vi.fn(() => calls.push("callback")),
        stopRenderLoop: vi.fn(() => calls.push("frame")),
      };
      Object.assign(renderingEngine as any, {
        pixelRegionCapturer: capturer,
        frameRenderer,
        bufferManager: { dispose: vi.fn(() => calls.push("buffers")) },
        cameraManager: { dispose: vi.fn() },
        mouseManager: { dispose: vi.fn() },
        keyboardManager: { dispose: vi.fn() },
        shaderPipeline: { dispose: vi.fn() },
      });

      renderingEngine.dispose();

      expect(frameRenderer.setPostImageCallback).toHaveBeenCalledWith(null);
      expect(calls).toEqual(["callback", "capturer", "buffers", "frame"]);
    });
  });
});
