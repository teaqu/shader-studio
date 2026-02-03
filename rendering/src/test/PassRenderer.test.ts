import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassRenderer } from "../PassRenderer";
import type { PiRenderer, PiShader, PiTexture } from "../types/piRenderer";
import type { Pass } from "../models";

const createMockRenderer = () => ({
  CreateTexture: vi.fn(),
  SetShader: vi.fn(),
  SetShaderConstant1F: vi.fn(),
  SetShaderConstant1I: vi.fn(),
  SetShaderConstant3FV: vi.fn(),
  SetShaderConstant4FV: vi.fn(),
  SetShaderTextureUnit: vi.fn(),
  DrawUnitQuad: vi.fn(),
  SetViewport: vi.fn(),
  SetRenderTarget: vi.fn(),
  AttachShader: vi.fn(),
  AttachTextures: vi.fn(),
  GetAttribLocation: vi.fn(),
  DrawUnitQuad_XY: vi.fn(),
}) as unknown as PiRenderer;

const createMockTexture = (xres = 0, yres = 0) => ({
  mXres: xres,
  mYres: yres
}) as PiTexture;

const createMockShader = () => ({}) as PiShader;

const createMockResourceManager = () => ({
  getKeyboardTexture: vi.fn(),
  getDefaultTexture: vi.fn().mockReturnValue(createMockTexture(1, 1)),
  updateKeyboardTexture: vi.fn(),
  getImageTextureCache: vi.fn(),
  getVideoTexture: vi.fn(),
});

const createMockBufferManager = () => ({
  getPassBuffers: vi.fn(),
});

const createMockKeyboardManager = () => ({
  getKeyHeld: vi.fn(),
  getKeyPressed: vi.fn(),
  getKeyToggled: vi.fn(),
});

