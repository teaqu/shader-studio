import type { ShaderCompiler } from '../ShaderCompiler';
import type { PiShader } from '../types/piRenderer';

export interface CaptureUniforms {
  time: number;
  timeDelta: number;
  frameRate: number;
  frame: number;
  res: number[];
  mouse: number[];
  date: number[];
}

interface PendingCapture {
  varName: string;
  varType: string;
  pbo: WebGLBuffer;
  fence: WebGLSync;
  dataSize: number;
}

interface ShaderCacheEntry {
  shader: PiShader;
  lastUsed: number;
}

const SHADER_CACHE_MAX = 20;
const FLOAT_BYTES = 4;
const RGBA_CHANNELS = 4;

export class VariableCapturer {
  private pendingCaptures: PendingCapture[] = [];
  private shaderCache = new Map<string, ShaderCacheEntry>();
  private shaderCacheOrder: string[] = [];

  // PBO pools (keyed by byte size)
  private pboPool = new Map<number, WebGLBuffer[]>();

  // Reusable fullscreen quad VAO
  private quadVao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  constructor(
    private gl: WebGL2RenderingContext,
    private shaderCompiler: ShaderCompiler,
  ) {
    this.initQuad();
    // Enable float texture rendering
    this.gl.getExtension('EXT_color_buffer_float');
  }

