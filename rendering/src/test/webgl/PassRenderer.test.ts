import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassRenderer } from "../../webgl/PassRenderer";
import { OrbitCamera } from "../../preview3d/OrbitCamera";
import type { PiRenderer, PiRenderTarget, PiShader, PiTexture } from "../../types/piRenderer";
import type { Pass } from "../../models";

const createMockRenderer = () => ({
  CLEAR: { Color: 1, Zbuffer: 2 },
  CreateTexture: vi.fn(),
  SetShader: vi.fn(),
  SetShaderConstant1F: vi.fn(),
  SetShaderConstant1I: vi.fn(),
  SetShaderConstant1FV: vi.fn(),
  SetShaderConstant3F: vi.fn(),
  SetShaderConstant3FV: vi.fn(),
  SetShaderConstant4FV: vi.fn(),
  SetShaderConstantMat4F: vi.fn(),
  SetShaderTextureUnit: vi.fn(),
  DrawUnitQuad: vi.fn(),
  SetViewport: vi.fn(),
  SetRenderTarget: vi.fn(),
  AttachShader: vi.fn(),
  AttachTextures: vi.fn(),
  GetAttribLocation: vi.fn(),
  DrawUnitQuad_XY: vi.fn(),
  DrawFullScreenTriangle_XY: vi.fn(),
  DrawPrimitive: vi.fn(),
  PRIMTYPE: { POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5 },
  Clear: vi.fn(),
}) as unknown as PiRenderer;

const createMockTexture = (xres = 0, yres = 0) => ({
  mXres: xres,
  mYres: yres,
  mType: 0,
  mObjectID: {},
}) as PiTexture;

const createMockShader = () => ({ mProgram: null }) as PiShader;

