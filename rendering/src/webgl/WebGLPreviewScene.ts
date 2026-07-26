import { OrbitCamera } from '../preview3d/OrbitCamera';
import { createAxesMesh, createGridMesh, createPreviewMesh, getPreviewMeshGroundOffset, type LineMesh, type PreviewMesh } from '../preview3d/meshes';
import { createModelMatrix, createNormalMatrix3, multiplyMatrices } from '../preview3d/math';
import type { PreviewMeshKind, PreviewSettings } from '../preview3d/types';

interface Resources { vao: WebGLVertexArrayObject; vertexBuffer: WebGLBuffer; indexBuffer: WebGLBuffer; indexCount: number; }

/** Owns raw geometry and editor-aid resources for WebGL's final mesh pass. */
export class WebGLPreviewScene {
  private readonly camera = new OrbitCamera();
  private meshKind: PreviewMeshKind | null = null;
  private mesh: Resources | null = null;
  private grid: Resources | null = null;
  private axes: Resources | null = null;
  private lineProgram: WebGLProgram | null = null;
  private disposed = false;
  private lastError: string | null = null;
  private lineProgramError: string | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  setInputEnabled(enabled: boolean): void {
    this.camera.setInputEnabled(enabled);
  }
  attachInput(canvas: HTMLCanvasElement): void {
    this.camera.attach(canvas);
  }
  detachInput(): void {
    this.camera.detach();
  }
  resetCamera(): void {
    this.camera.reset();
  }

  /** Returns the most recent recoverable scene error exactly once. */
  consumeError(): string | null {
    const error = this.lastError;
    this.lastError = null;
    return error;
  }