  /**
   * Issue N async captures (one per variable) at a specific pixel. Returns immediately.
   * Call collectResults() on next frame to get decoded values.
   */
  issueCaptureAtPixel(
    captures: Array<{ varName: string; varType: string; captureShader: string }>,
    pixelX: number,
    pixelY: number,
    canvasWidth: number,
    canvasHeight: number,
    uniforms: CaptureUniforms,
  ): number {
    if (captures.length === 0) return 0;

    const fbo = this.createFloatFBO(1, 1);
    if (!fbo) return 0;

    // WebGL Y-flip: bottom-left origin
    const captureY = canvasHeight - pixelY - 1;
    let issued = 0;

    for (const cap of captures) {
      const piShader = this.getOrCompileShader(cap.captureShader);
      if (!piShader || !piShader.mProgram) continue;

      this.renderCaptureShader(
        piShader,
        fbo,
        1,
        1,
        uniforms,
        canvasWidth,
        canvasHeight,
        { x: pixelX + 0.5, y: captureY + 0.5 }, // pass coord for _dbgCaptureCoord
      );

      const dataSize = 1 * 1 * RGBA_CHANNELS * FLOAT_BYTES; // 16 bytes
      const pbo = this.allocatePBO(dataSize);

      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pbo);
      this.gl.bindFramebuffer(this.gl.READ_FRAMEBUFFER, fbo);
      this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.FLOAT, 0);
      this.gl.bindFramebuffer(this.gl.READ_FRAMEBUFFER, null);
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null);

      const fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      this.gl.flush();

      this.pendingCaptures.push({
        varName: cap.varName,
        varType: cap.varType,
        pbo,
        fence,
        dataSize,
      });
      issued++;
    }

    this.gl.deleteFramebuffer(fbo);
    return issued;
  }

  /**
   * Issue N async captures on a gridSize×gridSize grid covering the full canvas. Returns immediately.
   */
  issueCaptureGrid(
    captures: Array<{ varName: string; varType: string; captureShader: string }>,
    uniforms: CaptureUniforms,
    gridSize: number,
  ): number {
    if (captures.length === 0) return 0;

    const fbo = this.createFloatFBO(gridSize, gridSize);
    if (!fbo) return 0;
    let issued = 0;

    for (const cap of captures) {
      const piShader = this.getOrCompileShader(cap.captureShader);
      if (!piShader || !piShader.mProgram) continue;

      this.renderCaptureShader(
        piShader,
        fbo,
        gridSize,
        gridSize,
        uniforms,
        uniforms.res[0],
        uniforms.res[1],
        null,
      );

      const dataSize = gridSize * gridSize * RGBA_CHANNELS * FLOAT_BYTES;
      const pbo = this.allocatePBO(dataSize);

      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pbo);
      this.gl.bindFramebuffer(this.gl.READ_FRAMEBUFFER, fbo);
      this.gl.readPixels(0, 0, gridSize, gridSize, this.gl.RGBA, this.gl.FLOAT, 0);
      this.gl.bindFramebuffer(this.gl.READ_FRAMEBUFFER, null);
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null);

      const fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      this.gl.flush();

      this.pendingCaptures.push({
        varName: cap.varName,
        varType: cap.varType,
        pbo,
        fence,
        dataSize,
      });
      issued++;
    }

    this.gl.deleteFramebuffer(fbo);
    return issued;
  }

  /**
   * Collect results from pending PBO captures.
   * Returns only the captures whose fence has signaled.
   */
  collectResults(): Array<{ varName: string; varType: string; rgba: Float32Array }> {
    const results: Array<{ varName: string; varType: string; rgba: Float32Array }> = [];
    const remaining: PendingCapture[] = [];

    for (const pending of this.pendingCaptures) {
      const status = this.gl.getSyncParameter(pending.fence, this.gl.SYNC_STATUS);
      if (status === this.gl.SIGNALED) {
        const data = new Float32Array(pending.dataSize / FLOAT_BYTES);
        this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pending.pbo);
        this.gl.getBufferSubData(this.gl.PIXEL_PACK_BUFFER, 0, data);
        this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null);

        this.gl.deleteSync(pending.fence);
        this.releasePBO(pending.pbo, pending.dataSize);

        results.push({
          varName: pending.varName,
          varType: pending.varType,
          rgba: data,
        });
      } else {
        remaining.push(pending);
      }
    }

    this.pendingCaptures = remaining;
    return results;
  }

  dispose(): void {
    // Cancel pending captures
    for (const pending of this.pendingCaptures) {
      this.gl.deleteSync(pending.fence);
      this.gl.deleteBuffer(pending.pbo);
    }
    this.pendingCaptures = [];

    // Release PBO pool
    for (const [, pool] of this.pboPool) {
      for (const pbo of pool) {
        this.gl.deleteBuffer(pbo);
      }
    }
    this.pboPool.clear();

    // Release shader cache
    for (const [, entry] of this.shaderCache) {
      // Note: PiShader destruction would go through the renderer, but we don't have it here.
      // The shaders will be GC'd with the GL context.
      void entry;
    }
    this.shaderCache.clear();

    if (this.quadVao) {
      this.gl.deleteVertexArray(this.quadVao);
      this.quadVao = null;
    }
    if (this.quadBuffer) {
      this.gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }
  }

  private getOrCompileShader(code: string): PiShader | null {
    const existing = this.shaderCache.get(code);
    if (existing) {
      existing.lastUsed = performance.now();
      return existing.shader;
    }

    // LRU eviction
    if (this.shaderCacheOrder.length >= SHADER_CACHE_MAX) {
      const oldest = this.shaderCacheOrder.shift()!;
      this.shaderCache.delete(oldest);
    }

    const piShader = this.shaderCompiler.compileShader(code);
    if (!piShader || !piShader.mProgram) return null;

    this.shaderCache.set(code, { shader: piShader, lastUsed: performance.now() });
    this.shaderCacheOrder.push(code);
    return piShader;
  }

  private createFloatFBO(w: number, h: number): WebGLFramebuffer | null {
    const gl = this.gl;

    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const fbo = gl.createFramebuffer();
    if (!fbo) {
      gl.deleteTexture(texture);
      return null;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(fbo);
      return null;
    }

    // Store texture reference on fbo for cleanup (use a WeakMap pattern via property)
    (fbo as any)._captureTexture = texture;

    return fbo;
  }

  private allocatePBO(byteSize: number): WebGLBuffer {
    const pool = this.pboPool.get(byteSize);
    if (pool && pool.length > 0) {
      return pool.pop()!;
    }

    const pbo = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pbo);
    this.gl.bufferData(this.gl.PIXEL_PACK_BUFFER, byteSize, this.gl.STREAM_READ);
    this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null);
    return pbo;
  }

  private releasePBO(pbo: WebGLBuffer, byteSize: number): void {
    if (!this.pboPool.has(byteSize)) {
      this.pboPool.set(byteSize, []);
    }
    this.pboPool.get(byteSize)!.push(pbo);
  }

  private initQuad(): void {
    const gl = this.gl;

    // Full-screen triangle (covers NDC [-1, 1] × [-1, 1])
    const vertices = new Float32Array([
      -1, -1,
       3, -1,
      -1,  3,
    ]);

    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.quadVao = gl.createVertexArray()!;
  }

  private renderCaptureShader(
    piShader: PiShader,
    fbo: WebGLFramebuffer,
    width: number,
    height: number,
    uniforms: CaptureUniforms,
    canvasWidth: number,
    canvasHeight: number,
    captureCoord: { x: number; y: number } | null,
  ): void {
    const gl = this.gl;
    const program = piShader.mProgram!;

    // Save current GL state
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const prevViewport = gl.getParameter(gl.VIEWPORT);
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);

    // Set uniforms
    gl.uniform3fv(gl.getUniformLocation(program, 'iResolution'), [canvasWidth, canvasHeight, 1.0]);
    gl.uniform1f(gl.getUniformLocation(program, 'iTime'), uniforms.time);
    gl.uniform1f(gl.getUniformLocation(program, 'iTimeDelta'), uniforms.timeDelta);
    gl.uniform1f(gl.getUniformLocation(program, 'iFrameRate'), uniforms.frameRate);
    gl.uniform1i(gl.getUniformLocation(program, 'iFrame'), uniforms.frame);
    gl.uniform4fv(gl.getUniformLocation(program, 'iMouse'), uniforms.mouse);
    gl.uniform4fv(gl.getUniformLocation(program, 'iDate'), uniforms.date);

    if (captureCoord !== null) {
      const loc = gl.getUniformLocation(program, '_dbgCaptureCoord');
      if (loc !== null) {
        gl.uniform2f(loc, captureCoord.x, captureCoord.y);
      }
    }

    // Draw fullscreen triangle
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const posLoc = gl.getAttribLocation(program, 'position');
    if (posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (posLoc >= 0) {
      gl.disableVertexAttribArray(posLoc);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);

    // Restore state
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    gl.useProgram(prevProgram);
    gl.bindVertexArray(prevVao);
  }
}