const createMockResourceManager = () => ({
  getKeyboardTexture: vi.fn(),
  getDefaultTexture: vi.fn().mockReturnValue(createMockTexture(1, 1)),
  updateKeyboardTexture: vi.fn(),
  getImageTextureCache: vi.fn(),
  getCubemapTexture: vi.fn(),
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
  createSampler: vi.fn()
    .mockReturnValueOnce({ label: "sampler-0" })
    .mockReturnValueOnce({ label: "sampler-1" }),
  samplerParameteri: vi.fn(),
  bindSampler: vi.fn(),
  deleteSampler: vi.fn(),
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  REPEAT: 0x2901,
  CLAMP_TO_EDGE: 0x812f,
  DEPTH_TEST: 0x0b71,
  BLEND: 0x0be2,
  CULL_FACE: 0x0b44,
  NEVER: 0x0200,
  LESS: 0x0201,
  EQUAL: 0x0202,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  NOTEQUAL: 0x0205,
  GEQUAL: 0x0206,
  ALWAYS: 0x0207,
  ZERO: 0,
  ONE: 1,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  FUNC_ADD: 0x8006,
  FRONT: 0x0404,
  BACK: 0x0405,
  CCW: 0x0901,
  DEPTH_BUFFER_BIT: 0x0100,
  TRIANGLES: 0x0004,
  UNSIGNED_SHORT: 0x1403,
  enable: vi.fn(),
  disable: vi.fn(),
  depthFunc: vi.fn(),
  depthMask: vi.fn(),
  blendEquation: vi.fn(),
  blendFunc: vi.fn(),
  blendFuncSeparate: vi.fn(),
  cullFace: vi.fn(),
  frontFace: vi.fn(),
  clear: vi.fn(),
  bindVertexArray: vi.fn(),
  drawElements: vi.fn(),
  drawElementsInstanced: vi.fn(),
  drawArrays: vi.fn(),
  drawArraysInstanced: vi.fn(),
  FRAMEBUFFER: 0x8d40,
  READ_FRAMEBUFFER: 0x8ca8,
  DRAW_FRAMEBUFFER: 0x8ca9,
  RENDERBUFFER: 0x8d41,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  RGBA8: 0x8058,
  RGBA16F: 0x881a,
  RGBA32F: 0x8814,
  createFramebuffer: vi.fn(() => ({})),
  createRenderbuffer: vi.fn(() => ({})),
  bindFramebuffer: vi.fn(),
  bindRenderbuffer: vi.fn(),
  renderbufferStorage: vi.fn(),
  renderbufferStorageMultisample: vi.fn(),
  framebufferRenderbuffer: vi.fn(),
  checkFramebufferStatus: vi.fn(() => 0x8cd5),
  getInternalformatParameter: vi.fn(() => new Int32Array([4])),
  blitFramebuffer: vi.fn(),
  deleteFramebuffer: vi.fn(),
  deleteRenderbuffer: vi.fn(),
  LINES: 0x0001,
  POINTS: 0x0000,
  getUniformLocation: vi.fn(),
  uniformMatrix3fv: vi.fn(),
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

  it("binds the VR preview switch only for Image and keeps buffers in mainImage mode", () => {
    const image: Pass = { name: "Image", geometry: "fullscreen", inputs: {}, shaderSrc: "void mainVR(out vec4 c, vec2 p, vec3 o, vec3 d) {}" };
    passRenderer.vrPreview.update("a", [image]);
    passRenderer.renderPass(image, null, createMockShader(), defaultUniforms);
    expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("_ssVrPreview", 0);
    passRenderer.vrPreview.setEnabled(true);
    passRenderer.renderPass(image, null, createMockShader(), defaultUniforms);
    expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("_ssVrPreview", 1);
    vi.mocked(mockRenderer.SetShaderConstant1I).mockClear();
    passRenderer.renderPass({ ...image, name: "BufferA" }, null, createMockShader(), defaultUniforms);
    expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("_ssVrPreview", 0);
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
    channelLoaded: [0, 0, 0, 0],
    cameraPos: [0, 0, 0],
    cameraDir: [0, 0, -1]
  };

  describe("renderPass", () => {
    /** Order of every recorded GL/renderer call, for "state set before draw, restored after" checks. */
    const order = (fn: unknown, call = 0) => (fn as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[call];
    const lastOrder = (fn: unknown) => {
      const calls = (fn as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder;
      return calls[calls.length - 1];
    };
    const renderWithMeshes = (passConfig: Pass, meshResources: unknown = { get: vi.fn(() => ({ vao: {}, indexCount: 36, vertexCount: 24 })), getModel: vi.fn() }) => {
      passRenderer = new PassRenderer(mockCanvas, mockResourceManager as any, mockBufferManager as any, mockRenderer, mockKeyboardManager as any, meshResources as any);
      passRenderer.renderPass(passConfig, null, createMockShader(), defaultUniforms);
    };
    const expectGlDefaultsRestoredAfter = (draw: unknown) => {
      const after = lastOrder(draw);
      expect(mockGl.disable).toHaveBeenCalledWith(mockGl.BLEND);
      expect(mockGl.disable).toHaveBeenCalledWith(mockGl.DEPTH_TEST);
      expect(mockGl.disable).toHaveBeenCalledWith(mockGl.CULL_FACE);
      expect(mockGl.blendFunc).toHaveBeenLastCalledWith(mockGl.ONE, mockGl.ZERO);
      expect(mockGl.depthFunc).toHaveBeenLastCalledWith(mockGl.LESS);
      expect(mockGl.depthMask).toHaveBeenLastCalledWith(true);
      expect(lastOrder(mockGl.disable)).toBeGreaterThan(after);
      expect(lastOrder(mockGl.depthMask)).toBeGreaterThan(after);
      expect(lastOrder(mockGl.blendFunc)).toBeGreaterThan(after);
    };

    it("draws mesh passes indexed with the default depth state and restores GL state", () => {
      renderWithMeshes({ geometry: "cube", name: "TestPass", shaderSrc: "", inputs: {} });

      expect(mockRenderer.DrawUnitQuad_XY).not.toHaveBeenCalled();
      expect(mockRenderer.DrawPrimitive).not.toHaveBeenCalled();
      expect(mockGl.enable).toHaveBeenCalledWith(mockGl.DEPTH_TEST);
      // Default compare is less in both backends (WebGL used LEQUAL before blend/depth settings).
      expect(mockGl.depthFunc).toHaveBeenCalledWith(mockGl.LESS);
      expect(mockGl.depthFunc).not.toHaveBeenCalledWith(mockGl.LEQUAL);
      expect(mockGl.depthMask).toHaveBeenCalledWith(true);
      expect(mockGl.enable).not.toHaveBeenCalledWith(mockGl.BLEND);
      expect(mockGl.enable).not.toHaveBeenCalledWith(mockGl.CULL_FACE);
      expect(mockRenderer.Clear).toHaveBeenCalledWith(
        mockRenderer.CLEAR.Color | mockRenderer.CLEAR.Zbuffer,
        [0, 0, 0, 1],
        1,
        0,
      );
      expect(mockRenderer.SetShaderConstantMat4F).toHaveBeenCalledWith(
        "_meshProjection",
        expect.any(Array),
        true,
      );
      expect(mockGl.drawElements).toHaveBeenCalledWith(mockGl.TRIANGLES, 36, mockGl.UNSIGNED_SHORT, 0);
      expect(order(mockGl.enable)).toBeLessThan(order(mockGl.drawElements));
      expect(mockGl.bindVertexArray).toHaveBeenLastCalledWith(null);
      expectGlDefaultsRestoredAfter(mockGl.drawElements);
    });

    it("restores GL state and the VAO when a mesh draw throws", () => {
      mockGl.drawElements.mockImplementation(() => {
        throw new Error("lost context");
      });

      expect(() => renderWithMeshes({ geometry: "cube", name: "TestPass", shaderSrc: "", inputs: {}, blend: "additive", cull: "back" }))
        .toThrow("lost context");

      expect(mockGl.bindVertexArray).toHaveBeenLastCalledWith(null);
      expectGlDefaultsRestoredAfter(mockGl.drawElements);
    });

    it("draws fullscreen passes as one attributeless three-vertex triangle list without depth or culling", () => {
      const passConfig: Pass = { geometry: "fullscreen", name: "TestPass", shaderSrc: "", inputs: {} };

      passRenderer.renderPass(passConfig, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledTimes(1);
      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledWith(mockRenderer.PRIMTYPE.TRIANGLES, 3, false, 1);
      expect(mockRenderer.DrawUnitQuad_XY).not.toHaveBeenCalled();
      expect(mockRenderer.GetAttribLocation).not.toHaveBeenCalled();
      expect(mockRenderer.Clear).not.toHaveBeenCalled();
      expect(mockGl.drawElements).not.toHaveBeenCalled();
      expect(mockGl.enable).not.toHaveBeenCalled();
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iVertexCount", 3);
      expectGlDefaultsRestoredAfter(mockRenderer.DrawPrimitive);
    });

    it("clears a fullscreen pass when it has a custom clear colour", () => {
      passRenderer.renderPass(
        { geometry: "fullscreen", name: "Clear", shaderSrc: "", inputs: {}, clear: [0.25, 0.5, 0.75, 0.5] },
        null,
        createMockShader(),
        defaultUniforms,
      );

      expect(mockRenderer.Clear).toHaveBeenCalledWith(mockRenderer.CLEAR.Color, [0.25, 0.5, 0.75, 0.5], 1, 0);
      expect(order(mockRenderer.Clear)).toBeLessThan(order(mockRenderer.DrawPrimitive));
    });

    it.each(["alpha", "premultiplied", "additive"] as const)(
      "blends a fullscreen pass with %s after clearing to opaque black, then restores GL state",
      (blend) => {
        passRenderer.renderPass({ geometry: "fullscreen", name: "Glow", shaderSrc: "", inputs: {}, blend }, null, createMockShader(), defaultUniforms);

        expect(mockGl.enable).toHaveBeenCalledWith(mockGl.BLEND);
        expect(mockGl.enable).not.toHaveBeenCalledWith(mockGl.DEPTH_TEST);
        expect(mockGl.blendFuncSeparate).toHaveBeenCalledTimes(1);
        expect(mockRenderer.Clear).toHaveBeenCalledWith(mockRenderer.CLEAR.Color, [0, 0, 0, 1], 1, 0);
        expect(order(mockRenderer.Clear)).toBeLessThan(order(mockRenderer.DrawPrimitive));
        expect(order(mockGl.blendFuncSeparate)).toBeLessThan(order(mockRenderer.DrawPrimitive));
        expectGlDefaultsRestoredAfter(mockRenderer.DrawPrimitive);
      },
    );

    it.each([
      ["triangle-list", "TRIANGLES"],
      ["triangle-strip", "TRIANGLE_STRIP"],
      ["line-list", "LINES"],
      ["line-strip", "LINE_STRIP"],
      ["point-list", "POINTS"],
    ] as const)("draws a %s vertices pass as %s with its vertexCount and no VAO", (topology, primitive) => {
      const passConfig: Pass = { geometry: "vertices", name: "TestPass", shaderSrc: "", inputs: {}, vertexCount: 12, topology };

      passRenderer.renderPass(passConfig, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledTimes(1);
      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledWith(mockRenderer.PRIMTYPE[primitive], 12, false, 1);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iVertexCount", 12);
      expect(mockGl.drawElements).not.toHaveBeenCalled();
      expect(mockGl.bindVertexArray).not.toHaveBeenCalled();
    });

    it("defaults a vertices pass to a 3-vertex triangle list and draws without mesh resources", () => {
      passRenderer.renderPass({ geometry: "vertices", name: "Default", shaderSrc: "", inputs: {} }, null, createMockShader(), defaultUniforms);
      passRenderer.renderPass(
        { geometry: "vertices", name: "Max", shaderSrc: "", inputs: {}, vertexCount: 2_147_483_647 },
        null, createMockShader(), defaultUniforms,
      );

      expect(mockRenderer.DrawPrimitive).toHaveBeenNthCalledWith(1, mockRenderer.PRIMTYPE.TRIANGLES, 3, false, 1);
      expect(mockRenderer.DrawPrimitive).toHaveBeenNthCalledWith(2, mockRenderer.PRIMTYPE.TRIANGLES, 2_147_483_647, false, 1);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iVertexCount", 3);
    });

    it("draws world-space vertices with the orbit camera, a cleared depth buffer and the default depth test", () => {
      passRenderer.renderPass({ geometry: "vertices", name: "World", shaderSrc: "", inputs: {}, vertexCount: 6 }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.SetShaderConstantMat4F).toHaveBeenCalledWith("_meshProjection", expect.any(Array), true);
      expect(mockRenderer.SetShaderConstantMat4F).toHaveBeenCalledWith("_meshView", expect.any(Array), true);
      expect(mockRenderer.SetShaderConstant3FV).toHaveBeenCalledWith("iCameraPosition", expect.any(Array));
      expect(mockRenderer.Clear).toHaveBeenCalledWith(mockRenderer.CLEAR.Color | mockRenderer.CLEAR.Zbuffer, [0, 0, 0, 1], 1, 0);
      expect(mockGl.enable).toHaveBeenCalledWith(mockGl.DEPTH_TEST);
      expect(mockGl.depthFunc).toHaveBeenCalledWith(mockGl.LESS);
      expect(order(mockRenderer.Clear)).toBeLessThan(order(mockRenderer.DrawPrimitive));
      expect(order(mockGl.enable)).toBeLessThan(order(mockRenderer.DrawPrimitive));
      expectGlDefaultsRestoredAfter(mockRenderer.DrawPrimitive);
    });

    it("draws clip-space vertices without the mesh camera transform and with the depth test off (ALWAYS) by default", () => {
      passRenderer.renderPass({ geometry: "vertices", name: "Clip", shaderSrc: "", inputs: {}, space: "clip" }, null, createMockShader(), defaultUniforms);

      for (const name of ["_meshModel", "_meshView", "_meshProjection"]) {
        expect(mockRenderer.SetShaderConstantMat4F).not.toHaveBeenCalledWith(name, expect.anything(), true);
      }
      expect(mockRenderer.SetShaderConstant3FV).not.toHaveBeenCalledWith("iCameraPosition", expect.anything());
      expect(mockRenderer.Clear).toHaveBeenCalledWith(mockRenderer.CLEAR.Color | mockRenderer.CLEAR.Zbuffer, [0, 0, 0, 1], 1, 0);
      expect(mockGl.depthFunc).toHaveBeenNthCalledWith(1, mockGl.ALWAYS);
      expect(mockGl.depthMask).toHaveBeenNthCalledWith(1, true);
      expectGlDefaultsRestoredAfter(mockRenderer.DrawPrimitive);
    });

    it.each([
      ["never", "NEVER"],
      ["less", "LESS"],
      ["equal", "EQUAL"],
      ["less-equal", "LEQUAL"],
      ["greater", "GREATER"],
      ["not-equal", "NOTEQUAL"],
      ["greater-equal", "GEQUAL"],
      ["always", "ALWAYS"],
    ] as const)("applies depth compare %s as %s with writes off", (compare, func) => {
      renderWithMeshes({ geometry: "sphere", name: "S", shaderSrc: "", inputs: {}, depth: { compare, write: false } });

      expect(mockGl.depthFunc).toHaveBeenNthCalledWith(1, mockGl[func]);
      expect(mockGl.depthMask).toHaveBeenNthCalledWith(1, false);
      expectGlDefaultsRestoredAfter(mockGl.drawElements);
    });

    it.each([
      ["greater", 0],
      ["greater-equal", 0],
      ["less", 1],
      ["less-equal", 1],
    ] as const)("clears depth for compare %s to %d before drawing", (compare, clearDepth) => {
      renderWithMeshes({ geometry: "cube", name: "C", shaderSrc: "", inputs: {}, depth: { compare } });
      passRenderer.renderPass({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {}, depth: { compare } }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.Clear).toHaveBeenNthCalledWith(1, mockRenderer.CLEAR.Color | mockRenderer.CLEAR.Zbuffer, [0, 0, 0, 1], clearDepth, 0);
      expect(mockRenderer.Clear).toHaveBeenNthCalledWith(2, mockRenderer.CLEAR.Color | mockRenderer.CLEAR.Zbuffer, [0, 0, 0, 1], clearDepth, 0);
    });

    it("tests with ALWAYS when the depth test is off so depth writes still match WebGPU", () => {
      renderWithMeshes({ geometry: "cube", name: "C", shaderSrc: "", inputs: {}, depth: { test: false, compare: "greater" } });

      expect(mockGl.enable).toHaveBeenCalledWith(mockGl.DEPTH_TEST);
      expect(mockGl.depthFunc).toHaveBeenNthCalledWith(1, mockGl.ALWAYS);
      expect(mockGl.depthMask).toHaveBeenNthCalledWith(1, true);
    });

    it("turns the clip-space depth test on when configured", () => {
      passRenderer.renderPass(
        { geometry: "vertices", name: "Clip", shaderSrc: "", inputs: {}, space: "clip", depth: { test: true } },
        null, createMockShader(), defaultUniforms,
      );

      expect(mockGl.depthFunc).toHaveBeenNthCalledWith(1, mockGl.LESS);
    });

    it.each([
      ["back", "BACK"],
      ["front", "FRONT"],
    ] as const)("culls %s faces with counter-clockwise front faces on meshes and vertices", (cull, face) => {
      renderWithMeshes({ geometry: "cube", name: "C", shaderSrc: "", inputs: {}, cull });
      passRenderer.renderPass({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {}, cull }, null, createMockShader(), defaultUniforms);

      expect(mockGl.enable).toHaveBeenCalledWith(mockGl.CULL_FACE);
      expect(mockGl.frontFace).toHaveBeenNthCalledWith(1, mockGl.CCW);
      expect(mockGl.cullFace).toHaveBeenNthCalledWith(1, mockGl[face]);
      expect(mockGl.cullFace).toHaveBeenNthCalledWith(3, mockGl[face]);
      expect(order(mockGl.cullFace)).toBeLessThan(order(mockGl.drawElements));
      expectGlDefaultsRestoredAfter(mockRenderer.DrawPrimitive);
    });

    it("leaves culling disabled for cull none", () => {
      renderWithMeshes({ geometry: "cube", name: "C", shaderSrc: "", inputs: {}, cull: "none" });

      expect(mockGl.enable).not.toHaveBeenCalledWith(mockGl.CULL_FACE);
      expect(mockGl.cullFace).toHaveBeenCalledTimes(1);
      expect(order(mockGl.cullFace)).toBeGreaterThan(order(mockGl.drawElements));
    });

    it("does not leak one pass's blend, depth or cull into the next pass", () => {
      passRenderer.renderPass(
        { geometry: "vertices", name: "Particles", shaderSrc: "", inputs: {}, blend: "additive", depth: { write: false }, cull: "back" },
        null, createMockShader(), defaultUniforms,
      );
      mockGl.enable.mockClear();
      mockGl.blendFuncSeparate.mockClear();
      passRenderer.renderPass({ geometry: "fullscreen", name: "Image", shaderSrc: "", inputs: {} }, null, createMockShader(), defaultUniforms);

      expect(mockGl.enable).not.toHaveBeenCalled();
      expect(mockGl.blendFuncSeparate).not.toHaveBeenCalled();
      expect(mockGl.depthMask).toHaveBeenLastCalledWith(true);
    });

    it("binds iVertexCount to the mesh vertex count for built-in meshes and models", () => {
      const meshResources = {
        get: vi.fn(() => ({ vao: {}, indexCount: 36, vertexCount: 24 })),
        getModel: vi.fn(() => ({ vao: {}, indexCount: 60, vertexCount: 42 })),
      };
      passRenderer = new PassRenderer(mockCanvas, mockResourceManager as any, mockBufferManager as any, mockRenderer, mockKeyboardManager as any, meshResources as any);

      passRenderer.renderPass({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {} }, null, createMockShader(), defaultUniforms);
      passRenderer.renderPass({ geometry: "model", name: "Robot", shaderSrc: "", inputs: {}, modelPath: "robot.glb" }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iVertexCount", 24);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iVertexCount", 42);
      expect(passRenderer.getPassVertexCount({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {} })).toBe(24);
      expect(passRenderer.getPassVertexCount({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {}, vertexCount: 9 })).toBe(9);
      expect(passRenderer.getPassVertexCount({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {} })).toBe(3);
      expect(passRenderer.getPassVertexCount({ geometry: "fullscreen", name: "F", shaderSrc: "", inputs: {} })).toBe(3);
      expect(meshResources.get).not.toHaveBeenCalledWith("vertices");
    });

    it.each([
      ["fullscreen", { geometry: "fullscreen" }],
      ["clip-space vertices", { geometry: "vertices", space: "clip" }],
      ["a cube", { geometry: "cube" }],
    ] as const)("binds the orbit camera matrices at the pass aspect ratio for %s", (_name, fields) => {
      renderWithMeshes({ name: "P", shaderSrc: "", inputs: {}, ...fields } as Pass);

      const camera = new OrbitCamera().getMatrices(defaultUniforms.res[0] / defaultUniforms.res[1]);
      expect(mockRenderer.SetShaderConstantMat4F).toHaveBeenCalledWith("iViewMatrix", Array.from(camera.view), true);
      expect(mockRenderer.SetShaderConstantMat4F).toHaveBeenCalledWith("iProjectionMatrix", Array.from(camera.projection), true);
      expect(mockRenderer.SetShaderConstantMat4F).toHaveBeenCalledWith("iViewProjection", Array.from(camera.viewProjection), true);
    });

    it("projects meshes with the same matrices it exposes", () => {
      renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {} });

      const calls = new Map((mockRenderer.SetShaderConstantMat4F as ReturnType<typeof vi.fn>).mock.calls.map(([name, value]) => [name, value]));
      expect(calls.get("_meshView")).toEqual(calls.get("iViewMatrix"));
      expect(calls.get("_meshProjection")).toEqual(calls.get("iProjectionMatrix"));
    });

    it("guards the aspect ratio of a zero-height pass", () => {
      const camera = passRenderer.getCameraMatrices([100, 0]);
      expect(camera.projection).toEqual(new OrbitCamera().getProjectionMatrix(100));
      expect(passRenderer.getCameraMatrices([0, 50]).projection).toEqual(new OrbitCamera().getProjectionMatrix(0.01));
    });

    it("draws every instance of a vertices pass and binds iInstanceCount", () => {
      passRenderer.renderPass({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {}, vertexCount: 6, instanceCount: 5 }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledWith(mockRenderer.PRIMTYPE.TRIANGLES, 6, false, 5);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iInstanceCount", 5);
    });

    it("draws every instance of a mesh pass with drawElementsInstanced and restores GL state", () => {
      renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {}, instanceCount: 4 });

      expect(mockGl.drawElementsInstanced).toHaveBeenCalledWith(mockGl.TRIANGLES, 36, mockGl.UNSIGNED_SHORT, 0, 4);
      expect(mockGl.drawElements).not.toHaveBeenCalled();
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iInstanceCount", 4);
      expect(mockGl.bindVertexArray).toHaveBeenLastCalledWith(null);
      expectGlDefaultsRestoredAfter(mockGl.drawElementsInstanced);
    });

    describe("multisampling", () => {
      const bufferTarget = { mObjectID: { id: "fbo" }, mTex0: { mXres: 64, mYres: 32 } } as unknown as PiRenderTarget;
      const renderMesh = (fields: Partial<Pass>, target: PiRenderTarget | null) => {
        passRenderer = new PassRenderer(mockCanvas, mockResourceManager as any, mockBufferManager as any, mockRenderer, mockKeyboardManager as any,
          { get: vi.fn(() => ({ vao: {}, indexCount: 36, vertexCount: 24 })), getModel: vi.fn() } as any);
        passRenderer.renderPass({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {}, ...fields } as Pass, target, createMockShader(), defaultUniforms);
      };

      it("draws a 4-sample buffer pass into an rgba16float multisample target and resolves it after the draw", () => {
        renderMesh({ samples: 4, outputFormat: "rgba16float" }, bufferTarget);

        expect(mockGl.renderbufferStorageMultisample).toHaveBeenCalledWith(mockGl.RENDERBUFFER, 4, mockGl.RGBA16F, 64, 32);
        expect(mockRenderer.SetRenderTarget).not.toHaveBeenCalledWith(bufferTarget);
        expect(mockGl.blitFramebuffer).toHaveBeenCalledTimes(1);
        expect(order(mockGl.blitFramebuffer)).toBeGreaterThan(order(mockGl.drawElements));
        expect(mockGl.bindFramebuffer).toHaveBeenLastCalledWith(mockGl.FRAMEBUFFER, (bufferTarget as unknown as { mObjectID: object }).mObjectID);
      });

      it("multisamples the canvas in RGBA8 and resolves through a stage", () => {
        Object.assign(mockCanvas, { width: 320, height: 180 });
        renderMesh({ samples: 4 }, null);

        expect(mockGl.renderbufferStorageMultisample).toHaveBeenCalledWith(mockGl.RENDERBUFFER, 4, mockGl.RGBA8, 320, 180);
        expect(mockGl.blitFramebuffer).toHaveBeenCalledTimes(2);
      });

      it("uses an rgba32float multisample target for a buffer that kept rgba32float", () => {
        renderMesh({ samples: 4, outputFormat: "rgba32float" }, bufferTarget);

        expect(mockGl.renderbufferStorageMultisample).toHaveBeenCalledWith(mockGl.RENDERBUFFER, 4, mockGl.RGBA32F, 64, 32);
      });

      it("resolves even when the draw throws", () => {
        mockGl.drawElements.mockImplementationOnce(() => {
          throw new Error("lost context");
        });

        expect(() => renderMesh({ samples: 4 }, bufferTarget)).toThrow("lost context");
        expect(mockGl.blitFramebuffer).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["one sample", { samples: 1 }],
        ["omitted samples", {}],
        ["fullscreen geometry", { samples: 4, geometry: "fullscreen" }],
      ] as const)("draws straight into the target for %s", (_name, fields) => {
        renderMesh(fields as Partial<Pass>, bufferTarget);

        expect(mockGl.renderbufferStorageMultisample).not.toHaveBeenCalled();
        expect(mockRenderer.SetRenderTarget).toHaveBeenCalledWith(bufferTarget);
      });

      it("falls back to drawing straight into the target when the device cannot multisample", () => {
        mockGl.getInternalformatParameter.mockReturnValueOnce(new Int32Array([]));

        renderMesh({ samples: 4 }, bufferTarget);

        expect(mockRenderer.SetRenderTarget).toHaveBeenCalledWith(bufferTarget);
        expect(mockGl.blitFramebuffer).not.toHaveBeenCalled();
        expect(mockGl.drawElements).toHaveBeenCalled();
      });

      it("releases the multisample buffers on dispose", () => {
        renderMesh({ samples: 4 }, bufferTarget);

        passRenderer.dispose();

        expect(mockGl.deleteFramebuffer).toHaveBeenCalled();
      });
    });

    describe("mesh topology", () => {
      const vao = { id: "triangles" };
      const edgeVao = { id: "edges" };
      const meshes = { get: vi.fn(() => ({ vao, edgeVao, indexCount: 36, edgeIndexCount: 60, vertexCount: 24 })), getModel: vi.fn() };

      it("draws the unique-edge index buffer as lines for line-list", () => {
        renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {}, topology: "line-list" }, meshes);

        expect(mockGl.bindVertexArray).toHaveBeenCalledWith(edgeVao);
        expect(mockGl.drawElements).toHaveBeenCalledWith(mockGl.LINES, 60, mockGl.UNSIGNED_SHORT, 0);
        expect(mockGl.bindVertexArray).toHaveBeenLastCalledWith(null);
        expectGlDefaultsRestoredAfter(mockGl.drawElements);
      });

      it("draws each unique vertex once as a point for point-list", () => {
        renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {}, topology: "point-list" }, meshes);

        expect(mockGl.bindVertexArray).toHaveBeenCalledWith(vao);
        expect(mockGl.drawArrays).toHaveBeenCalledWith(mockGl.POINTS, 0, 24);
        expect(mockGl.drawElements).not.toHaveBeenCalled();
        expectGlDefaultsRestoredAfter(mockGl.drawArrays);
      });

      it("draws the triangles by default", () => {
        renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {} }, meshes);

        expect(mockGl.bindVertexArray).toHaveBeenCalledWith(vao);
        expect(mockGl.drawElements).toHaveBeenCalledWith(mockGl.TRIANGLES, 36, mockGl.UNSIGNED_SHORT, 0);
      });

      it("instances lines and points", () => {
        renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {}, topology: "line-list", instanceCount: 3 }, meshes);
        renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {}, topology: "point-list", instanceCount: 4 }, meshes);

        expect(mockGl.drawElementsInstanced).toHaveBeenCalledWith(mockGl.LINES, 60, mockGl.UNSIGNED_SHORT, 0, 3);
        expect(mockGl.drawArraysInstanced).toHaveBeenCalledWith(mockGl.POINTS, 0, 24, 4);
      });
    });

    it("draws a single-instance mesh pass without the instanced entry point", () => {
      renderWithMeshes({ geometry: "cube", name: "Cube", shaderSrc: "", inputs: {} });

      expect(mockGl.drawElements).toHaveBeenCalledTimes(1);
      expect(mockGl.drawElementsInstanced).not.toHaveBeenCalled();
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iInstanceCount", 1);
    });

    it("binds one instance for fullscreen passes and mesh passes that fall back to fullscreen", () => {
      passRenderer.renderPass({ geometry: "fullscreen", name: "F", shaderSrc: "", inputs: {} }, null, createMockShader(), defaultUniforms);
      passRenderer.renderPass({ geometry: "sphere", name: "S", shaderSrc: "", inputs: {}, instanceCount: 3 }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iInstanceCount", 1);
      expect(mockRenderer.SetShaderConstant1I).not.toHaveBeenCalledWith("iInstanceCount", 3);
      expect(mockRenderer.DrawPrimitive).toHaveBeenNthCalledWith(2, mockRenderer.PRIMTYPE.TRIANGLES, 3, false, 1);
      expect(passRenderer.getPassInstanceCount({ geometry: "sphere", name: "S", shaderSrc: "", inputs: {}, instanceCount: 3 })).toBe(1);
      expect(passRenderer.getPassInstanceCount({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {}, instanceCount: 3 })).toBe(3);
      expect(passRenderer.getPassInstanceCount({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {} })).toBe(1);
    });

    it("binds iVertexCount to 0 and skips drawing while a mesh is unavailable", () => {
      const meshResources = { get: vi.fn(), getModel: vi.fn(() => undefined) };
      passRenderer = new PassRenderer(mockCanvas, mockResourceManager as any, mockBufferManager as any, mockRenderer, mockKeyboardManager as any, meshResources as any);

      passRenderer.renderPass({ geometry: "model", name: "Robot", shaderSrc: "", inputs: {}, modelPath: "robot.glb" }, null, createMockShader(), defaultUniforms);
      passRenderer.renderPass({ geometry: "model", name: "Unloaded", shaderSrc: "", inputs: {} }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iVertexCount", 0);
      expect(mockRenderer.SetShaderConstant1I).not.toHaveBeenCalledWith("iVertexCount", 3);
      expect(mockGl.drawElements).not.toHaveBeenCalled();
      expect(mockRenderer.DrawPrimitive).not.toHaveBeenCalled();
    });

    it("falls back to the fullscreen draw and count for mesh passes without mesh resources", () => {
      passRenderer.renderPass({ geometry: "sphere", name: "Sphere", shaderSrc: "", inputs: {} }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledWith(mockRenderer.PRIMTYPE.TRIANGLES, 3, false, 1);
      expect(mockRenderer.SetShaderConstant1I).toHaveBeenCalledWith("iVertexCount", 3);
    });

    it("draws vertices without touching GL state when no WebGL2 context is available", () => {
      mockCanvas = { getContext: vi.fn().mockReturnValue(null) } as unknown as HTMLCanvasElement;
      passRenderer = new PassRenderer(mockCanvas, mockResourceManager as any, mockBufferManager as any, mockRenderer, mockKeyboardManager as any);

      passRenderer.renderPass({ geometry: "vertices", name: "V", shaderSrc: "", inputs: {}, vertexCount: 4, topology: "line-strip", blend: "alpha" }, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledWith(mockRenderer.PRIMTYPE.LINE_STRIP, 4, false, 1);
      expect(mockGl.enable).not.toHaveBeenCalled();
    });

    it("clears fullscreen passes with a vertex hook so uncovered pixels match WebGPU", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
        name: "TestPass",
        shaderSrc: "",
        vertexSrc: "void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv) {}",
        inputs: {},
      };

      passRenderer.renderPass(passConfig, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.Clear).toHaveBeenCalledWith(mockRenderer.CLEAR.Color, [0, 0, 0, 1], 1, 0);
      expect((mockRenderer.Clear as any).mock.invocationCallOrder[0])
        .toBeLessThan((mockRenderer.DrawPrimitive as any).mock.invocationCallOrder[0]);
    });

    it.each(["", "   \n"])("does not clear fullscreen passes without a vertex hook (%j)", (vertexSrc) => {
      const passConfig: Pass = { geometry: "fullscreen", name: "TestPass", shaderSrc: "", vertexSrc, inputs: {} };

      passRenderer.renderPass(passConfig, null, createMockShader(), defaultUniforms);

      expect(mockRenderer.Clear).not.toHaveBeenCalled();
      expect(mockRenderer.DrawPrimitive).toHaveBeenCalledWith(mockRenderer.PRIMTYPE.TRIANGLES, 3, false, 1);
    });

    it("should not render when shader is null", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "keyboard" }
        }
      };

      const mockShader = createMockShader();
      const mockKeyboardTexture = createMockTexture();
      mockResourceManager.getKeyboardTexture.mockReturnValue(mockKeyboardTexture);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms, undefined, true);

      expect(mockResourceManager.updateKeyboardTexture).not.toHaveBeenCalled();
      // Should still bind the existing texture
      expect(mockResourceManager.getKeyboardTexture).toHaveBeenCalledTimes(1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
    });

    it("should handle buffer input correctly", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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

    it("should handle cubemap input correctly", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: { type: "cubemap", path: "cubemap.png" }
        }
      };

      const mockShader = createMockShader();
      const mockCubemapTexture = { ...createMockTexture(512, 512), mType: 2 };
      mockResourceManager.getCubemapTexture.mockReturnValue(mockCubemapTexture);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getCubemapTexture).toHaveBeenCalledWith("cubemap.png");
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_CUBE_MAP, mockCubemapTexture.mObjectID);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iChannel0", 0);
    });

    it("should use resolved_path for cubemap textures", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          iChannel0: {
            type: "cubemap",
            path: "cubemap.png",
            resolved_path: "vscode-webview://panel/cubemap.png"
          }
        }
      };

      const mockShader = createMockShader();
      const mockCubemapTexture = { ...createMockTexture(512, 512), mType: 2 };
      mockResourceManager.getCubemapTexture.mockReturnValue(mockCubemapTexture);

      passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);

      expect(mockResourceManager.getCubemapTexture).toHaveBeenCalledWith("vscode-webview://panel/cubemap.png");
      expect(mockResourceManager.getCubemapTexture).not.toHaveBeenCalledWith("cubemap.png");
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_CUBE_MAP, mockCubemapTexture.mObjectID);
    });

    it("should handle multiple video inputs on different channels", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("noiseMap.sampler", 0);
    });

    it("should handle more than 4 channels", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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

    it("isolates sampling when one buffer is bound with two sampler settings", () => {
      const sharedTexture = createMockTexture(8, 8);
      mockBufferManager.getPassBuffers.mockReturnValue({
        BufferA: { front: { mTex0: sharedTexture }, back: { mTex0: createMockTexture() } },
      });
      const passConfig: Pass = {
        geometry: "fullscreen",
        name: "Image",
        shaderSrc: "",
        inputs: {
          nearest: { type: "buffer", source: "BufferA", filter: "nearest", wrap: "repeat" },
          linear: { type: "buffer", source: "BufferA", filter: "linear", wrap: "clamp" },
        },
      };

      passRenderer.renderPass(passConfig, null, createMockShader(), defaultUniforms);

      expect(mockGl.bindTexture).toHaveBeenNthCalledWith(1, mockGl.TEXTURE_2D, sharedTexture.mObjectID);
      expect(mockGl.bindTexture).toHaveBeenNthCalledWith(2, mockGl.TEXTURE_2D, sharedTexture.mObjectID);
      expect(mockGl.bindSampler).toHaveBeenNthCalledWith(1, 0, { label: "sampler-0" });
      expect(mockGl.bindSampler).toHaveBeenNthCalledWith(2, 1, { label: "sampler-1" });
      expect(mockGl.samplerParameteri).toHaveBeenCalledWith(
        { label: "sampler-0" }, mockGl.TEXTURE_MAG_FILTER, mockGl.NEAREST,
      );
      expect(mockGl.samplerParameteri).toHaveBeenCalledWith(
        { label: "sampler-1" }, mockGl.TEXTURE_WRAP_S, mockGl.CLAMP_TO_EDGE,
      );

      passRenderer.dispose();
      expect(mockGl.deleteSampler).toHaveBeenCalledTimes(2);
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("colorMap.sampler", 0);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("normalMap.sampler", 1);
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("heightMap.sampler", 3);
      // iChannel2 is at slot 2 so no alias needed — verify no duplicate
    });

    it("should use resolved_path for video textures", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
    it("should bind iCh0-iCh3 samplers to matching channel units when locations are absent", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
        name: "TestPass",
        shaderSrc: "",
        inputs: {
          noiseMap: { type: "texture", path: "noise.png" },
        }
      };
      const mockShader = createMockShader();
      mockResourceManager.getImageTextureCache.mockReturnValue({
        "noise.png": createMockTexture(512, 512),
      });
      vi.mocked(mockRenderer.SetShaderTextureUnit).mockReturnValue(false);

      expect(() => {
        passRenderer.renderPass(passConfig, null, mockShader, defaultUniforms);
      }).not.toThrow();

      for (let i = 0; i < 4; i++) {
        expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith(`iCh${i}.sampler`, i);
        expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith(`iChannel${i}`, i);
      }
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("noiseMap.sampler", 0);
    });

    it("should set iCh0-iCh3 time, size, and loaded uniforms", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
        geometry: "fullscreen",
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
      expect(mockRenderer.SetShaderTextureUnit).toHaveBeenCalledWith("iCh4.sampler", 4);
      expect(mockRenderer.SetShaderConstant3F).toHaveBeenCalledWith("iCh4.size", 500, 500, 1);
    });

    it("should set iChannelResolution correctly with custom-named inputs", () => {
      const passConfig: Pass = {
        geometry: "fullscreen",
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
