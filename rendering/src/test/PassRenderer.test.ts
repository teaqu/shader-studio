import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassRenderer } from "../PassRenderer";
import type { PiRenderer, PiShader, PiTexture } from "../types/piRenderer";
import type { Pass } from "../models";

const createMockRenderer = () => ({
  CreateTexture: vi.fn(),
  SetShader: vi.fn(),
  SetShaderConstant1F: vi.fn(),
  SetShaderConstant1I: vi.fn(),
  SetShaderConstant1FV: vi.fn(),
  SetShaderConstant3F: vi.fn(),
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
  mYres: yres,
  mType: 0,
  mObjectID: {},
}) as PiTexture;

const createMockShader = () => ({}) as PiShader;

const createMockResourceManager = () => ({
  getKeyboardTexture: vi.fn(),
  getDefaultTexture: vi.fn().mockReturnValue(createMockTexture(1, 1)),
  updateKeyboardTexture: vi.fn(),
  getImageTextureCache: vi.fn(),
  getVideoTexture: vi.fn(),
  getAudioTexture: vi.fn(),
  getDesktopAudioTexture: vi.fn(),
});

const createMockBufferManager = () => ({
  getPassBuffers: vi.fn(),
});

const createMockKeyboardManager = () => ({
  getKeyHeld: vi.fn(),
  getKeyPressed: vi.fn(),
  getKeyToggled: vi.fn(),
});

const createMockGl = () => ({
  TEXTURE0: 33984,
  TEXTURE_2D: 3553,
  TEXTURE_3D: 32879,
  TEXTURE_CUBE_MAP: 34067,
  activeTexture: vi.fn(),
  bindTexture: vi.fn(),
});

