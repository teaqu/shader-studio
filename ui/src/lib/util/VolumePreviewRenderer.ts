import { volumeRgba, type VolumeTextureData } from "@shader-studio/types";

const vertexSource = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const fragmentSource = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uVolume;
uniform vec3 uBounds;
uniform vec3 uCamera;
uniform float uRedOnly;
out vec4 color;
void main() {
  float cy = cos(uCamera.x), sy = sin(uCamera.x);
  float cp = cos(uCamera.y), sp = sin(uCamera.y);
  vec3 right = vec3(cy, 0.0, -sy);
  vec3 up = vec3(sy * sp, cp, cy * sp);
  vec3 direction = vec3(-sy * cp, sp, -cy * cp);
  vec2 uv = (gl_FragCoord.xy / 192.0 - 0.5) * 1.8 / uCamera.z;
  vec3 origin = right * uv.x + up * uv.y - direction * 2.0;
  float near = 0.0, far = 4.0;
  for (int i = 0; i < 3; i++) {
    if (abs(direction[i]) < 0.000001) {
      if (abs(origin[i]) > uBounds[i]) { far = -1.0; }
    } else {
      float a = (-uBounds[i] - origin[i]) / direction[i];
      float b = (uBounds[i] - origin[i]) / direction[i];
      near = max(near, min(a, b)); far = min(far, max(a, b));
    }
  }
  vec3 accumulated = vec3(0.0);
  float opacity = 0.0;
  const float stepSize = 1.0 / 96.0;
  for (int i = 0; i < 168; i++) {
    float t = near + (float(i) + 0.5) * stepSize;
    if (t >= far || opacity >= 0.98) { break; }
    vec4 voxel = texture(uVolume, (origin + direction * t) / (uBounds * 2.0) + 0.5);
    float density = mix(voxel.a, voxel.r, uRedOnly);
    float alpha = (1.0 - exp(-density * stepSize * 8.0)) * (1.0 - opacity);
    accumulated += alpha * mix(voxel.rgb, vec3(235.0 / 255.0), uRedOnly);
    opacity += alpha;
  }
  color = vec4(accumulated + (1.0 - opacity) * vec3(24.0, 24.0, 32.0) / 255.0, 1.0);
}`;

/** Dedicated, on-demand GPU preview. Owns its texture, frame scheduling and cleanup. */
export class VolumePreviewRenderer {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private frame: number | null = null;
  private camera = [0.6, 0.35, 1];
  private disposed = false;
  private cameraLocation: WebGLUniformLocation | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, volume: VolumeTextureData) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) {
      throw new Error("3D preview requires WebGL 2. Use Slices to inspect this volume.");
    }
    this.gl = gl;
    const shaders: WebGLShader[] = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
        const shader = gl.createShader(type);
        if (!shader) {
          throw new Error("Could not allocate preview shader");
        }
        shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) || "Preview shader compilation failed");
        }
      }
      this.program = gl.createProgram();
      if (!this.program) {
        throw new Error("Could not allocate preview program");
      }
      shaders.forEach(shader => gl.attachShader(this.program!, shader));
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.program) || "Preview shader linking failed");
      }
      if (Math.max(volume.width, volume.height, volume.depth) > gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)) {
        throw new Error("Volume exceeds the GPU preview size limit. Use Slices instead.");
      }
      this.texture = gl.createTexture();
      if (!this.texture) {
        throw new Error("Could not allocate preview texture");
      }
      gl.bindTexture(gl.TEXTURE_3D, this.texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, volume.width, volume.height, volume.depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, volumeRgba(volume));
      if (gl.getError() !== gl.NO_ERROR) {
        throw new Error("Could not upload the volume for GPU preview. Use Slices instead.");
      }
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
        gl.texParameteri(gl.TEXTURE_3D, wrap, gl.CLAMP_TO_EDGE);
      }
      canvas.width = canvas.height = 192;
      gl.useProgram(this.program);
      gl.uniform1i(gl.getUniformLocation(this.program, "uVolume"), 0);
      const scale = Math.max(volume.width, volume.height, volume.depth) * 2;
      gl.uniform3f(gl.getUniformLocation(this.program, "uBounds"), volume.width / scale, volume.height / scale, volume.depth / scale);
      gl.uniform1f(gl.getUniformLocation(this.program, "uRedOnly"), volume.channels === 1 ? 1 : 0);
      this.cameraLocation = gl.getUniformLocation(this.program, "uCamera");
    } catch (error) {
      this.dispose(); throw error;
    } finally {
      shaders.forEach(shader => gl.deleteShader(shader));
    }
  }

  draw(yaw: number, pitch: number, zoom: number): void {
    if (this.disposed) {
      return;
    }
    this.camera = [yaw, pitch, zoom];
    if (this.frame !== null) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const gl = this.gl;
      if (this.disposed || gl.isContextLost()) {
        return;
      }
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.texture);
      gl.uniform3f(this.cameraLocation, this.camera[0], this.camera[1], this.camera[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame); this.frame = null;
    }
    if (this.texture) {
      this.gl.deleteTexture(this.texture);
    }
    if (this.program) {
      this.gl.deleteProgram(this.program);
    }
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
