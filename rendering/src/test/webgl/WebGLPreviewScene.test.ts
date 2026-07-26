import { describe, expect, it, vi } from 'vitest';
import { WebGLPreviewScene } from '../../webgl/WebGLPreviewScene';
import { createDefaultPreviewSettings } from '../../preview3d/types';

function createGl() {
  let id = 0;
  return {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    TRIANGLES: 0x0004,
    LINES: 0x0001,
    DEPTH_TEST: 0x0b71,
    LEQUAL: 0x0203,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    createBuffer: vi.fn(() => ({ id: ++id })),
    bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn(),
    createVertexArray: vi.fn(() => ({ id: ++id })),
    bindVertexArray: vi.fn(), deleteVertexArray: vi.fn(),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    getAttribLocation: vi.fn((_program, name) => name === 'position' ? 0 : name === 'normal' ? 1 : 2),
    createShader: vi.fn(() => ({ id: ++id })), shaderSource: vi.fn(), compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true), createProgram: vi.fn(() => ({ id: ++id })),
    attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true), deleteShader: vi.fn(), deleteProgram: vi.fn(),
    getUniformLocation: vi.fn((_program, name) => ({ name })),
    uniformMatrix4fv: vi.fn(), uniformMatrix3fv: vi.fn(), uniform2f: vi.fn(), uniform1f: vi.fn(), uniform1i: vi.fn(), uniform3f: vi.fn(),
    useProgram: vi.fn(), drawElements: vi.fn(), enable: vi.fn(), disable: vi.fn(), depthFunc: vi.fn(), clear: vi.fn(),
  } as unknown as WebGL2RenderingContext;
}

describe('WebGLPreviewScene', () => {
  it('uploads indexed meshes and renders grid, object, and axes with depth', () => {
    const gl = createGl();
    const scene = new WebGLPreviewScene(gl);
    const settings = createDefaultPreviewSettings();
    const program = {} as WebGLProgram;

    scene.render(program, settings, 800, 600);

    expect(gl.enable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    expect(gl.depthFunc).toHaveBeenCalledWith(gl.LEQUAL);
    expect(gl.clear).toHaveBeenCalledWith(gl.DEPTH_BUFFER_BIT);
    expect(gl.drawElements).toHaveBeenCalledWith(gl.LINES, expect.any(Number), gl.UNSIGNED_SHORT, 0);
    expect(gl.drawElements).toHaveBeenCalledWith(gl.TRIANGLES, expect.any(Number), gl.UNSIGNED_SHORT, 0);
    expect(gl.uniformMatrix3fv).toHaveBeenCalled();
    expect(gl.bindVertexArray).toHaveBeenCalledWith(null);
    expect(gl.disable).toHaveBeenCalledWith(gl.DEPTH_TEST);
  });

  it('switches mesh resources and releases all WebGL allocations on disposal', () => {
    const gl = createGl();
    const scene = new WebGLPreviewScene(gl);
    const program = {} as WebGLProgram;
    scene.render(program, createDefaultPreviewSettings(), 800, 600);
    const sphere = createDefaultPreviewSettings();
    const sphereSettings = { ...sphere, mesh: 'sphere' as const };

    scene.render(program, sphereSettings, 800, 600);
    scene.dispose();

    expect(gl.deleteBuffer).toHaveBeenCalled();
    expect(gl.deleteVertexArray).toHaveBeenCalled();
  });

  it('contains partial mesh allocation failures and releases allocations already made', () => {
    const gl = createGl();
    vi.mocked(gl.createBuffer).mockReturnValueOnce({ id: 1 } as WebGLBuffer).mockReturnValueOnce(null);
    const scene = new WebGLPreviewScene(gl);

    expect(() => scene.render({} as WebGLProgram, createDefaultPreviewSettings(), 800, 600)).not.toThrow();
    expect(scene.consumeError()).toContain('Unable to allocate WebGL preview geometry');
    expect(gl.deleteBuffer).toHaveBeenCalledWith({ id: 1 });
  });

  it('does not allocate scene resources for a zero-sized canvas', () => {
    const gl = createGl();
    const scene = new WebGLPreviewScene(gl);

    scene.render({} as WebGLProgram, createDefaultPreviewSettings(), 0, 600);

    expect(gl.createBuffer).not.toHaveBeenCalled();
    expect(scene.consumeError()).toBeNull();
  });

  it('restores VAO, program, and depth state after a mesh uniform throws', () => {
    const gl = createGl();
    vi.mocked(gl.uniformMatrix4fv).mockImplementationOnce(() => {
      throw new Error('uniform upload failed');
    });
    const scene = new WebGLPreviewScene(gl);

    scene.render({} as WebGLProgram, createDefaultPreviewSettings(), 800, 600);

    expect(scene.consumeError()).toBe('uniform upload failed');
    expect(gl.bindVertexArray).toHaveBeenLastCalledWith(null);
    expect(gl.useProgram).toHaveBeenLastCalledWith(null);
    expect(gl.disable).toHaveBeenCalledWith(gl.DEPTH_TEST);
    scene.render({} as WebGLProgram, createDefaultPreviewSettings(), 800, 600);
    expect(gl.drawElements).toHaveBeenCalledWith(gl.TRIANGLES, expect.any(Number), gl.UNSIGNED_SHORT, 0);
  });

  it('cleans shaders and reports a requested line-scene fragment compile failure', () => {
    const gl = createGl();
    vi.mocked(gl.getShaderParameter).mockReturnValueOnce(true).mockReturnValueOnce(false);
    const scene = new WebGLPreviewScene(gl);

    scene.render({} as WebGLProgram, createDefaultPreviewSettings(), 800, 600);

    expect(scene.consumeError()).toContain('line shader compilation failed');
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('cleans shaders and program on a line-scene link failure', () => {
    const gl = createGl();
    vi.mocked(gl.getProgramParameter).mockReturnValue(false);
    const scene = new WebGLPreviewScene(gl);

    scene.render({} as WebGLProgram, createDefaultPreviewSettings(), 800, 600);

    expect(scene.consumeError()).toContain('line shader link failed');
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  });
});
