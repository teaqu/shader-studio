import type { VrEyeView } from "./WebXrFrameData";

const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  vec2 position = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D eye;
in vec2 uv;
out vec4 color;
void main() {
  color = vec4(texture(eye, uv).rgb, 1.0);
}`;

/**
 * Copies an eye image rendered by another API (WebGPU) into its XRWebGLLayer
 * viewport. WebXR's WebGPU binding is not broadly available, so the layer
 * stays WebGL2 and receives each eye as a texture upload.
 */
export class WebXrEyeCompositor {
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  draw(framebuffer: WebGLFramebuffer | null, viewport: VrEyeView["viewport"], source: TexImageSource): void {
    const gl = this.gl;
    this.ensureResources();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Canvas rows run top-down; GL textures start at the bottom.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.program) {
      gl.deleteProgram(this.program);
    }
    if (this.texture) {
      gl.deleteTexture(this.texture);
    }
    if (this.vao) {
      gl.deleteVertexArray(this.vao);
    }
    this.program = null;
    this.texture = null;
    this.vao = null;
  }

  private ensureResources(): void {
    if (this.program && this.texture && this.vao) {
      return;
    }
    const gl = this.gl;
    const program = gl.createProgram();
    const shaders = [compile(gl, gl.VERTEX_SHADER, VERTEX), compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)];
    for (const shader of shaders) {
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    for (const shader of shaders) {
      gl.deleteShader(shader);
    }
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`VR eye compositor failed to link: ${log ?? "unknown error"}`);
    }
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "eye"), 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.program = program;
    this.texture = texture;
    this.vao = gl.createVertexArray();
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("VR eye compositor could not create a shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`VR eye compositor failed to compile: ${log ?? "unknown error"}`);
  }
  return shader;
}