describe("PassRenderer", () => {
  let passRenderer: PassRenderer;
  let mockRenderer: ReturnType<typeof createMockRenderer>;
  let mockResourceManager: ReturnType<typeof createMockResourceManager>;
  let mockBufferManager: ReturnType<typeof createMockBufferManager>;
  let mockKeyboardManager: ReturnType<typeof createMockKeyboardManager>;
  let mockCanvas: HTMLCanvasElement;
  let mockGl: ReturnType<typeof createMockGl>;

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    mockResourceManager = createMockResourceManager();
    mockBufferManager = createMockBufferManager();
    mockKeyboardManager = createMockKeyboardManager();
    mockGl = createMockGl();
    mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockGl),
    } as unknown as HTMLCanvasElement;
    passRenderer = new PassRenderer(
      mockCanvas,
      mockResourceManager as any,
      mockBufferManager as any,
      mockRenderer,
      mockKeyboardManager as any
    );
  });

  const defaultUniforms = {
    res: [800, 600, 1],
    time: 1.0,
    timeDelta: 0.016,
    frameRate: 60,
    mouse: [0, 0, 0, 0],
    frame: 1,
    date: [2023, 1, 1, 0],
    channelTime: [0, 0, 0, 0],
    sampleRate: 44100,
    channelLoaded: [0, 0, 0, 0]
  };

  describe("renderPass", () => {
    it("should not render when shader is null", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      passRenderer.renderPass(passConfig, null, null, defaultUniforms);

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

      passRenderer.renderPass(passConfig, mockTarget, mockShader, defaultUniforms);

      expect(mockRenderer.SetViewport).toHaveBeenCalledWith([0, 0, 800, 600]);
      expect(mockRenderer.SetRenderTarget).toHaveBeenCalledWith(mockTarget);
      expect(mockRenderer.AttachShader).toHaveBeenCalledWith(mockShader);
      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith("iResolution", defaultUniforms.res);
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iTime", defaultUniforms.time);
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iTimeDelta", defaultUniforms.timeDelta);
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iFrameRate", defaultUniforms.frameRate);
      expect(mockRenderer.SetShaderConstant4FV).toHaveBeenCalledWith("iMouse", defaultUniforms.mouse);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iFrame", defaultUniforms.frame);
      expect(mockRenderer.SetShaderConstant4FV).toHaveBeenCalledWith("iDate", defaultUniforms.date);
      // Textures are bound via WebGL directly, then slot uniforms set
      expect(mockGl.activeTexture).toHaveBeenCalled();
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel1", 1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel2", 2);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel3", 3);
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

      passRenderer.renderPass(passConfig, null, mockShader, {
        ...defaultUniforms,
        res: [1024, 768, 1],
      });

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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.updateKeyboardTexture).toHaveBeenCalled();
      expect(mockResourceManager.getKeyboardTexture).toHaveBeenCalledTimes(1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
    });

    it("should skip keyboard texture update when skipInputUpdates is true", () => {
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms, true);

      expect(mockResourceManager.updateKeyboardTexture).not.toHaveBeenCalled();
      // Should still bind the existing texture
      expect(mockResourceManager.getKeyboardTexture).toHaveBeenCalledTimes(1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // Both slots still get bound via SetShaderTextureUnit
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel1", 1);
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("video.mp4");
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("missing.mp4");
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
    });

    it("should handle multiple video inputs on different channels", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "video", path: "video1.mp4" },
          iChannel1: { type: "video", path: "video2.mp4" }
        }
      };

      const mockShader = createMockShader();
      const mockVideoTexture1 = createMockTexture();
      const mockVideoTexture2 = createMockTexture();
      mockResourceManager.getVideoTexture
        .mockReturnValueOnce(mockVideoTexture1)
        .mockReturnValueOnce(mockVideoTexture2);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("video1.mp4");
      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("video2.mp4");
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel1", 1);
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel1", 1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel2", 2);
    });

    it("should look up texture by resolved_path when available", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "canvas.png", resolved_path: "https://webview-uri/canvas.png" }
        }
      };

      const mockShader = createMockShader();
      const mockImageTexture = createMockTexture(256, 256);

      mockResourceManager.getImageTextureCache.mockReturnValue({
        "https://webview-uri/canvas.png": mockImageTexture
      });

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // Texture should be bound at slot 0 via WebGL
      expect(mockGl.activeTexture).toHaveBeenCalledWith(mockGl.TEXTURE0);
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_2D, mockImageTexture.mObjectID);
    });

    it("should fall back to path when resolved_path is not in cache", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "/absolute/texture.png", resolved_path: "https://missing-uri" }
        }
      };

      const mockShader = createMockShader();
      const mockImageTexture = createMockTexture(128, 128);

      mockResourceManager.getImageTextureCache.mockReturnValue({
        "/absolute/texture.png": mockImageTexture
      });

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockGl.activeTexture).toHaveBeenCalledWith(mockGl.TEXTURE0);
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_2D, mockImageTexture.mObjectID);
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getVideoTexture).not.toHaveBeenCalled();
    });

    it("should bind custom name aliases via SetShaderTextureUnit", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          noiseMap: { type: "texture", path: "noise.png" },
          iChannel1: { type: "keyboard" },
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "noise.png": createMockTexture(512, 512)
      });
      mockResourceManager.getKeyboardTexture.mockReturnValue(createMockTexture(256, 3));

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // Slot uniforms
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel1", 1);
      // Custom alias for noiseMap at slot 0
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("noiseMap", 0);
    });

    it("should handle more than 4 channels", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "a.png" },
          iChannel1: { type: "texture", path: "b.png" },
          iChannel2: { type: "texture", path: "c.png" },
          iChannel3: { type: "texture", path: "d.png" },
          iChannel4: { type: "texture", path: "e.png" },
          iChannel5: { type: "texture", path: "f.png" },
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "a.png": createMockTexture(64, 64),
        "b.png": createMockTexture(64, 64),
        "c.png": createMockTexture(64, 64),
        "d.png": createMockTexture(64, 64),
        "e.png": createMockTexture(64, 64),
        "f.png": createMockTexture(64, 64),
      });

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // All 6 slot uniforms should be bound
      for (let i = 0; i < 6; i++) {
        expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith(`iChannel${i}`, i);
      }
      // 6 texture units should be activated
      expect(mockGl.activeTexture).toHaveBeenCalledTimes(6);
    });

    it("should handle self-referencing buffer (pass reads its own output)", () => {
      const passConfig: Pass = {
        name: "BufferA",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "buffer", source: "BufferA" }
        }
      };

      const mockShader = createMockShader();
      const selfTexture = createMockTexture(800, 600);
      mockBufferManager.getPassBuffers.mockReturnValue({
        BufferA: {
          front: { mTex0: selfTexture },
          back: { mTex0: createMockTexture() }
        }
      });

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // Should bind the front buffer texture
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_2D, selfTexture.mObjectID);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
    });

    it("should still render when gl context is null (no WebGL texture binding)", () => {
      // Create PassRenderer with canvas that returns null for getContext
      const nullGlCanvas = {
        getContext: vi.fn().mockReturnValue(null),
        width: 800,
        height: 600,
      } as unknown as HTMLCanvasElement;

      const nullGlPassRenderer = new PassRenderer(
        nullGlCanvas,
        mockResourceManager as any,
        mockBufferManager as any,
        mockRenderer,
        mockKeyboardManager as any
      );

      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      const mockShader = createMockShader();
      nullGlPassRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // Rendering should still proceed (uniforms set, shader attached)
      expect(mockRenderer.AttachShader).toHaveBeenCalledWith(mockShader);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
      // But WebGL texture binding should not happen (no gl context)
      expect(mockGl.activeTexture).not.toHaveBeenCalled();
    });

    it("should bind multiple custom name aliases correctly", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          colorMap: { type: "texture", path: "color.png" },
          normalMap: { type: "texture", path: "normal.png" },
          iChannel2: { type: "keyboard" },
          heightMap: { type: "texture", path: "height.png" },
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "color.png": createMockTexture(256, 256),
        "normal.png": createMockTexture(256, 256),
        "height.png": createMockTexture(256, 256),
      });
      mockResourceManager.getKeyboardTexture.mockReturnValue(createMockTexture(256, 3));

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // All 4 slot uniforms
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel1", 1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel2", 2);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel3", 3);
      // Custom aliases
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("colorMap", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("normalMap", 1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("heightMap", 3);
      // iChannel2 is at slot 2 so no alias needed — verify no duplicate
    });

    it("should use resolved_path for video textures", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "video", path: "video.mp4", resolved_path: "https://webview-uri/video.mp4" }
        }
      };

      const mockShader = createMockShader();
      const mockVideoTexture = createMockTexture(1920, 1080);
      mockResourceManager.getVideoTexture
        .mockReturnValueOnce(mockVideoTexture) // resolved_path lookup
        .mockReturnValueOnce(null);            // path fallback (not called)

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getVideoTexture).toHaveBeenCalledWith("https://webview-uri/video.mp4");
    });
  });

  describe("iChannelTime uniform", () => {
    it("should set iChannelTime uniform via SetShaderConstant1FV", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      const mockShader = createMockShader();
      const uniforms = {
        ...defaultUniforms,
        channelTime: [1.5, 2.3, 0, 4.1],
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant1FV).toHaveBeenCalledWith(
        "iChannelTime", [1.5, 2.3, 0, 4.1]
      );
    });
  });

  describe("iSampleRate uniform", () => {
    it("should set iSampleRate uniform via SetShaderConstant1F", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      const mockShader = createMockShader();
      const uniforms = {
        ...defaultUniforms,
        sampleRate: 48000,
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith(
        "iSampleRate", 48000
      );
    });

    it("should set default iSampleRate of 44100", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      const mockShader = createMockShader();

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith(
        "iSampleRate", 44100
      );
    });
  });

  describe("iCh struct uniforms", () => {
    it("should set iCh0-iCh3 time, size, and loaded uniforms", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "a.png" },
          iChannel1: { type: "texture", path: "b.png" },
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "a.png": createMockTexture(512, 256),
        "b.png": createMockTexture(128, 64),
      });

      const uniforms = {
        ...defaultUniforms,
        channelTime: [1.0, 2.0, 3.0, 4.0],
        channelLoaded: [1, 1, 0, 0],
      };

      passRenderer.renderPass(passConfig, null, mockShader, uniforms);

      // iCh0
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iCh0.time", 1.0);
      expect(mockRenderer.SetShaderConstant3F).toHaveBeenCalledWith("iCh0.size", 512, 256, 1);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iCh0.loaded", 1);

      // iCh1
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iCh1.time", 2.0);
      expect(mockRenderer.SetShaderConstant3F).toHaveBeenCalledWith("iCh1.size", 128, 64, 1);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iCh1.loaded", 1);

      // iCh2 (no input, default texture 1x1)
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iCh2.time", 3.0);
      expect(mockRenderer.SetShaderConstant3F).toHaveBeenCalledWith("iCh2.size", 1, 1, 1);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iCh2.loaded", 0);

      // iCh3 (no input, default texture 1x1)
      expect(mockRenderer.SetShaderConstant1F).toHaveBeenCalledWith("iCh3.time", 4.0);
      expect(mockRenderer.SetShaderConstant3F).toHaveBeenCalledWith("iCh3.size", 1, 1, 1);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iCh3.loaded", 0);
    });

    it("should set iCh struct with keyboard resolution (256, 3, 1)", () => {
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant3F).toHaveBeenCalledWith("iCh0.size", 256, 3, 1);
    });

    it("should set iCh struct with audio resolution (512, 2, 1)", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "audio", path: "music.mp3" }
        }
      };

      const mockShader = createMockShader();
      const mockAudioTexture = createMockTexture(512, 2);
      mockResourceManager.getAudioTexture.mockReturnValue(mockAudioTexture);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant3F).toHaveBeenCalledWith("iCh0.size", 512, 2, 1);
    });
  });

  describe("audio texture binding", () => {
    it("should bind audio texture when available", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "audio", path: "music.mp3" }
        }
      };

      const mockShader = createMockShader();
      const mockAudioTexture = createMockTexture(512, 2);
      mockResourceManager.getAudioTexture.mockReturnValue(mockAudioTexture);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getAudioTexture).toHaveBeenCalledWith("music.mp3");
      expect(mockGl.activeTexture).toHaveBeenCalledWith(mockGl.TEXTURE0);
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_2D, mockAudioTexture.mObjectID);
    });

    it("should fall back to default texture when audio texture is not found", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "audio", path: "missing.mp3" }
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getAudioTexture.mockReturnValue(null);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getAudioTexture).toHaveBeenCalledWith("missing.mp3");
      // Should still bind default texture
      const defaultTex = mockResourceManager.getDefaultTexture();
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_2D, defaultTex.mObjectID);
    });

    it("should use resolved_path for audio texture lookup when available", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "audio", path: "audio.mp3", resolved_path: "https://webview-uri/audio.mp3" }
        }
      };

      const mockShader = createMockShader();
      const mockAudioTexture = createMockTexture(512, 2);
      mockResourceManager.getAudioTexture
        .mockReturnValueOnce(mockAudioTexture) // resolved_path lookup
        .mockReturnValueOnce(null);            // path fallback (not reached)

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getAudioTexture).toHaveBeenCalledWith("https://webview-uri/audio.mp3");
    });

    it("should not call getAudioTexture when audio input has no path", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "audio" } as any // No path
        }
      };

      const mockShader = createMockShader();

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getAudioTexture).not.toHaveBeenCalled();
    });
  });

  describe("iChannelResolution", () => {
    it("should set iChannelResolution with default texture dimensions when no inputs", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {}
      };

      const mockShader = createMockShader();
      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // 4 default textures (1x1 each)
      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // Slot 0 has 512x256 texture, slots 1-3 have default 1x1
      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [512, 256, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [256, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
      );
    });

    it("should set iChannelResolution with audio special case (512x2)", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "audio", path: "music.mp3" }
        }
      };

      const mockShader = createMockShader();
      const mockAudioTexture = createMockTexture(512, 2);
      mockResourceManager.getAudioTexture.mockReturnValue(mockAudioTexture);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // Audio inputs should use hardcoded 512, 2, 1 resolution
      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [512, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [1920, 1080, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [800, 600, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
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

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [512, 256, 1, 1920, 1080, 1, 256, 3, 1, 800, 600, 1]
      );
    });

    it("should set iChannelResolution for more than 4 channels", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "texture", path: "a.png" },
          iChannel1: { type: "texture", path: "b.png" },
          iChannel2: { type: "texture", path: "c.png" },
          iChannel3: { type: "texture", path: "d.png" },
          iChannel4: { type: "texture", path: "e.png" },
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "a.png": createMockTexture(100, 100),
        "b.png": createMockTexture(200, 200),
        "c.png": createMockTexture(300, 300),
        "d.png": createMockTexture(400, 400),
        "e.png": createMockTexture(500, 500),
      });

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [100, 100, 1, 200, 200, 1, 300, 300, 1, 400, 400, 1, 500, 500, 1]
      );
    });

    it("should set iChannelResolution correctly with custom-named inputs", () => {
      const passConfig: Pass = {
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          noiseMap: { type: "texture", path: "noise.png" },
          iChannel1: { type: "texture", path: "other.png" },
        }
      };

      const mockShader = createMockShader();
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "noise.png": createMockTexture(512, 512),
        "other.png": createMockTexture(256, 128),
      });

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      // noiseMap at slot 0 = 512x512, iChannel1 at slot 1 = 256x128, slots 2-3 = default 1x1
      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith(
        "iChannelResolution[0]",
        [512, 512, 1, 256, 128, 1, 1, 1, 1, 1, 1, 1]
      );
    });
  });
});
