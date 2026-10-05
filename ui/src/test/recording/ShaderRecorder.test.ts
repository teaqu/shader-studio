import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
const { mockFinalizeLiveMp4 } = vi.hoisted(() => ({ mockFinalizeLiveMp4: vi.fn() }));
vi.mock('../../lib/recording/finalizeLiveMp4', () => ({ finalizeLiveMp4: mockFinalizeLiveMp4 }));
const { mockCreateLiveVideoCapture } = vi.hoisted(() => ({ mockCreateLiveVideoCapture: vi.fn() }));
vi.mock('../../lib/recording/LiveVideoCapture', () => ({ createLiveVideoCapture: mockCreateLiveVideoCapture }));

// Polyfill ImageData for jsdom (used by GIF recording path)
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? (data.length / (4 * width));
    }
  };
}

// Mock recordingStore
const mockStartRecording = vi.fn();
const mockStartPreparing = vi.fn();
const mockUpdatePreparation = vi.fn();
const mockStartLiveRecording = vi.fn();
const mockUpdateProgress = vi.fn();
const mockSetFinalizing = vi.fn();
const mockReset = vi.fn();
const mockSetPreviewCanvas = vi.fn();

vi.mock('../../lib/stores/recordingStore', () => ({
  recordingStore: {
    startRecording: (...args: any[]) => mockStartRecording(...args),
    startPreparing: (...args: any[]) => mockStartPreparing(...args),
    updatePreparation: (...args: any[]) => mockUpdatePreparation(...args),
    startLiveRecording: (...args: any[]) => mockStartLiveRecording(...args),
    updateProgress: (...args: any[]) => mockUpdateProgress(...args),
    setFinalizing: () => mockSetFinalizing(),
    reset: () => mockReset(),
    setPreviewCanvas: (...args: any[]) => mockSetPreviewCanvas(...args),
  },
}));

// Mock GifEncoder
const mockGifAddFrame = vi.fn();
const mockGifFinish = vi.fn(() => Promise.resolve(new Uint8Array([71, 73, 70]))); // "GIF"
const mockGifCancel = vi.fn();

vi.mock('../../lib/recording/GifEncoder', () => ({
  assertGifMemoryBudget: vi.fn(),
  GifEncoderWrapper: vi.fn(function () {
    return ({
      addFrame: mockGifAddFrame,
      finish: mockGifFinish,
      cancel: mockGifCancel,
    });
  }),
}));

// Mock VideoEncoder
const mockVideoAddFrame = vi.fn();
const mockVideoFinish = vi.fn(() => Promise.resolve(new Blob(['video'], { type: 'video/webm' })));

const { mockVideoSupportedBitrate, mockVideoClose } = vi.hoisted(() => ({
  mockVideoSupportedBitrate: vi.fn(() => Promise.resolve(12_000_000)),
  mockVideoClose: vi.fn(),
}));

vi.mock('../../lib/recording/VideoEncoder', () => ({
  automaticVideoBitrate: vi.fn(() => 5_000_000),
  VideoEncoderWrapper: Object.assign(vi.fn(function () {
    return ({
      addFrame: mockVideoAddFrame,
      finish: mockVideoFinish,
      close: mockVideoClose,
    });
  }), { supportedBitrate: mockVideoSupportedBitrate }),
}));

// Mock RenderingEngine
const mockInitialize = vi.fn();
const mockHandleCanvasResize = vi.fn();
const mockCompileShaderPipeline = vi.fn(() => Promise.resolve({ success: true }));
const mockSetCustomUniformValues = vi.fn();
const mockRenderForCapture = vi.fn();
const mockDispose = vi.fn();
const mockSetTime = vi.fn();
const mockSetFrame = vi.fn();
const mockSetDeltaTime = vi.fn();
const mockGetTimeManager = vi.fn(() => ({
  setTime: mockSetTime,
  setFrame: mockSetFrame,
  setDeltaTime: mockSetDeltaTime,
}));
const mockWebGPUInitialize = vi.fn();
const mockWebGPUHandleCanvasResize = vi.fn();
const mockWebGPUCompileShaderPipeline = vi.fn(() => Promise.resolve({ success: true }));
const mockWebGPUSetCustomUniformValues = vi.fn();
const mockWebGPURenderForCapture = vi.fn();
const mockWebGPUCaptureCurrentFrame = vi.fn(async () => new ImageData(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64));
const mockWebGPUDispose = vi.fn();
const mockGetSlangAssetUrls = vi.fn(() => ({ scriptUrl: '/mock/slang-wasm.js', wasmUrl: '/mock/slang-wasm.wasm' }));

vi.mock('../../../../rendering/src/webgl/RenderingEngine', () => ({
  RenderingEngine: vi.fn(function () {
    return ({
      initialize: mockInitialize,
      handleCanvasResize: mockHandleCanvasResize,
      compileShaderPipeline: mockCompileShaderPipeline,
      setCustomUniformValues: mockSetCustomUniformValues,
      renderForCapture: mockRenderForCapture,
      dispose: mockDispose,
      getTimeManager: mockGetTimeManager,
    });
  }),
}));

vi.mock('../../../../rendering/src/webgpu/WebGPURenderingEngine', () => ({
  WebGPURenderingEngine: vi.fn(function () {
    return ({
      initialize: mockWebGPUInitialize,
      handleCanvasResize: mockWebGPUHandleCanvasResize,
      compileShaderPipeline: mockWebGPUCompileShaderPipeline,
      setCustomUniformValues: mockWebGPUSetCustomUniformValues,
      renderForCapture: mockWebGPURenderForCapture,
      captureCurrentFrame: mockWebGPUCaptureCurrentFrame,
      dispose: mockWebGPUDispose,
      getTimeManager: mockGetTimeManager,
    });
  }),
}));

vi.mock('../../lib/slangAssets', () => ({
  getSlangAssetUrls: () => mockGetSlangAssetUrls(),
}));

