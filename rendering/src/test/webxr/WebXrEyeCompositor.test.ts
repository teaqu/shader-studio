import { describe, expect, it, vi } from "vitest";
import { WebXrEyeCompositor } from "../../webxr/WebXrEyeCompositor";

function gl(overrides: Record<string, unknown> = {}) {
  return {
    FRAMEBUFFER: 1, SCISSOR_TEST: 2, BLEND: 3, DEPTH_TEST: 4, TEXTURE0: 5, TEXTURE_2D: 6, UNPACK_FLIP_Y_WEBGL: 7,
    RGBA: 8, UNSIGNED_BYTE: 9, TRIANGLES: 10, VERTEX_SHADER: 11, FRAGMENT_SHADER: 12, LINK_STATUS: 13,
    COMPILE_STATUS: 14, TEXTURE_MIN_FILTER: 15, TEXTURE_MAG_FILTER: 16, LINEAR: 17, TEXTURE_WRAP_S: 18,
    TEXTURE_WRAP_T: 19, CLAMP_TO_EDGE: 20,
    createProgram: vi.fn(() => "program"), createShader: vi.fn((type: number) => `shader-${type}`),
    shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: vi.fn(() => true), getShaderInfoLog: vi.fn(() => "bad shader"),
    attachShader: vi.fn(), linkProgram: vi.fn(), deleteShader: vi.fn(), getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => "bad link"), deleteProgram: vi.fn(), useProgram: vi.fn(), uniform1i: vi.fn(),
    getUniformLocation: vi.fn(() => "eye-location"), createTexture: vi.fn(() => "texture"), bindTexture: vi.fn(),
    texParameteri: vi.fn(), createVertexArray: vi.fn(() => "vao"), bindFramebuffer: vi.fn(), viewport: vi.fn(),
    disable: vi.fn(), activeTexture: vi.fn(), pixelStorei: vi.fn(), texImage2D: vi.fn(), bindVertexArray: vi.fn(),
    drawArrays: vi.fn(), deleteTexture: vi.fn(), deleteVertexArray: vi.fn(),
    ...overrides,
  };
}

const source = { tag: "eye-canvas" } as unknown as TexImageSource;

describe("WebXrEyeCompositor", () => {
  it("uploads the eye upright and draws one triangle into its layer viewport", () => {
    const context = gl();
    const compositor = new WebXrEyeCompositor(context as unknown as WebGL2RenderingContext);
    compositor.draw("layer" as unknown as WebGLFramebuffer, { x: 10, y: 0, width: 20, height: 30 }, source);
    expect(context.bindFramebuffer).toHaveBeenCalledWith(1, "layer");
    expect(context.viewport).toHaveBeenCalledWith(10, 0, 20, 30);
    expect(context.disable).toHaveBeenCalledWith(2);
    expect(context.pixelStorei).toHaveBeenNthCalledWith(1, 7, true);
    expect(context.texImage2D).toHaveBeenCalledWith(6, 0, 8, 8, 9, source);
    expect(context.pixelStorei).toHaveBeenLastCalledWith(7, false);
    expect(context.uniform1i).toHaveBeenCalledWith("eye-location", 0);
    expect(context.drawArrays).toHaveBeenCalledWith(10, 0, 3);
    expect(context.bindVertexArray).toHaveBeenLastCalledWith(null);
  });

  it("creates its program, texture, and vertex array once", () => {
    const context = gl();
    const compositor = new WebXrEyeCompositor(context as unknown as WebGL2RenderingContext);
    compositor.draw(null, { x: 0, y: 0, width: 1, height: 1 }, source);
    compositor.draw(null, { x: 1, y: 0, width: 1, height: 1 }, source);
    expect(context.createProgram).toHaveBeenCalledOnce();
    expect(context.createTexture).toHaveBeenCalledOnce();
    expect(context.createVertexArray).toHaveBeenCalledOnce();
    expect(context.deleteShader).toHaveBeenCalledTimes(2);
    expect(context.texImage2D).toHaveBeenCalledTimes(2);
  });

  it("reports shader compilation and link failures", () => {
    const compileFailure = gl({ getShaderParameter: vi.fn(() => false) });
    expect(() => new WebXrEyeCompositor(compileFailure as unknown as WebGL2RenderingContext).draw(null, { x: 0, y: 0, width: 1, height: 1 }, source))
      .toThrow("failed to compile: bad shader");
    expect(compileFailure.deleteShader).toHaveBeenCalledWith("shader-11");

    const silentFailure = gl({ getShaderParameter: vi.fn(() => false), getShaderInfoLog: vi.fn(() => null) });
    expect(() => new WebXrEyeCompositor(silentFailure as unknown as WebGL2RenderingContext).draw(null, { x: 0, y: 0, width: 1, height: 1 }, source))
      .toThrow("failed to compile: unknown error");

    const missingShader = gl({ createShader: vi.fn(() => null) });
    expect(() => new WebXrEyeCompositor(missingShader as unknown as WebGL2RenderingContext).draw(null, { x: 0, y: 0, width: 1, height: 1 }, source))
      .toThrow("could not create a shader");

    const linkFailure = gl({ getProgramParameter: vi.fn(() => false), getProgramInfoLog: vi.fn(() => null) });
    expect(() => new WebXrEyeCompositor(linkFailure as unknown as WebGL2RenderingContext).draw(null, { x: 0, y: 0, width: 1, height: 1 }, source))
      .toThrow("failed to link: unknown error");
    expect(linkFailure.deleteProgram).toHaveBeenCalledWith("program");
  });

  it("deletes created resources on dispose and tolerates repeated disposal", () => {
    const context = gl();
    const compositor = new WebXrEyeCompositor(context as unknown as WebGL2RenderingContext);
    compositor.dispose();
    expect(context.deleteProgram).not.toHaveBeenCalled();
    compositor.draw(null, { x: 0, y: 0, width: 1, height: 1 }, source);
    compositor.dispose();
    compositor.dispose();
    expect(context.deleteProgram).toHaveBeenCalledOnce();
    expect(context.deleteTexture).toHaveBeenCalledWith("texture");
    expect(context.deleteVertexArray).toHaveBeenCalledWith("vao");
  });
});