  render(program: WebGLProgram, settings: PreviewSettings, width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) {
      return;
    }
    try {
      this.ensureMesh(settings.mesh); this.ensureLines(settings);
      if (!this.mesh) {
        return;
      }
      const projection = this.camera.getProjectionMatrix(width / height); const view = this.camera.getViewMatrix();
      const model = createModelMatrix({ ...settings.object, position: [settings.object.position[0], settings.object.position[1] + getPreviewMeshGroundOffset(settings.mesh) * settings.object.scale[1], settings.object.position[2]] });
      const gl = this.gl;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.clear(gl.DEPTH_BUFFER_BIT);
      this.drawLines(projection, view, settings);
      gl.useProgram(program);
      this.matrix(program, 'uPreviewModel', model); this.matrix(program, 'uPreviewView', view); this.matrix(program, 'uPreviewProjection', projection); this.matrix3(program, 'uPreviewNormalMatrix', createNormalMatrix3(model));
      this.vec2(program, 'uPreviewUvScale', settings.mapping.scale); this.vec2(program, 'uPreviewUvOffset', settings.mapping.offset);
      this.float(program, 'uPreviewUvRotation', settings.mapping.rotation);
      this.int(program, 'uPreviewWrapMode', settings.mapping.wrap === 'mirror' ? 1 : settings.mapping.wrap === 'clamp' ? 2 : 0);
      this.int(program, 'uPreviewLit', settings.lighting === 'lit' ? 1 : 0);
      gl.bindVertexArray(this.mesh.vao); gl.drawElements(gl.TRIANGLES, this.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : `WebGL preview scene failed: ${String(error)}`;
    } finally {
      // The next 2D frame must never inherit partially-bound 3D state.
      this.gl.bindVertexArray(null);
      this.gl.useProgram(null);
      this.gl.disable(this.gl.DEPTH_TEST);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true; this.camera.detach(); this.delete(this.mesh); this.delete(this.grid); this.delete(this.axes);
    if (this.lineProgram) {
      this.gl.deleteProgram(this.lineProgram);
    }
    this.mesh = this.grid = this.axes = null; this.lineProgram = null;
  }

  private ensureMesh(kind: PreviewMeshKind): void {
    if (this.mesh && this.meshKind === kind) {
      return;
    }
    this.delete(this.mesh); this.mesh = this.uploadMesh(createPreviewMesh(kind)); this.meshKind = kind;
  }
  private ensureLines(settings: PreviewSettings): void {
    if (!settings.scene.grid && !settings.scene.axes) {
      return;
    }
    if (!this.grid) {
      this.grid = this.uploadLines(createGridMesh());
    }
    if (!this.axes) {
      this.axes = this.uploadLines(createAxesMesh());
    }
    if (!this.lineProgram) {
      this.lineProgram = this.createLineProgram();
    }
    if (!this.lineProgram) {
      throw new Error(this.lineProgramError ?? 'Unable to create WebGL preview line shader');
    }
  }
  private uploadMesh(mesh: PreviewMesh): Resources {
    const data = new Float32Array(mesh.positions.length / 3 * 8);
    for (let i = 0; i < mesh.positions.length / 3; i += 1) {
      data.set(mesh.positions.subarray(i * 3, i * 3 + 3), i * 8); data.set(mesh.normals.subarray(i * 3, i * 3 + 3), i * 8 + 3); data.set(mesh.uvs.subarray(i * 2, i * 2 + 2), i * 8 + 6);
    }
    return this.upload(data, mesh.indices, [[0, 3, 0], [1, 3, 12], [2, 2, 24]], 32);
  }
  private uploadLines(mesh: LineMesh): Resources {
    const data = new Float32Array(mesh.positions.length / 3 * 6);
    for (let i = 0; i < mesh.positions.length / 3; i += 1) {
      data.set(mesh.positions.subarray(i * 3, i * 3 + 3), i * 6); data.set(mesh.colors.subarray(i * 3, i * 3 + 3), i * 6 + 3);
    }
    return this.upload(data, mesh.indices, [[0, 3, 0], [1, 3, 12]], 24);
  }
  private upload(data: Float32Array, indices: Uint16Array, attributes: readonly (readonly [number, number, number])[], stride: number): Resources {
    const gl = this.gl; const vao = gl.createVertexArray(); const vertexBuffer = gl.createBuffer(); const indexBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer || !indexBuffer) {
      if (vao) {
        gl.deleteVertexArray(vao);
      }
      if (vertexBuffer) {
        gl.deleteBuffer(vertexBuffer);
      }
      if (indexBuffer) {
        gl.deleteBuffer(indexBuffer);
      }
      throw new Error('Unable to allocate WebGL preview geometry');
    }
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    for (const [location, size, offset] of attributes) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    }
    gl.bindVertexArray(null); return { vao, vertexBuffer, indexBuffer, indexCount: indices.length };
  }
  private drawLines(projection: Float32Array, view: Float32Array, settings: PreviewSettings): void {
    if (!this.lineProgram) {
      return;
    }
    const gl = this.gl; gl.useProgram(this.lineProgram); this.matrix(this.lineProgram, 'uProjectionView', multiplyMatrices(projection, view));
    if (settings.scene.grid && this.grid) {
      gl.bindVertexArray(this.grid.vao); gl.drawElements(gl.LINES, this.grid.indexCount, gl.UNSIGNED_SHORT, 0);
    }
    if (settings.scene.axes && this.axes) {
      gl.bindVertexArray(this.axes.vao); gl.drawElements(gl.LINES, this.axes.indexCount, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }
  private createLineProgram(): WebGLProgram | null {
    const gl = this.gl;
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) {
        return null;
      }
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        return shader;
      }
      gl.deleteShader(shader);
      return null;
    };
    const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nlayout(location=0) in vec3 position; layout(location=1) in vec3 color; uniform mat4 uProjectionView; out vec3 vColor; void main(){ vColor=color; gl_Position=uProjectionView*vec4(position,1.0); }');
    const fragment = compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; in vec3 vColor; out vec4 fragColor; void main(){ fragColor=vec4(vColor,1.0); }');
    if (!vertex || !fragment) {
      if (vertex) {
        gl.deleteShader(vertex);
      }
      if (fragment) {
        gl.deleteShader(fragment);
      }
      this.lineProgramError = 'WebGL preview line shader compilation failed';
      return null;
    }
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      this.lineProgramError = 'Unable to allocate WebGL preview line shader program';
      return null;
    }
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      this.lineProgramError = 'WebGL preview line shader link failed';
      return null;
    }
    this.lineProgramError = null;
    return program;
  }
  private delete(resource: Resources | null): void {
    if (!resource) {
      return;
    } this.gl.deleteVertexArray(resource.vao); this.gl.deleteBuffer(resource.vertexBuffer); this.gl.deleteBuffer(resource.indexBuffer);
  }
  private matrix(program: WebGLProgram, name: string, value: Float32Array): void {
    const location = this.gl.getUniformLocation(program, name); if (location) {
      this.gl.uniformMatrix4fv(location, false, value);
    }
  }
  private matrix3(program: WebGLProgram, name: string, value: Float32Array): void {
    const location = this.gl.getUniformLocation(program, name); if (location) {
      this.gl.uniformMatrix3fv(location, false, value);
    }
  }
  private vec2(program: WebGLProgram, name: string, value: readonly [number, number]): void {
    const location = this.gl.getUniformLocation(program, name); if (location) {
      this.gl.uniform2f(location, value[0], value[1]);
    }
  }
  private float(program: WebGLProgram, name: string, value: number): void {
    const location = this.gl.getUniformLocation(program, name); if (location) {
      this.gl.uniform1f(location, value);
    }
  }
  private int(program: WebGLProgram, name: string, value: number): void {
    const location = this.gl.getUniformLocation(program, name); if (location) {
      this.gl.uniform1i(location, value);
    }
  }
}