import { ShaderRecorder, type RecordingConfig, type ShaderInfo, type ScreenshotConfig } from '../../lib/recording/ShaderRecorder';
import { setGlobalViewerCamera } from '../../lib/state/viewerCameraState.svelte';
import { VideoEncoderWrapper } from '../../lib/recording/VideoEncoder';
import { GifEncoderWrapper } from '../../lib/recording/GifEncoder';

const shaderInfo: ShaderInfo = {
  code: 'void mainImage(out vec4 o, in vec2 uv) { o = vec4(1.0); }',
  config: null,
  path: '/test/shader.glsl',
  buffers: {},
};

const slangShaderInfo: ShaderInfo = {
  code: 'float4 mainImage(float2 uv) { return float4(1.0); }',
  config: null,
  path: '/test/shader.slang',
  buffers: {},
  language: 'slang',
};

const shaderInfoWithCaptureContext: ShaderInfo = {
  ...shaderInfo,
  config: { version: '1', passes: { Image: { resolution: { scale: 1 } } } },
  buffers: { BufferA: 'void mainImage(out vec4 o, in vec2 uv) { o = vec4(0.0); }' },
  customUniformDeclarations: 'uniform float uGain;\nuniform bool uEnabled;',
  customUniformInfo: [
    { name: 'uGain', type: 'float' },
    { name: 'uEnabled', type: 'bool' },
  ],
  customUniformValues: [
    { name: 'uGain', type: 'float', value: 0 },
    { name: 'uEnabled', type: 'bool', value: false },
  ],
};

const slangShaderInfoWithCaptureContext: ShaderInfo = {
  ...slangShaderInfo,
  slangModules: [{
    moduleName: 'palette',
    path: '/test/palette.slang',
    source: 'export float3 color() { return float3(1, 0, 0); }',
    ownerPass: 'Image',
  }],
  slangSourcePath: '/test/shader.slang',
  slangSourcePaths: {
    Image: '/test/shader.slang',
    BufferA: '/test/buffer-a.slang',
  },
  customUniformDeclarations: 'float uGain;',
  customUniformInfo: [{ name: 'uGain', type: 'float' }],
  customUniformValues: [{ name: 'uGain', type: 'float', value: [0.25, 0.5] }],
};

const wgslShaderInfoWithCaptureContext: ShaderInfo = {
  code: '@fragment fn mainImage() -> @location(0) vec4f { return vec4f(uGain); }',
  config: null,
  path: '/test/shader.wgsl',
  buffers: {},
  language: 'wgsl',
  slangSourcePath: '/test/shader.wgsl',
  slangSourcePaths: { Image: '/test/shader.wgsl' },
  customUniformDeclarations: 'var<private> uGain: f32;',
  customUniformInfo: [{ name: 'uGain', type: 'float' }],
  customUniformValues: [{ name: 'uGain', type: 'float', value: 0.5 }],
};

