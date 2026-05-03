import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VariableCapturer } from "../../capture/VariableCapturer";
import type { CaptureUniforms } from "../../capture/VariableCapturer";
import type { ShaderCompiler } from "../../ShaderCompiler";
import type { PiShader } from "../../types/piRenderer";

const createMockGl = () => {
  const buffers: object[] = [];
  const framebuffers: object[] = [];
  const textures: object[] = [];
  const syncs: object[] = [];
  const vaos: object[] = [];

  return {
    // Constants
    PIXEL_PACK_BUFFER: 0x88eb,
    STREAM_READ: 0x88e1,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    TEXTURE_2D: 0x0de1,
    RGBA32F: 0x8814,
    RGBA: 0x1908,
    FLOAT: 0x1406,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    UNSIGNALED: 0x9118,
    FRAMEBUFFER_BINDING: 0x8ca6,
    VIEWPORT: 0x0ba2,
    CURRENT_PROGRAM: 0x8b8d,
    VERTEX_ARRAY_BINDING: 0x85b5,
    TRIANGLES: 0x0004,
    NO_ERROR: 0,

    // Texture methods
    createTexture: vi.fn(() => {
      const tex = { id: textures.length };
      textures.push(tex);
      return tex;
    }),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    deleteTexture: vi.fn(),

    // Framebuffer methods
    createFramebuffer: vi.fn(() => {
      const fbo = { id: framebuffers.length };
      framebuffers.push(fbo);
      return fbo;
    }),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5), // FRAMEBUFFER_COMPLETE
    deleteFramebuffer: vi.fn(),

    // Buffer methods
    createBuffer: vi.fn(() => {
      const buf = { id: buffers.length };
      buffers.push(buf);
      return buf;
    }),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    getBufferSubData: vi.fn(),

    // Sync methods
    fenceSync: vi.fn(() => {
      const sync = { id: syncs.length };
      syncs.push(sync);
      return sync;
    }),
    getSyncParameter: vi.fn(() => 0x9119), // SIGNALED by default
    deleteSync: vi.fn(),

    // VAO methods
    createVertexArray: vi.fn(() => {
      const vao = { id: vaos.length };
      vaos.push(vao);
      return vao;
    }),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),

    // Shader/program methods
    useProgram: vi.fn(),
    getUniformLocation: vi.fn(() => ({ loc: true })),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3fv: vi.fn(),
    uniform4fv: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    disableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    drawArrays: vi.fn(),

    // State methods
    getParameter: vi.fn((param: number) => {
      if (param === 0x0ba2) return [0, 0, 800, 600]; // VIEWPORT
      return null;
    }),
    viewport: vi.fn(),
    flush: vi.fn(),
    readPixels: vi.fn(),
    getError: vi.fn(() => 0),
    getExtension: vi.fn(),
    isContextLost: vi.fn(() => false),
  } as unknown as WebGL2RenderingContext;
};

const createMockShaderCompiler = () => {
  return {
    compileShader: vi.fn((): PiShader => ({
      mProgram: {} as WebGLProgram,
      mResult: true,
      mInfo: "",
      mHeaderLines: 0,
    })),
    compileShaderAsync: vi.fn((): Promise<PiShader> => Promise.resolve({
      mProgram: {} as WebGLProgram,
      mResult: true,
      mInfo: "",
      mHeaderLines: 0,
    })),
  } as unknown as ShaderCompiler;
};

const createDefaultUniforms = (): CaptureUniforms => ({
  time: 1.0,
  timeDelta: 0.016,
  frameRate: 60,
  frame: 100,
  res: [800, 600],
  mouse: [0, 0, 0, 0],
  date: [2025, 6, 15, 12345],
  cameraPos: [0, 0, 0],
  cameraDir: [0, 0, -1],
});

const selectorCaptures = (
  vars: Array<[varName: string, varType: string]>,
  captureShader = "selector shader",
) => vars.map(([varName, varType], selectorIndex) => ({
  varName,
  varType,
  captureShader,
  selectorIndex,
}));

