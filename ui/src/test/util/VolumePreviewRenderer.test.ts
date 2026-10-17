import { describe, expect, it, vi, afterEach } from "vitest";
import { VolumePreviewRenderer } from "../../lib/util/VolumePreviewRenderer";

function setup(options: { context?: boolean; compile?: boolean; link?: boolean; max?: number } = {}) {
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, TEXTURE_3D: 5, TEXTURE0: 6,
    MAX_3D_TEXTURE_SIZE: 7, UNPACK_ALIGNMENT: 8, RGBA8: 9, RGBA: 10, UNSIGNED_BYTE: 11,
    TEXTURE_MIN_FILTER: 12, TEXTURE_MAG_FILTER: 13, LINEAR: 14, TEXTURE_WRAP_S: 15, TEXTURE_WRAP_T: 16, TEXTURE_WRAP_R: 17, CLAMP_TO_EDGE: 18, TRIANGLES: 19, NO_ERROR: 0,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => options.compile !== false), getShaderInfoLog: vi.fn(() => "compile failed"), deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => options.link !== false), getProgramInfoLog: vi.fn(() => "link failed"), deleteProgram: vi.fn(),
    createTexture: vi.fn(() => ({})), bindTexture: vi.fn(), texParameteri: vi.fn(), pixelStorei: vi.fn(), texImage3D: vi.fn(), deleteTexture: vi.fn(),
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
    getParameter: vi.fn(() => options.max ?? 2048), getError: vi.fn(() => 0), getUniformLocation: vi.fn(() => ({})), useProgram: vi.fn(), viewport: vi.fn(), activeTexture: vi.fn(), uniform1i: vi.fn(), uniform3f: vi.fn(), uniform1f: vi.fn(), drawArrays: vi.fn(), isContextLost: vi.fn(() => false),
  };
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockImplementation((() => options.context === false ? null : gl) as unknown as typeof canvas.getContext);
  let callback: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", vi.fn((next: FrameRequestCallback) => {
    callback = next; return 42;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const volume = { width: 1, height: 1, depth: 1, channels: 1 as const, data: new Uint8Array([255]) };
  return { gl, canvas, volume, frame: () => {
    const next = callback; callback = undefined; next?.(0);
  } };
}
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe("GPU volume preview", () => {
  it("uploads a native 3D texture once and coalesces camera changes into one animation frame", () => {
    const { gl, canvas, volume, frame } = setup();
    const preview = new VolumePreviewRenderer(canvas, volume);
    preview.draw(0.1, 0.2, 1);
    preview.draw(0.3, 0.4, 1.2);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    frame();
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(gl.uniform3f).toHaveBeenCalledWith(expect.anything(), 0.3, 0.4, 1.2);
    expect(gl.texImage3D).toHaveBeenCalledTimes(1);
    expect(gl.texImage3D.mock.calls[0].at(-1)).toEqual(new Uint8Array([255, 0, 0, 255]));
    preview.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  });
  it("cancels pending frames on disposal and ignores subsequent draws", () => {
    const { gl, canvas, volume, frame } = setup();
    const preview = new VolumePreviewRenderer(canvas, volume);
    preview.draw(0, 0, 1);
    preview.dispose(); preview.dispose(); preview.draw(1, 1, 1); frame();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  });
  it.each([{ context: false }, { compile: false }, { link: false }, { max: 0 }])("reports GPU setup failures and releases allocated resources: %j", options => {
    const { gl, canvas, volume } = setup(options);
    expect(() => new VolumePreviewRenderer(canvas, volume)).toThrow();
    expect(gl.drawArrays).not.toHaveBeenCalled();
    if (options.compile === false) {
      expect(gl.deleteShader).toHaveBeenCalled();
    }
    if (options.link === false || options.max === 0) {
      expect(gl.deleteProgram).toHaveBeenCalled();
    }
  });
  it.each(["shader", "program", "texture", "upload"])("cleans up after %s allocation failures", resource => {
    const { gl, canvas, volume } = setup();
    if (resource === "shader") {
      gl.createShader.mockReturnValueOnce(null as unknown as object);
    }
    if (resource === "program") {
      gl.createProgram.mockReturnValueOnce(null as unknown as object);
    }
    if (resource === "texture") {
      gl.createTexture.mockReturnValueOnce(null as unknown as object);
    }
    if (resource === "upload") {
      gl.getError.mockReturnValueOnce(1285);
    }
    expect(() => new VolumePreviewRenderer(canvas, volume)).toThrow();
    if (resource === "texture" || resource === "upload") {
      expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    }
    if (resource === "upload") {
      expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    }
  });
  it("uploads RGBA voxels unchanged and schedules another frame after drawing", () => {
    const { gl, canvas, volume, frame } = setup();
    const data = new Uint8Array([10, 20, 30, 40]);
    const preview = new VolumePreviewRenderer(canvas, { ...volume, channels: 4, data });
    expect(gl.texImage3D.mock.calls[0].at(-1)).toBe(data);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0);
    preview.draw(0, 0, 1); frame(); preview.draw(1, 0, 1); frame();
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    preview.dispose();
  });
  it("skips rendering when the context is lost", () => {
    const { gl, canvas, volume, frame } = setup();
    const preview = new VolumePreviewRenderer(canvas, volume);
    gl.isContextLost.mockReturnValue(true);
    preview.draw(0, 0, 1); frame();
    expect(gl.drawArrays).not.toHaveBeenCalled();
    preview.dispose();
  });
});
