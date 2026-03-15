import { describe, it, expect, beforeEach, vi } from "vitest";
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
    getExtension: vi.fn(),
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
});

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
    it("should initialize quad geometry on construction", () => {
      expect(gl.createBuffer).toHaveBeenCalled();
      expect(gl.createVertexArray).toHaveBeenCalled();
      expect(gl.bindBuffer).toHaveBeenCalled();
      expect(gl.bufferData).toHaveBeenCalled();
    });

    it("should request EXT_color_buffer_float extension", () => {
      expect(gl.getExtension).toHaveBeenCalledWith("EXT_color_buffer_float");
    });
  });

  describe("issueCaptureAtPixel", () => {
    it("should return 0 for empty captures array", () => {
      const result = capturer.issueCaptureAtPixel(
        [],
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );
      expect(result).toBe(0);
    });

    it("should issue captures for valid shaders and return the count", () => {
      const captures = [
        { varName: "myVar", varType: "float", captureShader: "shader1" },
        { varName: "myVec", varType: "vec3", captureShader: "shader2" },
      ];

      const result = capturer.issueCaptureAtPixel(
        captures,
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(result).toBe(2);
      expect(shaderCompiler.compileShader).toHaveBeenCalledTimes(2);
    });

    it("should skip captures where shader compilation fails", () => {
      vi.mocked(shaderCompiler.compileShader).mockReturnValueOnce({
        mProgram: null,
        mResult: false,
        mInfo: "error",
        mHeaderLines: 0,
      });

      const captures = [
        { varName: "failing", varType: "float", captureShader: "bad" },
        { varName: "working", varType: "float", captureShader: "good" },
      ];

      const result = capturer.issueCaptureAtPixel(
        captures,
        100,
        200,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(result).toBe(1);
    });

    it("should create float FBO, render, read pixels, and create fence", () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      capturer.issueCaptureAtPixel(
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

    it("should return 0 when FBO creation fails", () => {
      vi.mocked(gl.createFramebuffer).mockReturnValue(null);

      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      const result = capturer.issueCaptureAtPixel(
        captures,
        50,
        100,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(result).toBe(0);
    });

    it("should cache compiled shaders for reuse", () => {
      const captures = [
        { varName: "a", varType: "float", captureShader: "same_code" },
      ];

      capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );
      capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      // Should compile only once since the same code is used
      expect(shaderCompiler.compileShader).toHaveBeenCalledTimes(1);
    });
  });

  describe("issueCaptureGrid", () => {
    it("should return 0 for empty captures array", () => {
      const result = capturer.issueCaptureGrid(
        [],
        createDefaultUniforms(),
        4,
        4,
      );
      expect(result).toBe(0);
    });

    it("should issue captures over a grid and return the count", () => {
      const captures = [
        { varName: "grid1", varType: "vec4", captureShader: "gridShader" },
      ];

      const result = capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        4,
        4,
      );

      expect(result).toBe(1);
      expect(gl.readPixels).toHaveBeenCalled();
      expect(gl.fenceSync).toHaveBeenCalled();
    });

    it("should return 0 when FBO creation fails", () => {
      vi.mocked(gl.createFramebuffer).mockReturnValue(null);

      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      const result = capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        4,
        4,
      );

      expect(result).toBe(0);
    });

    it("should skip captures with failed shader compilation", () => {
      vi.mocked(shaderCompiler.compileShader).mockReturnValue(null);

      const captures = [
        { varName: "x", varType: "float", captureShader: "bad_code" },
      ];

      const result = capturer.issueCaptureGrid(
        captures,
        createDefaultUniforms(),
        2,
        2,
      );

      expect(result).toBe(0);
    });
  });

  describe("collectResults", () => {
    it("should return empty array when no pending captures", () => {
      const results = capturer.collectResults();
      expect(results).toEqual([]);
    });

    it("should collect results for signaled fences", () => {
      const captures = [
        { varName: "val", varType: "float", captureShader: "code" },
      ];

      capturer.issueCaptureAtPixel(
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

    it("should keep unsignaled captures pending", () => {
      const captures = [
        { varName: "pending", varType: "vec2", captureShader: "code" },
      ];

      capturer.issueCaptureAtPixel(
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

    it("should handle mix of signaled and unsignaled captures", () => {
      const captures = [
        { varName: "a", varType: "float", captureShader: "code1" },
        { varName: "b", varType: "float", captureShader: "code2" },
      ];

      capturer.issueCaptureAtPixel(
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

  describe("dispose", () => {
    it("should clean up pending captures", () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      capturer.issueCaptureAtPixel(
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

    it("should clean up PBO pool", () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      capturer.issueCaptureAtPixel(
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

    it("should clean up quad VAO and buffer", () => {
      capturer.dispose();

      expect(gl.deleteVertexArray).toHaveBeenCalled();
      expect(gl.deleteBuffer).toHaveBeenCalled();
    });

    it("should clear shader cache", () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      capturer.issueCaptureAtPixel(
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
      vi.mocked(shaderCompiler.compileShader).mockClear();

      capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShader).toHaveBeenCalledTimes(1);
    });

    it("should be safe to call collectResults after dispose", () => {
      capturer.dispose();
      const results = capturer.collectResults();
      expect(results).toEqual([]);
    });
  });

  describe("shader cache LRU eviction", () => {
    it("should evict oldest shader when cache exceeds max size", () => {
      // SHADER_CACHE_MAX is 20
      for (let i = 0; i < 21; i++) {
        const captures = [
          { varName: `var${i}`, varType: "float", captureShader: `shader_${i}` },
        ];
        capturer.issueCaptureAtPixel(
          captures,
          0,
          0,
          800,
          600,
          createDefaultUniforms(),
        );
      }

      expect(shaderCompiler.compileShader).toHaveBeenCalledTimes(21);

      // Reusing shader_0 should trigger recompilation since it was evicted
      vi.mocked(shaderCompiler.compileShader).mockClear();

      const captures = [
        { varName: "reuse", varType: "float", captureShader: "shader_0" },
      ];
      capturer.issueCaptureAtPixel(
        captures,
        0,
        0,
        800,
        600,
        createDefaultUniforms(),
      );

      expect(shaderCompiler.compileShader).toHaveBeenCalledTimes(1);
    });
  });

  describe("PBO pool reuse", () => {
    it("should reuse PBOs from the pool instead of creating new ones", () => {
      const captures = [
        { varName: "x", varType: "float", captureShader: "code" },
      ];

      // Issue and collect to return PBO to pool
      capturer.issueCaptureAtPixel(
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
      capturer.issueCaptureAtPixel(
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
});