describe('ShaderRecorder', () => {
  let recorder: ShaderRecorder;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    recorder = new ShaderRecorder();
    setGlobalViewerCamera(true);
    // Mock document.createElement to return a canvas-like object
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      style: { position: '', left: '', top: '', pointerEvents: '' },
      remove: vi.fn(),
      getContext: vi.fn(() => ({
        readPixels: vi.fn(),
        putImageData: vi.fn(),
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
      })),
      toBlob: vi.fn((_cb: any, _type: string, _quality?: number) => {
        _cb(new Blob(['image'], { type: 'image/png' }));
      }),
    } as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
  });

  afterEach(() => {
    setGlobalViewerCamera(true);
    vi.useRealTimers();
  });

  it.each([
    { format: 'png' as const, language: 'glsl' as const },
    { format: 'webm' as const, language: 'glsl' as const },
    { format: 'gif' as const, language: 'glsl' as const },
    { format: 'png' as const, language: 'wgsl' as const },
    { format: 'webm' as const, language: 'wgsl' as const },
    { format: 'gif' as const, language: 'wgsl' as const },
    { format: 'png' as const, language: 'slang' as const },
    { format: 'webm' as const, language: 'slang' as const },
    { format: 'gif' as const, language: 'slang' as const },
  ])(
    'preserves the runtime camera preference and frozen uniforms for $language $format exports',
    async ({ format, language }) => {
      setGlobalViewerCamera(false);
      const info = { ...structuredClone(shaderInfoWithCaptureContext), language };
      const compile = language === 'glsl' ? mockCompileShaderPipeline : mockWebGPUCompileShaderPipeline;
      const setUniforms = language === 'glsl' ? mockSetCustomUniformValues : mockWebGPUSetCustomUniformValues;
      const capture = format === 'png'
        ? recorder.captureScreenshot({ format, width: 64, height: 64 }, info)
        : recorder.record({ format, width: 64, height: 64, fps: 1, duration: 1, startTime: 0 }, info);
      await vi.runAllTimersAsync();
      await capture;
      expect(compile).toHaveBeenCalledWith(
        info.code,
        { ...info.config, webgpu: { useViewerCamera: false } },
        info.path,
        info.buffers,
        info.customUniformDeclarations,
        info.customUniformInfo,
      );
      expect(setUniforms).toHaveBeenCalledWith(info.customUniformValues);
      expect(info.config).not.toHaveProperty('webgpu');
    },
  );

  describe('captureScreenshot', () => {
    it('captures Live pixels through the owning engine without compiling or advancing simulation', async () => {
      const image = new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
      const liveEngine = {
        captureCurrentFrame: vi.fn().mockResolvedValue(image),
      } as unknown as import('../../../../rendering/src/types/RenderingEngine').RenderingEngine;

      const blob = await recorder.captureLiveScreenshot(
        { mode: 'live', format: 'png', width: 800, height: 600 },
        liveEngine,
      );

      expect(liveEngine.captureCurrentFrame).toHaveBeenCalledTimes(1);
      expect(mockCompileShaderPipeline).not.toHaveBeenCalled();
      expect(mockRenderForCapture).not.toHaveBeenCalled();
      expect(mockSetTime).not.toHaveBeenCalled();
      expect(blob).toBeInstanceOf(Blob);
    });

    it('should create offscreen engine at requested resolution', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 1920, height: 1080 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockInitialize).toHaveBeenCalledWith(expect.anything(), true);
      expect(mockHandleCanvasResize).toHaveBeenCalledWith(1920, 1080);
    });

    it('should compile shader pipeline', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockCompileShaderPipeline).toHaveBeenCalledWith(
        shaderInfo.code,
        shaderInfo.config,
        shaderInfo.path,
        shaderInfo.buffers,
      );
      expect(mockSetCustomUniformValues).toHaveBeenCalledWith([]);
    });

    it('compiles and initializes a frozen custom-uniform snapshot before the screenshot frame', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      const pendingCompile = Promise.withResolvers<{ success: true }>();
      mockCompileShaderPipeline.mockReturnValueOnce(pendingCompile.promise);
      const captureInfo = structuredClone(shaderInfoWithCaptureContext);

      const capture = recorder.captureScreenshot(config, captureInfo);
      captureInfo.config!.passes.Image.resolution!.scale = 2;
      captureInfo.buffers.BufferA = 'changed';
      captureInfo.customUniformInfo![0].name = 'changed';
      captureInfo.customUniformValues![0].value = 1;
      pendingCompile.resolve({ success: true });
      await capture;

      expect(mockCompileShaderPipeline).toHaveBeenCalledWith(
        shaderInfo.code,
        { version: '1', passes: { Image: { resolution: { scale: 1 } } } },
        shaderInfo.path,
        { BufferA: 'void mainImage(out vec4 o, in vec2 uv) { o = vec4(0.0); }' },
        'uniform float uGain;\nuniform bool uEnabled;',
        [
          { name: 'uGain', type: 'float' },
          { name: 'uEnabled', type: 'bool' },
        ],
      );
      expect(mockSetCustomUniformValues).toHaveBeenCalledWith([
        { name: 'uGain', type: 'float', value: 0 },
        { name: 'uEnabled', type: 'bool', value: false },
      ]);
      expect(mockSetCustomUniformValues.mock.invocationCallOrder[0])
        .toBeLessThan(mockRenderForCapture.mock.invocationCallOrder[0]);
    });

    it('should use a WebGPU offscreen engine for Slang screenshots', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };

      await recorder.captureScreenshot(config, slangShaderInfo);

      expect(mockGetSlangAssetUrls).toHaveBeenCalled();
      expect(mockInitialize).not.toHaveBeenCalled();
      expect(mockWebGPUInitialize).toHaveBeenCalledWith(expect.anything(), true);
      expect(mockWebGPUHandleCanvasResize).toHaveBeenCalledWith(800, 600);
      expect(mockWebGPUCompileShaderPipeline).toHaveBeenCalledWith(
        slangShaderInfo.code,
        slangShaderInfo.config,
        slangShaderInfo.path,
        slangShaderInfo.buffers,
      );
      expect(mockWebGPURenderForCapture).toHaveBeenCalled();
    });

    it('passes frozen Slang module and per-pass source context to WebGPU capture', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };

      await recorder.captureScreenshot(config, slangShaderInfoWithCaptureContext);

      expect(mockWebGPUCompileShaderPipeline).toHaveBeenCalledWith(
        slangShaderInfo.code,
        slangShaderInfo.config,
        slangShaderInfo.path,
        slangShaderInfo.buffers,
        'float uGain;',
        [{ name: 'uGain', type: 'float' }],
        [{
          moduleName: 'palette',
          path: '/test/palette.slang',
          source: 'export float3 color() { return float3(1, 0, 0); }',
          ownerPass: 'Image',
        }],
        '/test/shader.slang',
        {
          Image: '/test/shader.slang',
          BufferA: '/test/buffer-a.slang',
        },
      );
      expect(mockWebGPUSetCustomUniformValues).toHaveBeenCalledWith([
        { name: 'uGain', type: 'float', value: [0.25, 0.5] },
      ]);
    });

    it('passes WGSL source paths and custom uniforms to WebGPU capture', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };

      await recorder.captureScreenshot(config, wgslShaderInfoWithCaptureContext);

      expect(mockWebGPUCompileShaderPipeline).toHaveBeenCalledWith(
        wgslShaderInfoWithCaptureContext.code,
        null,
        '/test/shader.wgsl',
        {},
        'var<private> uGain: f32;',
        [{ name: 'uGain', type: 'float' }],
        undefined,
        '/test/shader.wgsl',
        { Image: '/test/shader.wgsl' },
      );
      expect(mockWebGPUSetCustomUniformValues).toHaveBeenCalledWith([
        { name: 'uGain', type: 'float', value: 0.5 },
      ]);
    });

    it('should render at specified time', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600, time: 5.0 };
      const capture = recorder.captureScreenshot(config, shaderInfo);
      await vi.runAllTimersAsync();
      await capture;

      expect(mockSetTime).toHaveBeenCalledWith(5.0);
      expect(mockRenderForCapture).toHaveBeenCalled();
    });

    it('prepares preceding screenshot frames at 60 fps without duplicating the target frame', async () => {
      const steps: Array<{ time: number; frame: number; delta: number }> = [];
      mockRenderForCapture.mockImplementation(() => {
        steps.push({
          time: mockSetTime.mock.calls.at(-1)![0],
          frame: mockSetFrame.mock.calls.at(-1)![0],
          delta: mockSetDeltaTime.mock.calls.at(-1)![0],
        });
      });

      await recorder.captureScreenshot(
        { format: 'png', width: 800, height: 600, time: 0.025 },
        shaderInfo,
      );

      expect(steps).toHaveLength(3);
      expect(steps[0]).toEqual({ time: 0, frame: 0, delta: 0 });
      expect(steps[1].time).toBeCloseTo(1 / 60);
      expect(steps[1].frame).toBe(1);
      expect(steps[1].delta).toBeCloseTo(1 / 60);
      expect(steps[2].time).toBe(0.025);
      expect(steps[2].frame).toBe(2);
      expect(steps[2].delta).toBeCloseTo(0.025 - (1 / 60));
    });

    it('should default to time 0 when no time specified', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockSetTime).toHaveBeenCalledWith(0);
    });

    it('should dispose offscreen engine after capture', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockDispose).toHaveBeenCalled();
      expect(mockSetPreviewCanvas).toHaveBeenCalledWith(null);
    });

    it('should dispose offscreen engine even on error', async () => {
      mockCompileShaderPipeline.mockResolvedValueOnce({ success: false, errors: ['bad shader'] } as any);
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };

      await expect(recorder.captureScreenshot(config, shaderInfo)).rejects.toThrow('Shader compilation failed');
      expect(mockSetCustomUniformValues).not.toHaveBeenCalled();
      expect(mockRenderForCapture).not.toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
    });

    it('should return a Blob', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      const blob = await recorder.captureScreenshot(config, shaderInfo);
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe('record', () => {
    const baseConfig: RecordingConfig = {
      format: 'webm',
      duration: 0.1,
      startTime: 0,
      fps: 10,
      width: 800,
      height: 600,
    };

    async function rec(config: RecordingConfig, info = shaderInfo) {
      const p = recorder.record(config, info);
      await vi.runAllTimersAsync();
      return p;
    }

    it('should create offscreen engine and compile shader', async () => {
      await rec(baseConfig);

      expect(mockInitialize).toHaveBeenCalledWith(expect.anything(), true);
      expect(mockCompileShaderPipeline).toHaveBeenCalled();
    });

    it.each(['webm', 'gif'] as const)(
      'applies custom-uniform values before the first %s frame',
      async (format) => {
        await rec({ ...baseConfig, format }, shaderInfoWithCaptureContext);

        expect(mockSetCustomUniformValues).toHaveBeenCalledWith([
          { name: 'uGain', type: 'float', value: 0 },
          { name: 'uEnabled', type: 'bool', value: false },
        ]);
        expect(mockSetCustomUniformValues.mock.invocationCallOrder[0])
          .toBeLessThan(mockRenderForCapture.mock.invocationCallOrder[0]);
      },
    );

    it('should set preview canvas for live preview', async () => {
      await rec(baseConfig);

      expect(mockSetPreviewCanvas).toHaveBeenCalledWith(expect.anything());
    });

    it('should start recording in store with correct format and frame count', async () => {
      await rec({ ...baseConfig, format: 'mp4', duration: 5, fps: 30 });

      // 5 seconds * 30 fps = 150 frames (Math.ceil)
      expect(mockStartRecording).toHaveBeenCalledWith('mp4', 150);
    });

    it('should round dimensions to even numbers for MP4', async () => {
      await rec({ ...baseConfig, format: 'mp4', width: 801, height: 601 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(802, 602);
    });

    it('reports the saved size when MP4 dimensions are rounded to even numbers', async () => {
      const odd = recorder.record({ format: 'mp4', duration: 0.1, startTime: 0, fps: 10, width: 801, height: 601 }, shaderInfo);
      await vi.runAllTimersAsync();
      await odd;
      expect(recorder.consumeOutputNotice()).toBe(
        'Saved at 802 × 602: MP4 needs even dimensions, so 801 × 601 was rounded up.',
      );
      expect(recorder.consumeOutputNotice()).toBeNull();

      const even = recorder.record({ format: 'mp4', duration: 0.1, startTime: 0, fps: 10, width: 800, height: 600 }, shaderInfo);
      await vi.runAllTimersAsync();
      await even;
      expect(recorder.consumeOutputNotice()).toBeNull();
    });

    it('should not round dimensions for WebM', async () => {
      await rec({ ...baseConfig, format: 'webm', width: 801, height: 601 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(801, 601);
    });

    it('should not round even dimensions for MP4', async () => {
      await rec({ ...baseConfig, format: 'mp4', width: 1920, height: 1080 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(1920, 1080);
    });

    it('should not round dimensions for GIF', async () => {
      await rec({ ...baseConfig, format: 'gif', width: 801, height: 601 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(801, 601);
    });

    it('should use VideoEncoderWrapper for webm format', async () => {
      await rec({ ...baseConfig, format: 'webm' });
      expect(VideoEncoderWrapper).toHaveBeenCalled();
      expect(GifEncoderWrapper).not.toHaveBeenCalled();
    });

    it('should use VideoEncoderWrapper for mp4 format', async () => {
      await rec({ ...baseConfig, format: 'mp4' });
      expect(VideoEncoderWrapper).toHaveBeenCalled();
      expect(GifEncoderWrapper).not.toHaveBeenCalled();
    });

    it('should use GifEncoderWrapper for gif format', async () => {
      await rec({ ...baseConfig, format: 'gif' });
      expect(GifEncoderWrapper).toHaveBeenCalled();
      expect(VideoEncoderWrapper).not.toHaveBeenCalled();
    });

    it('omits the gifski repeat option for infinite looping', async () => {
      await rec({ ...baseConfig, format: 'gif', loopCount: 0 });
      expect(GifEncoderWrapper).toHaveBeenCalledWith(expect.objectContaining({ repeat: undefined }));
    });

    it('passes repeat zero to gifski for a GIF that plays once', async () => {
      await rec({ ...baseConfig, format: 'gif', loopCount: -1 });
      expect(GifEncoderWrapper).toHaveBeenCalledWith(expect.objectContaining({ repeat: 0 }));
    });

    it('should use a WebGPU offscreen engine for Slang videos', async () => {
      const p = recorder.record(baseConfig, slangShaderInfo);
      await vi.runAllTimersAsync();
      await p;

      expect(mockGetSlangAssetUrls).toHaveBeenCalled();
      expect(mockInitialize).not.toHaveBeenCalled();
      expect(mockWebGPUInitialize).toHaveBeenCalledWith(expect.anything(), true);
      expect(mockWebGPUCompileShaderPipeline).toHaveBeenCalledWith(
        slangShaderInfo.code,
        slangShaderInfo.config,
        slangShaderInfo.path,
        slangShaderInfo.buffers,
      );
      expect(mockWebGPURenderForCapture).toHaveBeenCalled();
      expect(mockWebGPUDispose).toHaveBeenCalled();
    });

    it.each(['webm', 'gif'] as const)('reads stable GPU pixels for each saved %s frame', async (format) => {
      const p = recorder.record({ ...baseConfig, format, width: 64, height: 64, duration: 0.1, fps: 30, startTime: 0 }, slangShaderInfo);
      await vi.runAllTimersAsync();
      await p;
      expect(mockWebGPUCaptureCurrentFrame).toHaveBeenCalledTimes(3);
      if (format === 'gif') {
        expect(mockGifAddFrame).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8ClampedArray) }));
        expect(mockGifAddFrame.mock.calls[0][0].data[0]).toBe(255);
      } else {
        const canvas = mockVideoAddFrame.mock.calls[0][0] as HTMLCanvasElement;
        const contexts = vi.mocked(canvas.getContext).mock.results.map(result => result.value);
        expect(contexts.some(context => vi.mocked(context.putImageData).mock.calls.length === 3)).toBe(true);
      }
    });

    it.each(['webm', 'gif'] as const)(
      'passes the complete Slang snapshot to %s recording',
      async (format) => {
        const p = recorder.record({ ...baseConfig, format }, slangShaderInfoWithCaptureContext);
        await vi.runAllTimersAsync();
        await p;

        expect(mockWebGPUCompileShaderPipeline).toHaveBeenCalledWith(
          slangShaderInfo.code,
          slangShaderInfo.config,
          slangShaderInfo.path,
          slangShaderInfo.buffers,
          'float uGain;',
          [{ name: 'uGain', type: 'float' }],
          [{
            moduleName: 'palette',
            path: '/test/palette.slang',
            source: 'export float3 color() { return float3(1, 0, 0); }',
            ownerPass: 'Image',
          }],
          '/test/shader.slang',
          {
            Image: '/test/shader.slang',
            BufferA: '/test/buffer-a.slang',
          },
        );
        expect(mockWebGPUSetCustomUniformValues).toHaveBeenCalledWith([
          { name: 'uGain', type: 'float', value: [0.25, 0.5] },
        ]);
      },
    );

    it('should render correct number of frames', async () => {
      await rec({ ...baseConfig, duration: 1, fps: 10 });

      // 1 second * 10 fps = 10 frames
      expect(mockRenderForCapture).toHaveBeenCalledTimes(10);
    });

    it('should set correct time for each frame during video recording', async () => {
      await rec({ ...baseConfig, duration: 0.1, fps: 10, startTime: 5.0 });

      // 1 frame: time = 5.0 + 0 * 0.1 = 5.0
      expect(mockSetTime).toHaveBeenCalledWith(5.0);
    });

    it.each(['webm', 'gif'] as const)(
      'warms feedback before an off-grid %s start and keeps frame numbering continuous',
      async (format) => {
        const steps: Array<{ time: number; frame: number; delta: number }> = [];
        mockRenderForCapture.mockImplementation(() => {
          steps.push({
            time: mockSetTime.mock.calls.at(-1)![0],
            frame: mockSetFrame.mock.calls.at(-1)![0],
            delta: mockSetDeltaTime.mock.calls.at(-1)![0],
          });
        });

        await rec({
          ...baseConfig,
          format,
          startTime: 0.25,
          duration: 0.2,
          fps: 10,
        });

        expect(steps).toHaveLength(5);
        expect(steps.slice(0, 3)).toEqual([
          { time: 0, frame: 0, delta: 0 },
          { time: 0.1, frame: 1, delta: 0.1 },
          { time: 0.2, frame: 2, delta: 0.1 },
        ]);
        expect(mockStartPreparing).toHaveBeenCalledWith(format, 2, 3);
        expect(mockUpdatePreparation).toHaveBeenLastCalledWith(3, 3);
        expect(mockStartPreparing.mock.invocationCallOrder[0])
          .toBeLessThan(mockStartRecording.mock.invocationCallOrder[0]);
        expect(steps[3].time).toBe(0.25);
        expect(steps[3].frame).toBe(3);
        expect(steps[3].delta).toBeCloseTo(0.05);
        expect(steps[4]).toEqual({ time: 0.35, frame: 4, delta: 0.1 });

        if (format === 'webm') {
          expect(mockVideoAddFrame).toHaveBeenCalledTimes(2);
          expect(mockVideoAddFrame.mock.calls.map((call) => call[1])).toEqual([0, 100_000]);
        } else {
          expect(mockGifAddFrame).toHaveBeenCalledTimes(2);
        }
      },
    );

    it('cancels during preparation before creating encoded output', async () => {
      mockRenderForCapture.mockImplementationOnce(() => recorder.cancel());
      const promise = recorder.record({
        ...baseConfig,
        startTime: 1,
        duration: 0.2,
        fps: 10,
      }, shaderInfo);
      promise.catch(() => {});
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Recording cancelled');
      expect(mockVideoAddFrame).not.toHaveBeenCalled();
      expect(mockVideoFinish).not.toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
    });

    it('should update progress during recording', async () => {
      await rec({ ...baseConfig, duration: 0.5, fps: 10 });

      // 5 frames, progress updated each frame
      expect(mockUpdateProgress).toHaveBeenCalledTimes(5);
      expect(mockUpdateProgress).toHaveBeenLastCalledWith(5, 5);
    });

    it('should set finalizing state before finishing', async () => {
      await rec(baseConfig);
      expect(mockSetFinalizing).toHaveBeenCalled();
    });

    it('waits for frame backpressure before rendering the next frame', async () => {
      vi.useRealTimers();
      let ready!: () => void;
      mockVideoAddFrame.mockImplementationOnce(() => new Promise<void>(resolve => {
        ready = resolve;
      }));
      const pending = recorder.record({ ...baseConfig, duration: 1, fps: 30 }, shaderInfo);
      await vi.waitFor(() => expect(mockVideoAddFrame).toHaveBeenCalledOnce());
      const rendered = mockRenderForCapture.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockRenderForCapture).toHaveBeenCalledTimes(rendered);
      expect(mockUpdateProgress).not.toHaveBeenCalled();
      ready();
      await pending;
      expect(mockVideoAddFrame).toHaveBeenCalledTimes(30);
      expect(mockUpdateProgress).toHaveBeenCalledTimes(30);
    });

    it('should dispose offscreen engine after recording', async () => {
      await rec(baseConfig);

      expect(mockDispose).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
      expect(mockSetPreviewCanvas).toHaveBeenCalledWith(null);
    });

    it('should dispose offscreen engine on compilation error', async () => {
      mockCompileShaderPipeline.mockResolvedValueOnce({ success: false, errors: ['error'] } as any);

      await expect(recorder.record(baseConfig, shaderInfo)).rejects.toThrow('Shader compilation failed');
      expect(mockDispose).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
    });

    it('should return a Blob', async () => {
      const blob = await rec(baseConfig);
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe('Live video', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('uses completed frame readback for direct MP4 samples from WebGL', async () => {
      const { stream, MockMediaRecorder } = installMediaRecorder();
      MockMediaRecorder.isTypeSupported.mockReturnValue(true);
      vi.stubGlobal('VideoEncoder', class {});
      const blob = new Blob(['quality']);
      mockCreateLiveVideoCapture.mockResolvedValueOnce({ result: Promise.resolve(blob), stop: vi.fn() });
      const canvas = { width: 816, height: 458, captureStream: () => stream, getContext: vi.fn(() => null) };
      const engine = { getCanvas: () => canvas, captureCurrentFrame: vi.fn(async () => new ImageData(816, 458)) };
      await expect((recorder as any).recordLive({ mode: 'live', format: 'mp4', duration: 5, startTime: 0, fps: 60, width: 816, height: 458 }, engine)).resolves.toBe(blob);
      const argumentsUsed = mockCreateLiveVideoCapture.mock.calls.at(-1)!;
      expect(argumentsUsed).toHaveLength(5);
      await argumentsUsed[4]();
      expect(engine.captureCurrentFrame).toHaveBeenCalledOnce();
    });
    it.each([true, false])('uses stable frame capture only for a WebGPU canvas (%s)', async webgpu => {
      const { stream, MockMediaRecorder } = installMediaRecorder();
      MockMediaRecorder.isTypeSupported.mockReturnValue(true);
      vi.stubGlobal('VideoEncoder', class {});
      const blob = new Blob(['quality']);
      mockCreateLiveVideoCapture.mockResolvedValueOnce({ result: Promise.resolve(blob), stop: vi.fn() });
      const canvas = { width: 816, height: 458, captureStream: () => stream, getContext: vi.fn(() => webgpu ? {} : null) };
      const engine = { getCanvas: () => canvas, captureCurrentFrame: vi.fn(async () => new ImageData(816, 458)) };
      await expect((recorder as any).recordLive({ mode: 'live', format: 'webm', duration: 5, startTime: 0, fps: 60, width: 816, height: 458 }, engine)).resolves.toBe(blob);
      expect(canvas.getContext).toHaveBeenCalledWith('webgpu');
      const argumentsUsed = mockCreateLiveVideoCapture.mock.calls.at(-1)!;
      if (webgpu) {
        expect(argumentsUsed).toHaveLength(5);
        await argumentsUsed[4]();
        expect(engine.captureCurrentFrame).toHaveBeenCalledOnce();
      } else {
        expect(argumentsUsed).toHaveLength(4);
        expect(engine.captureCurrentFrame).not.toHaveBeenCalled();
      }
    });
    it.each(['mp4', 'webm'])('uses quality-controlled Live %s when WebCodecs is available', async format => {
      const { stream, MockMediaRecorder } = installMediaRecorder();
      MockMediaRecorder.isTypeSupported.mockReturnValue(true);
      vi.stubGlobal('VideoEncoder', class {});
      const blob = new Blob(['quality'], { type: `video/${format}` });
      let finish!: (blob: Blob) => void;
      const stop = vi.fn(() => finish(blob));
      mockCreateLiveVideoCapture.mockResolvedValueOnce({ result: new Promise<Blob>(resolve => {
        finish = resolve;
      }), stop });
      const canvas = { width: 815, height: 459, captureStream: () => stream };
      const recording = (recorder as any).recordLive({ mode: 'live', format, duration: 5, startTime: 0, fps: 60, width: 815, height: 459 }, { getCanvas: () => canvas });
      await Promise.resolve();
      (recorder as any).stopLiveRecording();
      expect(await recording).toBe(blob);
      expect(mockCreateLiveVideoCapture).toHaveBeenCalledWith(canvas, 60, format, expect.any(AbortSignal));
      expect(mockStartLiveRecording).toHaveBeenCalledWith(format);
      expect(stop).toHaveBeenCalledOnce();
      expect(recorder.consumeOutputNotice()).toBe(format === 'mp4' ? 'MP4 dimensions were rounded up to even pixels for video encoding.' : null);
    });

    it('honours Stop while the quality encoder is still initializing', async () => {
      const { MockMediaRecorder } = installMediaRecorder();
      MockMediaRecorder.isTypeSupported.mockReturnValue(true);
      vi.stubGlobal('VideoEncoder', class {});
      let ready!: (capture: { result: Promise<Blob>; stop: ReturnType<typeof vi.fn> }) => void;
      mockCreateLiveVideoCapture.mockImplementationOnce(() => new Promise(resolve => {
        ready = resolve;
      }));
      const blob = new Blob(['quality']);
      let finish!: (blob: Blob) => void;
      const result = new Promise<Blob>(resolve => {
        finish = resolve;
      });
      const stop = vi.fn(() => finish(blob));
      const recording = (recorder as any).recordLive({ mode: 'live', format: 'mp4', duration: 1, startTime: 0, fps: 30, width: 800, height: 600 },
        { getCanvas: () => ({ width: 800, height: 600, captureStream: vi.fn() }) });
      (recorder as any).stopLiveRecording();
      ready({ result, stop });
      expect(await recording).toBe(blob);
      expect(stop).toHaveBeenCalledOnce();
    });
    it('finalizes MP4 before saving and prevents a second recording during finalization', async () => {
      const { stream, MockMediaRecorder } = installMediaRecorder();
      MockMediaRecorder.isTypeSupported.mockReturnValue(true);
      const canvas = { width: 800, height: 600, captureStream: vi.fn(() => stream) } as any;
      const config = { mode: 'live', format: 'mp4', duration: 5, startTime: 0, fps: 30, width: 800, height: 600 };
      let finish!: (blob: Blob) => void;
      mockFinalizeLiveMp4.mockImplementationOnce(() => new Promise<Blob>(resolve => {
        finish = resolve;
      }));
      const recording = (recorder as any).recordLive(config, { getCanvas: () => canvas });
      (recorder as any).stopLiveRecording();
      expect(mockFinalizeLiveMp4).toHaveBeenCalledWith(expect.any(Blob), expect.any(AbortSignal));
      await expect((recorder as any).recordLive(config, { getCanvas: () => canvas })).rejects.toThrow('already active');
      const indexed = new Blob(['indexed'], { type: 'video/mp4' });
      finish(indexed);
      expect(await recording).toBe(indexed);
    });

    it('aborts MP4 finalization when the recording is discarded', async () => {
      const { stream, MockMediaRecorder } = installMediaRecorder();
      MockMediaRecorder.isTypeSupported.mockReturnValue(true);
      mockFinalizeLiveMp4.mockImplementationOnce((_blob: Blob, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      const recording = (recorder as any).recordLive({ mode: 'live', format: 'mp4', duration: 5, startTime: 0, fps: 30, width: 800, height: 600 },
        { getCanvas: () => ({ width: 800, height: 600, captureStream: () => stream }) });
      (recorder as any).stopLiveRecording();
      recorder.cancel();
      await expect(recording).rejects.toThrow('Recording cancelled');
    });
    function installMediaRecorder() {
      const tracks = [{ stop: vi.fn() }];
      const stream = { getTracks: () => tracks } as unknown as MediaStream;
      const instances: Array<{
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        state: RecordingState;
        ondataavailable: ((event: BlobEvent) => void) | null;
        onstop: (() => void) | null;
        onerror: ((event: Event) => void) | null;
      }> = [];
      class MockMediaRecorder {
        static isTypeSupported = vi.fn((type: string) => type === 'video/webm;codecs=vp9');
        state: RecordingState = 'inactive';
        mimeType = 'video/webm;codecs=vp9';
        ondataavailable: ((event: BlobEvent) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        start = vi.fn(() => {
          this.state = 'recording';
        });
        stop = vi.fn(() => {
          this.state = 'inactive';
          this.ondataavailable?.({ data: new Blob(['video']) } as BlobEvent);
          this.onstop?.();
        });
        constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
          instances.push(this);
        }
      }
      vi.stubGlobal('MediaRecorder', MockMediaRecorder);
      return { tracks, stream, instances, MockMediaRecorder };
    }

    it('records the existing canvas without compiling or rendering another engine', async () => {
      const { tracks, stream, instances, MockMediaRecorder } = installMediaRecorder();
      const canvas = { width: 800, height: 600, captureStream: vi.fn(() => stream) } as any;
      const liveEngine = { getCanvas: () => canvas } as any;

      const recording = (recorder as any).recordLive({
        mode: 'live', format: 'webm', duration: 5, startTime: 0, fps: 30, width: 800, height: 600,
      }, liveEngine) as Promise<Blob>;

      expect(canvas.captureStream).toHaveBeenCalledWith(30);
      expect(MockMediaRecorder.isTypeSupported).toHaveBeenCalled();
      expect(mockCompileShaderPipeline).not.toHaveBeenCalled();
      expect(mockRenderForCapture).not.toHaveBeenCalled();
      (recorder as any).stopLiveRecording();
      const blob = await recording;

      expect(blob.type).toBe('video/webm;codecs=vp9');
      expect(instances[0].stop).toHaveBeenCalledTimes(1);
      expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    });

    it('fails visibly instead of saving an empty file when the canvas delivered no frames', async () => {
      const { tracks, stream, instances } = installMediaRecorder();
      const canvas = { width: 800, height: 600, captureStream: vi.fn(() => stream) } as any;
      const recording = (recorder as any).recordLive({
        mode: 'live', format: 'webm', duration: 5, startTime: 0, fps: 30, width: 800, height: 600,
      }, { getCanvas: () => canvas }) as Promise<Blob>;
      recording.catch(() => {});
      // A canvas whose GPU context was lost never produces a frame; MediaRecorder
      // then hands back a single empty chunk on stop.
      instances[0].stop = vi.fn(() => {
        instances[0].state = 'inactive';
        instances[0].ondataavailable?.({ data: new Blob([]) } as BlobEvent);
        instances[0].onstop?.();
      });

      (recorder as any).stopLiveRecording();

      await expect(recording).rejects.toThrow('Live recording captured no frames');
      expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    });

    it('rejects unsupported Live formats without opening a stream', async () => {
      const { stream, MockMediaRecorder } = installMediaRecorder();
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);
      const canvas = { width: 800, height: 600, captureStream: vi.fn(() => stream) } as any;

      await expect((recorder as any).recordLive({
        mode: 'live', format: 'mp4', duration: 5, startTime: 0, fps: 30, width: 800, height: 600,
      }, { getCanvas: () => canvas })).rejects.toThrow('not supported');
      expect(canvas.captureStream).not.toHaveBeenCalled();
    });

    it('discards a Live recording and releases every track', async () => {
      const { tracks, stream } = installMediaRecorder();
      const canvas = { width: 800, height: 600, captureStream: vi.fn(() => stream) } as any;
      const recording = (recorder as any).recordLive({
        mode: 'live', format: 'webm', duration: 5, startTime: 0, fps: 30, width: 800, height: 600,
      }, { getCanvas: () => canvas }) as Promise<Blob>;
      recording.catch(() => {});

      recorder.cancel();

      await expect(recording).rejects.toThrow('Recording cancelled');
      expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('gif recording without a WebGL context', () => {
    const gifConfig: RecordingConfig = {
      format: 'gif',
      duration: 0.1,
      startTime: 0,
      fps: 10,
      width: 800,
      height: 600,
    };

    it('captures frames through a 2D canvas copy when webgl2 is unavailable', async () => {
      // The legacy WebGL path also supports canvases exposed through a 2D copy.
      const drawImage = vi.fn();
      const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(800 * 600 * 4), width: 800, height: 600 }));
      vi.spyOn(document, 'createElement').mockReturnValue({
        width: 0,
        height: 0,
        style: { position: '', left: '', top: '', pointerEvents: '' },
        remove: vi.fn(),
        getContext: vi.fn((type: string) => (type === '2d' ? { drawImage, getImageData } : null)),
      } as any);

      const p = recorder.record(gifConfig, shaderInfo);
      await vi.runAllTimersAsync();
      await p;

      expect(drawImage).toHaveBeenCalled();
      expect(getImageData).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(mockRenderForCapture).toHaveBeenCalled();
    });

    it('fails with a clear error when neither webgl2 nor 2d contexts are available', async () => {
      vi.spyOn(document, 'createElement').mockReturnValue({
        width: 0,
        height: 0,
        style: { position: '', left: '', top: '', pointerEvents: '' },
        remove: vi.fn(),
        getContext: vi.fn(() => null),
      } as any);

      const p = recorder.record(gifConfig, shaderInfo);
      p.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(p).rejects.toThrow('Failed to capture GIF frame');
      // The offscreen engine is still cleaned up through the finally path.
      expect(mockDispose).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('encodes at the bitrate the host accepted', async () => {
      const p = recorder.record({ format: 'webm', duration: 0.1, startTime: 0, fps: 10, width: 64, height: 64 }, shaderInfo);
      await vi.runAllTimersAsync();
      await p;
      expect(mockVideoSupportedBitrate).toHaveBeenCalledWith({ width: 64, height: 64, fps: 10, format: 'webm' });
      expect(VideoEncoderWrapper).toHaveBeenCalledWith(expect.objectContaining({ bitrate: 12_000_000 }));
    });

    it('rejects an unsupported video configuration before rendering any frame', async () => {
      mockVideoSupportedBitrate.mockRejectedValueOnce(new Error('MP4 export at 800×600, 30 fps is not supported by this host'));
      const config: RecordingConfig = {
        format: 'mp4',
        duration: 1,
        startTime: 5,
        fps: 30,
        width: 800,
        height: 600,
      };

      const p = recorder.record(config, shaderInfo);
      p.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(p).rejects.toThrow('not supported by this host');
      expect(mockRenderForCapture).not.toHaveBeenCalled();
      expect(VideoEncoderWrapper).not.toHaveBeenCalled();
    });

    it('closes the video encoder when rendering is cancelled or fails', async () => {
      let frames = 0;
      mockRenderForCapture.mockImplementation(() => {
        frames++;
        if (frames === 2) {
          recorder.cancel();
        }
      });
      const cancelled = recorder.record({ format: 'webm', duration: 1, startTime: 0, fps: 30, width: 64, height: 64 }, shaderInfo);
      cancelled.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(cancelled).rejects.toThrow('Recording cancelled');
      expect(mockVideoClose).toHaveBeenCalledTimes(1);

      mockVideoClose.mockClear();
      mockRenderForCapture.mockImplementation(() => {});
      mockVideoAddFrame.mockImplementationOnce(() => {
        throw new Error('Video encoding failed');
      });
      const failed = recorder.record({ format: 'webm', duration: 1, startTime: 0, fps: 30, width: 64, height: 64 }, shaderInfo);
      failed.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(failed).rejects.toThrow('Video encoding failed');
      expect(mockVideoClose).toHaveBeenCalledTimes(1);
    });

    it('should stop recording when cancel is called', async () => {
      // We need to test cancellation mid-recording
      // Set up a long recording that we'll cancel during
      let frameCount = 0;
      mockRenderForCapture.mockImplementation(() => {
        frameCount++;
        if (frameCount === 3) {
          recorder.cancel();
        }
      });

      const config: RecordingConfig = {
        format: 'webm',
        duration: 10,
        startTime: 0,
        fps: 30,
        width: 800,
        height: 600,
      };

      const p = recorder.record(config, shaderInfo);
      p.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(p).rejects.toThrow('Recording cancelled');

      // Should have rendered only a few frames before cancellation
      expect(mockRenderForCapture.mock.calls.length).toBeLessThan(300);
    });
  });
});