describe("VariableCapturer", () => {
  let gl: WebGL2RenderingContext;
  let shaderCompiler: ShaderCompiler;
  let capturer: VariableCapturer;

  beforeEach(() => {
    gl = createMockGl();
    shaderCompiler = createMockShaderCompiler();
    capturer = new VariableCapturer(gl, shaderCompiler);
  });

  describe("constructor", () => {
    it("should initialize quad geometry on construction", async () => {
      expect(gl.createBuffer).toHaveBeenCalled();
      expect(gl.createVertexArray).toHaveBeenCalled();
      expect(gl.bindBuffer).toHaveBeenCalled();
      expect(gl.bufferData).toHaveBeenCalled();
    });

    it("should request EXT_color_buffer_float extension", async () => {
      expect(gl.getExtension).toHaveBeenCalledWith("EXT_color_buffer_float");
    });

    it("passes capture compile context to shader compilation", async () => {
      const withContext = new VariableCapturer(gl, shaderCompiler, {
        commonCode: "float saturate(float x) { return clamp(x, 0.0, 1.0); }",
        slotAssignments: [{ slot: 0, key: "noiseTex", isCustomName: true }],
        channelTypes: ['2D', '2D', '2D', '2D'],
      });

      await withContext.issueCaptureGrid(
        [{ varName: "x", varType: "float", captureShader: "void mainImage(out vec4 c, in vec2 f){ c=vec4(1.0); }" }],
        createDefaultUniforms(),
        1,
        1,
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledWith(
        expect.any(String),
        "float saturate(float x) { return clamp(x, 0.0, 1.0); }",
        [{ slot: 0, key: "noiseTex", isCustomName: true }],
        ['2D', '2D', '2D', '2D'],
        undefined,
      );
    });
  });

  describe("issueCaptureAtPixel", () => {
    it("should return 0 for empty captures array", async () => {
      const result = await capturer.issueCaptureAtPixel(
        [],
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );
      expect(result).toBe(0);
    });

    it("should issue selector captures for valid shared shaders and return the count", async () => {
      const captures = selectorCaptures([
        ["myVar", "float"],
        ["myVec", "vec3"],
      ]);

      const result = await capturer.issueCaptureAtPixel(
        captures,
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(result).toBe(2);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("should skip all selector captures when the shared shader compilation fails", async () => {
      vi.mocked(shaderCompiler.compileShaderAsync).mockResolvedValueOnce({
        mProgram: null,
        mResult: false,
        mInfo: "error",
        mHeaderLines: 0,
      });

      const captures = selectorCaptures([
        ["failing", "float"],
        ["working", "float"],
      ], "bad selector shader");

      const result = await capturer.issueCaptureAtPixel(
        captures,
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(result).toBe(0);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("should not retry a shared selector shader when compilation throws", async () => {
      vi.mocked(shaderCompiler.compileShaderAsync).mockImplementationOnce(() => {
        throw new Error("compile failed");
      });

      const captures = selectorCaptures([
        ["bad", "float"],
        ["good", "float"],
      ], "throwing selector shader");

      const result = await capturer.issueCaptureAtPixel(
        captures,
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(result).toBe(0);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("should create float FBO, render, read pixels, and create fence", async () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      await capturer.issueCaptureAtPixel(
        captures,
        50,
        100,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(gl.createFramebuffer).toHaveBeenCalled();
      expect(gl.readPixels).toHaveBeenCalled();
      expect(gl.fenceSync).toHaveBeenCalledWith(
        gl.SYNC_GPU_COMMANDS_COMPLETE,
        0,
      );
      expect(gl.flush).toHaveBeenCalled();
      expect(gl.deleteFramebuffer).toHaveBeenCalled();
    });

    it("should return 0 when FBO creation fails", async () => {
      vi.mocked(gl.createFramebuffer).mockReturnValue(null);

      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      const result = await capturer.issueCaptureAtPixel(
        captures,
        50,
        100,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(result).toBe(0);
    });

    it("should cache compiled shaders for reuse", async () => {
      const captures = [
        { varName: "a", varType: "float", captureShader: "same_code" },
      ];

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );
      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      // Should compile only once since the same code is used
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("sets _dbgVarIndex for selector-based captures at pixel", async () => {
      const selectorLoc = { name: "_dbgVarIndex" };
      vi.mocked(gl.getUniformLocation).mockImplementation((_program, name) => (
        name === "_dbgVarIndex" ? selectorLoc as WebGLUniformLocation : null
      ));

      await capturer.issueCaptureAtPixel(
        [
          { varName: "a", varType: "float", captureShader: "shared", selectorIndex: 0 },
          { varName: "b", varType: "vec3", captureShader: "shared", selectorIndex: 1 },
        ],
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
      expect(gl.uniform1i).toHaveBeenCalledWith(selectorLoc, 0);
      expect(gl.uniform1i).toHaveBeenCalledWith(selectorLoc, 1);
    });
  });

  describe("issueCaptureGrid", () => {
    it("should return 0 for empty captures array", async () => {
      const result = await capturer.issueCaptureGrid(
        [],
        createDefaultUniforms(),
        4,
        4,
      );
      expect(result).toBe(0);
    });

    it("should issue captures over a grid and return the count", async () => {
      const captures = [
        { varName: "grid1", varType: "vec4", captureShader: "gridShader" },
      ];

      const result = await capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        4,
        4,
      );

      expect(result).toBe(1);
      expect(gl.readPixels).toHaveBeenCalled();
      expect(gl.fenceSync).toHaveBeenCalled();
    });

    it("sets _dbgVarIndex for selector-based grid captures", async () => {
      const selectorLoc = { name: "_dbgVarIndex" };
      vi.mocked(gl.getUniformLocation).mockImplementation((_program, name) => (
        name === "_dbgVarIndex" ? selectorLoc as WebGLUniformLocation : null
      ));

      const result = await capturer.issueCaptureGrid(
        [
          { varName: "a", varType: "float", captureShader: "shared-grid", selectorIndex: 0 },
          { varName: "b", varType: "vec2", captureShader: "shared-grid", selectorIndex: 1 },
          { varName: "c", varType: "vec4", captureShader: "shared-grid", selectorIndex: 2 },
        ],
        createDefaultUniforms(),
        4,
        4,
      );

      expect(result).toBe(3);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
      expect(gl.uniform1i).toHaveBeenCalledWith(selectorLoc, 0);
      expect(gl.uniform1i).toHaveBeenCalledWith(selectorLoc, 1);
      expect(gl.uniform1i).toHaveBeenCalledWith(selectorLoc, 2);
    });

    it("should return 0 when FBO creation fails", async () => {
      vi.mocked(gl.createFramebuffer).mockReturnValue(null);

      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      const result = await capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        4,
        4,
      );

      expect(result).toBe(0);
    });

    it("should skip captures with failed shader compilation", async () => {
      vi.mocked(shaderCompiler.compileShaderAsync).mockReturnValue(null);

      const captures = [
        { varName: "x", varType: "float", captureShader: "bad_code" },
      ];

      const result = await capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        2,
        2,
      );

      expect(result).toBe(0);
    });

    it("should not retry grid selector captures when the shared shader compile throws", async () => {
      vi.mocked(shaderCompiler.compileShaderAsync).mockImplementationOnce(() => {
        throw new Error("compile failed");
      });

      const captures = selectorCaptures([
        ["bad", "float"],
        ["good", "float"],
      ], "throwing grid selector shader");

      const result = await capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        2,
        2,
      );

      expect(result).toBe(0);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("should stop issuing grid captures when the request is cancelled after a compile", async () => {
      let shouldContinue = true;
      vi.mocked(shaderCompiler.compileShaderAsync).mockImplementation(async () => {
        shouldContinue = false;
        return {
          mProgram: {} as WebGLProgram,
          mResult: true,
          mInfo: "",
          mHeaderLines: 0,
        };
      });

      const captures = selectorCaptures([
        ["oldA", "float"],
        ["oldB", "float"],
      ], "old request selector shader");

      const result = await capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        2,
        2,
        () => shouldContinue,
      );

      expect(result).toBe(0);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
      expect(gl.readPixels).not.toHaveBeenCalled();
    });

  });

  describe("collectResults", () => {
    it("should return empty array when no pending captures", async () => {
      const results = capturer.collectResults();
      expect(results).toEqual([]);
    });

    it("should collect results for signaled fences", async () => {
      const captures = [
        { varName: "val", varType: "float", captureShader: "code" },
      ];

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      // gl.getSyncParameter returns SIGNALED by default
      const results = capturer.collectResults();

      expect(results).toHaveLength(1);
      expect(results[0].varName).toBe("val");
      expect(results[0].varType).toBe("float");
      expect(results[0].rgba).toBeInstanceOf(Float32Array);
      expect(gl.getBufferSubData).toHaveBeenCalled();
      expect(gl.deleteSync).toHaveBeenCalled();
    });

    it("should keep unsignaled captures pending", async () => {
      const captures = [
        { varName: "pending", varType: "vec2", captureShader: "code" },
      ];

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      // Return UNSIGNALED
      vi.mocked(gl.getSyncParameter).mockReturnValue(gl.UNSIGNALED);

      const results = capturer.collectResults();
      expect(results).toHaveLength(0);

      // Now signal it
      vi.mocked(gl.getSyncParameter).mockReturnValue(gl.SIGNALED);

      const results2 = capturer.collectResults();
      expect(results2).toHaveLength(1);
      expect(results2[0].varName).toBe("pending");
    });

    it("should handle mix of signaled and unsignaled captures", async () => {
      const captures = selectorCaptures([
        ["a", "float"],
        ["b", "float"],
      ]);

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      // First signaled, second unsignaled
      vi.mocked(gl.getSyncParameter)
        .mockReturnValueOnce(gl.SIGNALED)
        .mockReturnValueOnce(gl.UNSIGNALED);

      const results = capturer.collectResults();
      expect(results).toHaveLength(1);
      expect(results[0].varName).toBe("a");
    });

  });

  describe("compile spread across frames", () => {
    let rafCallbacks: FrameRequestCallback[];
    let rafSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      rafCallbacks = [];
      rafSpy = vi.fn((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      });
      vi.stubGlobal("requestAnimationFrame", rafSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const flushFrame = async () => {
      const cb = rafCallbacks.shift();
      if (cb) cb(0);
      // Drain microtasks/macrotasks so subsequent rAFs registered by the loop body queue up.
      await new Promise<void>(r => setTimeout(r, 0));
    };

    // Drive rAFs until `promise` settles. Yields between to let microtasks register more rAFs.
    const driveUntilSettled = async <T>(promise: Promise<T>): Promise<T> => {
      let settled = false;
      let result: T;
      let error: unknown;
      promise.then(r => { result = r; settled = true; }, e => { error = e; settled = true; });
      let safety = 0;
      while (!settled && safety++ < 200) {
        if (rafCallbacks.length > 0) {
          await flushFrame();
        } else {
          await new Promise<void>(r => setTimeout(r, 0));
        }
      }
      if (error) throw error;
      return result!;
    };

    it("yields one rAF per selector shader cache-miss before compile (issueCaptureGrid)", async () => {
      const captures = selectorCaptures([
        ["a", "float"],
        ["b", "float"],
        ["c", "float"],
      ]);

      const result = await driveUntilSettled(
        capturer.issueCaptureGrid(captures, createDefaultUniforms(), 4, 4),
      );

      expect(result).toBe(3);
      expect(rafSpy.mock.calls.length).toBe(1);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("does NOT yield when all shaders are cache hits", async () => {
      await driveUntilSettled(
        capturer.issueCaptureGrid(
          [{ varName: "a", varType: "float", captureShader: "shaderA" }],
          createDefaultUniforms(),
          4,
          4,
        ),
      );

      rafSpy.mockClear();
      vi.mocked(shaderCompiler.compileShaderAsync).mockClear();

      // Second issue: cache hit, should NOT yield
      const result = await capturer.issueCaptureGrid(
        [{ varName: "a", varType: "float", captureShader: "shaderA" }],
        createDefaultUniforms(),
        4,
        4,
      );

      expect(result).toBe(1);
      expect(rafSpy).not.toHaveBeenCalled();
      expect(shaderCompiler.compileShaderAsync).not.toHaveBeenCalled();
    });

    it("aborts spread when shouldContinue returns false after yield (issueCaptureGrid)", async () => {
      let shouldContinue = true;
      const captures = selectorCaptures([
        ["a", "float"],
        ["b", "float"],
        ["c", "float"],
      ]);

      const promise = capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        4,
        4,
        () => shouldContinue,
      );

      const cb = rafCallbacks.shift();
      if (cb) cb(0);
      // Cancel immediately after nextFrame resolves, before the async loop resumes.
      shouldContinue = false;

      const result = await driveUntilSettled(promise);

      expect(result).toBe(0);
      expect(shaderCompiler.compileShaderAsync).not.toHaveBeenCalled();
      // FBO texture must still be cleaned up
      expect(gl.deleteFramebuffer).toHaveBeenCalled();
      expect(gl.deleteTexture).toHaveBeenCalled();
    });

    it("yields one rAF per selector shader cache-miss in issueCaptureAtPixel", async () => {
      const captures = selectorCaptures([
        ["a", "float"],
        ["b", "float"],
      ], "pixel selector shader");

      const result = await driveUntilSettled(
        capturer.issueCaptureAtPixel(captures, 100, 50, 800, 600, createDefaultUniforms()),
      );

      expect(result).toBe(2);
      expect(rafSpy.mock.calls.length).toBe(1);
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("aborts spread when shouldContinue returns false after yield (issueCaptureAtPixel)", async () => {
      let shouldContinue = true;
      const captures = selectorCaptures([
        ["a", "float"],
        ["b", "float"],
        ["c", "float"],
      ], "pixel cancel selector shader");

      const promise = capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
        () => shouldContinue,
      );

      const cb = rafCallbacks.shift();
      if (cb) cb(0);
      shouldContinue = false;

      const result = await driveUntilSettled(promise);

      expect(result).toBe(0);
      expect(shaderCompiler.compileShaderAsync).not.toHaveBeenCalled();
      expect(gl.deleteFramebuffer).toHaveBeenCalled();
      expect(gl.deleteTexture).toHaveBeenCalled();
    });

    it("FBO texture survives the spread and is deleted exactly once at end", async () => {
      const captures = selectorCaptures([
        ["a", "float"],
        ["b", "float"],
        ["c", "float"],
      ], "long selector shader");

      vi.mocked(gl.deleteFramebuffer).mockClear();
      vi.mocked(gl.deleteTexture).mockClear();

      await driveUntilSettled(
        capturer.issueCaptureGrid(captures, createDefaultUniforms(), 4, 4),
      );

      expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
      expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    });

    it("selector shader cache hits do not yield or recompile for multiple captures", async () => {
      // Pre-warm cache for the shared selector shader.
      await driveUntilSettled(
        capturer.issueCaptureGrid(
          [{ varName: "a", varType: "float", captureShader: "shared warmed selector", selectorIndex: 0 }],
          createDefaultUniforms(),
          4,
          4,
        ),
      );

      rafSpy.mockClear();
      vi.mocked(shaderCompiler.compileShaderAsync).mockClear();

      const captures = selectorCaptures([
        ["a", "float"],
        ["b", "float"],
        ["c", "float"],
        ["d", "float"],
      ], "shared warmed selector");

      const result = await driveUntilSettled(
        capturer.issueCaptureGrid(captures, createDefaultUniforms(), 4, 4),
      );

      expect(result).toBe(4);
      expect(rafSpy).not.toHaveBeenCalled();
      expect(shaderCompiler.compileShaderAsync).not.toHaveBeenCalled();
    });
  });

  describe("FBO texture cleanup", () => {
    it("deletes the FBO texture after issueCaptureGrid (prevents GPU memory leak)", async () => {
      const fboTexture = { id: "fboTex-grid" };
      vi.mocked(gl.createTexture).mockReturnValueOnce(fboTexture as any);
      vi.mocked(gl.deleteTexture).mockClear();

      await capturer.issueCaptureGrid(
        [{ varName: "x", varType: "float", captureShader: "code" }],
        createDefaultUniforms(),
        2,
        2,
      );

      expect(gl.deleteTexture).toHaveBeenCalledWith(fboTexture);
    });

    it("deletes the FBO texture after issueCaptureAtPixel (prevents GPU memory leak)", async () => {
      const fboTexture = { id: "fboTex-pixel" };
      vi.mocked(gl.createTexture).mockReturnValueOnce(fboTexture as any);
      vi.mocked(gl.deleteTexture).mockClear();

      await capturer.issueCaptureAtPixel(
        [{ varName: "x", varType: "float", captureShader: "code" }],
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(gl.deleteTexture).toHaveBeenCalledWith(fboTexture);
    });

    it("each issueCaptureGrid call deletes exactly one texture (no accumulation)", async () => {
      vi.mocked(gl.deleteTexture).mockClear();

      for (let i = 0; i < 3; i++) {
        await capturer.issueCaptureGrid(
          [{ varName: "x", varType: "float", captureShader: "code" }],
          createDefaultUniforms(),
          2,
          2,
        );
      }

      expect(gl.deleteTexture).toHaveBeenCalledTimes(3);
    });
  });

  describe("pre-existing GL error draining", () => {
    it("logs and clears pre-existing GL errors at start of issueCaptureGrid", async () => {
      vi.mocked(gl.getError)
        .mockReturnValueOnce(1282)
        .mockReturnValue(0);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        await capturer.issueCaptureGrid(
          [{ varName: "x", varType: "float", captureShader: "code" }],
          createDefaultUniforms(),
          2,
          2,
        );

        expect(warnSpy).toHaveBeenCalledWith(
          "[VariableCapture] pre-existing GL errors at issue start",
          expect.objectContaining({ preExistingErrors: [1282] }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("logs and clears pre-existing GL errors at start of issueCaptureAtPixel", async () => {
      vi.mocked(gl.getError)
        .mockReturnValueOnce(1282)
        .mockReturnValue(0);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        await capturer.issueCaptureAtPixel(
          [{ varName: "x", varType: "float", captureShader: "code" }],
          0,
          0,
          800,
          600,
          createDefaultUniforms(),
        );

        expect(warnSpy).toHaveBeenCalledWith(
          "[VariableCapture] pre-existing GL errors at issue start",
          expect.objectContaining({ preExistingErrors: [1282] }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("dispose", () => {
    it("should clean up pending captures", async () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      capturer.dispose();

      expect(gl.deleteSync).toHaveBeenCalled();
      expect(gl.deleteBuffer).toHaveBeenCalled();
    });

    it("should clean up PBO pool", async () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      // Collect to release PBO back to pool
      capturer.collectResults();

      capturer.dispose();

      // deleteBuffer should have been called for pool buffers too
      expect(gl.deleteBuffer).toHaveBeenCalled();
    });

    it("should clean up quad VAO and buffer", async () => {
      capturer.dispose();

      expect(gl.deleteVertexArray).toHaveBeenCalled();
      expect(gl.deleteBuffer).toHaveBeenCalled();
    });

    it("should clear shader cache", async () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      capturer.dispose();

      // After dispose, reissuing should recompile
      capturer = new VariableCapturer(gl, shaderCompiler);
      vi.mocked(shaderCompiler.compileShaderAsync).mockClear();

      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("should be safe to call collectResults after dispose", async () => {
      capturer.dispose();
      const results = capturer.collectResults();
      expect(results).toEqual([]);
    });
  });

  describe("shader cache LRU eviction", () => {
    it("should evict oldest shader when cache exceeds max size", async () => {
      // SHADER_CACHE_MAX is 20
      for (let i = 0; i < 21; i++) {
        const captures = [
          { varName: `var${i}`, varType: "float", captureShader: `shader_${i}` },
        ];
        await capturer.issueCaptureAtPixel(
          captures,
          0,
          0,
          800,
          600,
          createDefaultUniforms(),
        );
      }

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(21);

      // Reusing shader_0 should trigger recompilation since it was evicted
      vi.mocked(shaderCompiler.compileShaderAsync).mockClear();

      const captures = [
        { varName: "reuse", varType: "float", captureShader: "shader_0" },
      ];
      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe("setCustomUniforms", () => {
    it("should pass custom declarations to compileShader", async () => {
      const declarations = "uniform vec3 uCpu;\nuniform float uSpeed;";
      capturer.setCustomUniforms(declarations, []);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "capture_code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledWith(
        "capture_code",
        undefined,
        undefined,
        undefined,
        declarations,
      );
    });

    it("should pass undefined when declarations are empty", async () => {
      capturer.setCustomUniforms("", []);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledWith(
        "code",
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it("should upload float custom uniform values during render", async () => {
      capturer.setCustomUniforms("uniform float uSpeed;", [
        { name: "uSpeed", type: "float", value: 2.5 },
      ]);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(gl.uniform1f).toHaveBeenCalledWith(
        expect.anything(), // uniform location mock
        2.5,
      );
    });

    it("should upload vec2 custom uniform values", async () => {
      capturer.setCustomUniforms("uniform vec2 uOff;", [
        { name: "uOff", type: "vec2", value: [1.0, 2.0] },
      ]);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(gl.uniform2f).toHaveBeenCalledWith(expect.anything(), 1.0, 2.0);
    });

    it("should upload vec3 custom uniform values", async () => {
      // Need to add uniform3f to the mock
      (gl as any).uniform3f = vi.fn();

      capturer.setCustomUniforms("uniform vec3 uColor;", [
        { name: "uColor", type: "vec3", value: [1.0, 0.5, 0.0] },
      ]);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect((gl as any).uniform3f).toHaveBeenCalledWith(expect.anything(), 1.0, 0.5, 0.0);
    });

    it("should upload vec4 custom uniform values", async () => {
      (gl as any).uniform4f = vi.fn();

      capturer.setCustomUniforms("uniform vec4 uRect;", [
        { name: "uRect", type: "vec4", value: [0, 0, 1, 1] },
      ]);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect((gl as any).uniform4f).toHaveBeenCalledWith(expect.anything(), 0, 0, 1, 1);
    });

    it("should upload bool custom uniform values as int", async () => {
      capturer.setCustomUniforms("uniform bool uEnabled;", [
        { name: "uEnabled", type: "bool", value: true },
      ]);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 1);
    });

    it("should upload false bool as 0", async () => {
      capturer.setCustomUniforms("uniform bool uEnabled;", [
        { name: "uEnabled", type: "bool", value: false },
      ]);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 0);
    });

    it("should upload multiple custom uniforms", async () => {
      (gl as any).uniform3f = vi.fn();

      capturer.setCustomUniforms(
        "uniform float uSpeed;\nuniform vec3 uColor;",
        [
          { name: "uSpeed", type: "float", value: 2.0 },
          { name: "uColor", type: "vec3", value: [1, 0, 0] },
        ],
      );

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 2.0);
      expect((gl as any).uniform3f).toHaveBeenCalledWith(expect.anything(), 1, 0, 0);
    });

    it("should invalidate shader cache when declarations change", async () => {
      capturer.setCustomUniforms("uniform float uA;", []);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "same_code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);

      // Same declarations — cache hit
      capturer.setCustomUniforms("uniform float uA;", []);
      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "same_code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);

      // Different declarations — cache invalidated
      capturer.setCustomUniforms("uniform vec3 uB;", []);
      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "same_code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );
      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(2);
    });

    it("should not invalidate cache when only values change", async () => {
      capturer.setCustomUniforms("uniform float uA;", [
        { name: "uA", type: "float", value: 1.0 },
      ]);
      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      capturer.setCustomUniforms("uniform float uA;", [
        { name: "uA", type: "float", value: 99.0 },
      ]);
      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledTimes(1);
    });

    it("should also pass declarations in issueCaptureGrid", async () => {
      const declarations = "uniform float uVal;";
      capturer.setCustomUniforms(declarations, [
        { name: "uVal", type: "float", value: 3.0 },
      ]);

      await capturer.issueCaptureGrid(
        [{ varName: "test", varType: "float", captureShader: "grid_code" }],
        createDefaultUniforms(),
        4, 4,
      );

      expect(shaderCompiler.compileShaderAsync).toHaveBeenCalledWith(
        "grid_code",
        undefined,
        undefined,
        undefined,
        declarations,
      );
      expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 3.0);
    });

    it("should skip uniform upload when getUniformLocation returns null", async () => {
      vi.mocked(gl.getUniformLocation).mockImplementation((_prog: any, name: string) => {
        if (name === "uMissing") return null;
        return { loc: true } as any;
      });

      capturer.setCustomUniforms("uniform float uMissing;", [
        { name: "uMissing", type: "float", value: 1.0 },
      ]);

      await capturer.issueCaptureAtPixel(
        [{ varName: "test", varType: "float", captureShader: "code" }],
        0, 0, 800, 600,
        createDefaultUniforms(),
      );

      // uniform1f should have been called for iTime etc., but NOT for uMissing
      const calls = vi.mocked(gl.uniform1f).mock.calls;
      const missingCalls = calls.filter(c => c[0] === null);
      expect(missingCalls).toHaveLength(0);
    });
  });

  describe("PBO pool reuse", () => {
    it("should reuse PBOs from the pool instead of creating new ones", async () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      // Issue and collect to return PBO to pool
      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );
      capturer.collectResults();

      const createBufferCallCount = vi.mocked(gl.createBuffer).mock.calls.length;

      // Issue again - should reuse PBO from pool
      await capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      // No new buffer should have been created for the PBO
      expect(vi.mocked(gl.createBuffer).mock.calls.length).toBe(
        createBufferCallCount,
      );
    });
  });

  describe("adaptive inter-compile throttle", () => {
    let rafCallbacks: FrameRequestCallback[];
    let rafSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      rafCallbacks = [];
      rafSpy = vi.fn((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      });
      vi.stubGlobal("requestAnimationFrame", rafSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const flushFrame = async () => {
      const cb = rafCallbacks.shift();
      if (cb) cb(0);
      await new Promise<void>(r => setTimeout(r, 0));
    };

    const driveUntilSettled = async <T>(promise: Promise<T>): Promise<T> => {
      let settled = false;
      let result: T;
      let error: unknown;
      promise.then(r => { result = r; settled = true; }, e => { error = e; settled = true; });
      let safety = 0;
      while (!settled && safety++ < 200) {
        if (rafCallbacks.length > 0) {
          await flushFrame();
        } else {
          await new Promise<void>(r => setTimeout(r, 0));
        }
      }
      if (error) throw error;
      return result!;
    };

    it("yields no extra frames when compile is fast (< 25ms)", async () => {
      const captures = [{ varName: "a", varType: "float", captureShader: "fastShader" }];

      const result = await driveUntilSettled(
        capturer.issueCaptureGrid(captures, createDefaultUniforms(), 4, 4),
      );

      expect(result).toBe(1);
      // 1 rAF before compile (cache miss) + 0 extra for instant compile
      expect(rafSpy.mock.calls.length).toBe(1);
    });


    it("nextFrame safety timeout resolves when rAF never fires (simulates throttled rAF after Metal crash)", async () => {
      // This tests the core fix for the 42-second hang: after Metal kills the GPU process,
      // requestAnimationFrame throttles to near-zero fps. The 500ms safety timeout in
      // nextFrame() ensures the capture loop unblocks within ~500ms rather than 42 seconds.
      vi.useFakeTimers();
      let rafId = 0;
      try {
        // rAF is registered but NEVER fires — simulates Metal-throttled rAF
        rafSpy.mockImplementation((_cb: FrameRequestCallback) => ++rafId);
        vi.stubGlobal("requestAnimationFrame", rafSpy);

        // Context becomes lost after we pass the initial isContextLost() guard.
        // Sequence: initial check (false) → register rAF → 500ms timeout fires → recheck (true) → break
        let contextLostAfterFrame = false;
        let checkCount = 0;
        vi.mocked(gl.isContextLost).mockImplementation(() => {
          checkCount++;
          // First check (before nextFrame): context alive so we proceed to register rAF
          return checkCount > 1 ? contextLostAfterFrame : false;
        });

        const captures = [{ varName: "a", varType: "float", captureShader: "throttledShader" }];

        const promise = capturer.issueCaptureGrid(captures, createDefaultUniforms(), 4, 4);

        // Drain microtasks so the loop reaches nextFrame() and registers the rAF + setTimeout
        await Promise.resolve();
        await Promise.resolve();

        // Context is now lost (Metal died while we're stuck waiting for throttled rAF)
        contextLostAfterFrame = true;

        // Advance fake time by 500ms — fires the safety setTimeout in nextFrame()
        await vi.advanceTimersByTimeAsync(500);

        const result = await promise;
        expect(result).toBe(0);
        // The rAF was registered (we confirmed nextFrame was reached)
        expect(rafSpy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT yield extra frames on cache hits", async () => {
      // Pre-warm cache
      await driveUntilSettled(
        capturer.issueCaptureGrid(
          [{ varName: "a", varType: "float", captureShader: "cachedShader" }],
          createDefaultUniforms(),
          4,
          4,
        ),
      );
      rafSpy.mockClear();
      vi.mocked(shaderCompiler.compileShaderAsync).mockClear();

      // Now make it look like compiles are slow, but cache hit should skip throttle
      let simulatedTime = 0;
      vi.spyOn(performance, "now").mockImplementation(() => simulatedTime);
      vi.mocked(shaderCompiler.compileShaderAsync).mockImplementation(async () => {
        simulatedTime += 500;
        return { mProgram: {} as WebGLProgram, mResult: true, mInfo: "", mHeaderLines: 0 };
      });

      // Re-issue same shader — cache hit, no compile, no throttle
      const result = await capturer.issueCaptureGrid(
        [{ varName: "a", varType: "float", captureShader: "cachedShader" }],
        createDefaultUniforms(),
        4,
        4,
      );

      expect(result).toBe(1);
      expect(rafSpy).not.toHaveBeenCalled();
      expect(shaderCompiler.compileShaderAsync).not.toHaveBeenCalled();
    });

  });
});