describe("PassRenderer", () => {
  let passRenderer: PassRenderer;
  let mockRenderer: ReturnType<typeof createMockRenderer>;
  let mockResourceManager: ReturnType<typeof createMockResourceManager>;
  let mockBufferManager: ReturnType<typeof createMockBufferManager>;
  let mockKeyboardManager: ReturnType<typeof createMockKeyboardManager>;
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    mockResourceManager = createMockResourceManager();
    mockBufferManager = createMockBufferManager();
    mockKeyboardManager = createMockKeyboardManager();
    mockCanvas = {} as HTMLCanvasElement;
    passRenderer = new PassRenderer(
      mockCanvas,
      mockResourceManager as any,
      mockBufferManager as any,
      mockRenderer,
      mockKeyboardManager as any
    );
  });

  describe("renderPass", () => {
    it("should not render when shader is null", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      passRenderer.renderPass(passConfig, null, null, {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      });

      // Should not call any renderer methods when shader is null
      expect(mockRenderer.SetViewport).not.toHaveBeenCalled();
      expect(mockRenderer.SetRenderTarget).not.toHaveBeenCalled();
      expect(mockRenderer.AttachShader).not.toHaveBeenCalled();
    });

    it("should render pass with valid shader and no inputs", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      const mockShader = createMockShader();
      const mockTarget = {
        mTex0: { mXres: 800, mYres: 600 }
      } as any;

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, mockTarget, mockShader, uniforms);

      expect(mockRenderer.SetViewport).toHaveBeenCalledWith([0, 0, 800, 600]);
      expect(mockRenderer.SetRenderTarget).toHaveBeenCalledWith(mockTarget);
      expect(mockRenderer.AttachShader).toHaveBeenCalledWith(mockShader);
      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith("iResolution", uniforms.res);
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iTime", uniforms.time);
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iTimeDelta", uniforms.timeDelta);
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iFrameRate", uniforms.frameRate);
      expect(mockRenderer.SetShaderConstant4FV).toHaveBeenCalledWith("iMouse", uniforms.mouse);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iFrame", uniforms.frame);
      expect(mockRenderer.SetShaderConstant4FV).toHaveBeenCalledWith("iDate", uniforms.date);
      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture()
      );
    });

    it("should use canvas dimensions when no render target is provided", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      mockCanvas.width = 1024;
      mockCanvas.height = 768;
      const mockShader = createMockShader();

      const uniforms = {
        res: [1024, 768, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetViewport).toHaveBeenCalledWith([0, 0, 1024, 768]);
      expect(mockRenderer.SetRenderTarget).toHaveBeenCalledWith(null);
    });

    it("should handle keyboard input correctly", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "keyboard" }
        }
      };

      const mockShader = createMockShader();
      const mockKeyboardTexture = createMockTexture();
      mockResourceManager.getKeyboardTexture.mockReturnValue(mockKeyboardTexture);

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        mockKeyboardTexture,
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture()
      );
      expect(mockResourceManager.getKeyboardTexture).toHaveBeenCalledTimes(1);
    });

    it("should handle buffer input correctly", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "buffer", source: "BufferA" }
        }
      };

      const mockShader = createMockShader();
      const mockBuffer = {
        front: { mTex0: createMockTexture() },
        back: { mTex0: createMockTexture() }
      };

      mockBufferManager.getPassBuffers.mockReturnValue({
        BufferA: mockBuffer
      });

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        mockBuffer.front.mTex0,
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture()
      );
    });

    it("should use default texture for invalid buffer sources (including 'common')", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "buffer", source: "common" },
          iChannel1: { type: "buffer", source: "NonExistent" }
        }
      };

      const mockShader = createMockShader();
      mockBufferManager.getPassBuffers.mockReturnValue({});

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      const defaultTexture = mockResourceManager.getDefaultTexture();
      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        defaultTexture, // common should use default texture
        defaultTexture, // NonExistent should use default texture
        defaultTexture,
        defaultTexture
      );
      expect(mockResourceManager.getDefaultTexture).toHaveBeenCalledTimes(2);
    });

    it("should handle video input correctly", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "video", path: "video.mp4" }
        }
      };

      const mockShader = createMockShader();
      const mockVideoTexture = createMockTexture();
      mockResourceManager.getVideoTexture.mockReturnValue(mockVideoTexture);

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("video.mp4");
      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        mockVideoTexture,
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture(),
        mockResourceManager.getDefaultTexture()
      );
    });

    it("should use default texture when video texture is not found", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "video", path: "missing.mp4" }
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getVideoTexture.mockReturnValue(null);

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("missing.mp4");
      const defaultTexture = mockResourceManager.getDefaultTexture();
      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        defaultTexture,
        defaultTexture,
        defaultTexture,
        defaultTexture
      );
    });

    it("should handle multiple video inputs on different channels", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "video", path: "video1.mp4" },
          iChannel2: { type: "video", path: "video2.mp4" }
        }
      };

      const mockShader = createMockShader();
      const mockVideoTexture1 = createMockTexture();
      const mockVideoTexture2 = createMockTexture();
      mockResourceManager.getVideoTexture
        .mockReturnValueOnce(mockVideoTexture1)
        .mockReturnValueOnce(mockVideoTexture2);

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("video1.mp4");
      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("video2.mp4");
      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        mockVideoTexture1,
        mockResourceManager.getDefaultTexture(),
        mockVideoTexture2,
        mockResourceManager.getDefaultTexture()
      );
    });

    it("should handle mixed texture and video inputs", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "image.jpg" },
          iChannel1: { type: "video", path: "video.mp4" },
          iChannel2: { type: "keyboard" }
        }
      };

      const mockShader = createMockShader();
      const mockImageTexture = createMockTexture();
      const mockVideoTexture = createMockTexture();
      const mockKeyboardTexture = createMockTexture();
      
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "image.jpg": mockImageTexture
      });
      mockResourceManager.getVideoTexture.mockReturnValue(mockVideoTexture);
      mockResourceManager.getKeyboardTexture.mockReturnValue(mockKeyboardTexture);

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.AttachTextures).toHaveBeenCalledWith(
        4,
        mockImageTexture,
        mockVideoTexture,
        mockKeyboardTexture,
        mockResourceManager.getDefaultTexture()
      );
    });

    it("should not call getVideoTexture when video input has no path", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "video" } as any // No path
        }
      };

      const mockShader = createMockShader();

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockResourceManager.getVideoTexture).not.toHaveBeenCalled();
    });
  });

  describe("iChannelResolution", () => {
    it("should set iChannelResolution with all zeros when no inputs", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      const mockShader = createMockShader();
      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      );
    });

    it("should set iChannelResolution with texture dimensions", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "image.jpg" }
        }
      };

      const mockShader = createMockShader();
      const mockImageTexture = createMockTexture(512, 256);

      mockResourceManager.getImageTextureCache.mockReturnValue({
        "image.jpg": mockImageTexture
      });

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [512, 256, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      );
    });

    it("should set iChannelResolution with keyboard dimensions (256x3)", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "keyboard" }
        }
      };

      const mockShader = createMockShader();
      const mockKeyboardTexture = createMockTexture(256, 3);
      mockResourceManager.getKeyboardTexture.mockReturnValue(mockKeyboardTexture);

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [256, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      );
    });

    it("should set iChannelResolution with video dimensions", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "video", path: "video.mp4" }
        }
      };

      const mockShader = createMockShader();
      const mockVideoTexture = createMockTexture(1920, 1080);
      mockResourceManager.getVideoTexture.mockReturnValue(mockVideoTexture);

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [1920, 1080, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      );
    });

    it("should set iChannelResolution with buffer dimensions", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "buffer", source: "BufferA" }
        }
      };

      const mockShader = createMockShader();
      const bufferTexture = createMockTexture(800, 600);
      const mockBuffer = {
        front: { mTex0: bufferTexture },
        back: { mTex0: createMockTexture(800, 600) }
      };

      mockBufferManager.getPassBuffers.mockReturnValue({
        BufferA: mockBuffer
      });

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [800, 600, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      );
    });

    it("should set iChannelResolution with multiple channel dimensions", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "image.jpg" },
          iChannel1: { type: "video", path: "video.mp4" },
          iChannel2: { type: "keyboard" },
          iChannel3: { type: "buffer", source: "BufferA" }
        }
      };

      const mockShader = createMockShader();
      const mockImageTexture = createMockTexture(512, 256);
      const mockVideoTexture = createMockTexture(1920, 1080);
      const mockKeyboardTexture = createMockTexture(256, 3);
      const bufferTexture = createMockTexture(800, 600);

      mockResourceManager.getImageTextureCache.mockReturnValue({
        "image.jpg": mockImageTexture
      });
      mockResourceManager.getVideoTexture.mockReturnValue(mockVideoTexture);
      mockResourceManager.getKeyboardTexture.mockReturnValue(mockKeyboardTexture);
      mockBufferManager.getPassBuffers.mockReturnValue({
        BufferA: {
          front: { mTex0: bufferTexture },
          back: { mTex0: createMockTexture(800, 600) }
        }
      });

      const uniforms = {
        res: [800, 600, 1],
        time: 1.0,
        timeDelta: 0.016,
        frameRate: 60,
        mouse: [0, 0, 0, 0],
        frame: 1,
        date: [2023, 1, 1, 0]
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [512, 256, 1, 1920, 1080, 1, 256, 3, 1, 800, 600, 1]
      );
    });
  });
});