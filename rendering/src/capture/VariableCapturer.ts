import type { ShaderCompiler, ChannelSamplerType } from '../ShaderCompiler';
import type { PiShader } from '../types/piRenderer';
import type { PiTexture } from '../types/piRenderer';
import type { SlotAssignment } from '../util/InputSlotAssigner';
import type { ConfigInput } from '@shader-studio/types';
import { bindTextures } from '../util/TextureBinder';

export interface CaptureUniforms {
  time: number;
  timeDelta: number;
  frameRate: number;
  frame: number;
  res: number[];
  mouse: number[];
  date: number[];
  cameraPos: number[];
  cameraDir: number[];
}

export interface CaptureCustomUniform {
  name: string;
  type: string;
  value: number | number[] | boolean;
}

export interface CaptureCompileContext {
  commonCode?: string;
  slotAssignments?: SlotAssignment[];
  channelTypes?: ChannelSamplerType[];
}

interface PendingCapture {
  varName: string;
  varType: string;
  pbo: WebGLBuffer;
  fence: WebGLSync;
  dataSize: number;
}

interface CaptureRequest {
  varName: string;
  varType: string;
  captureShader: string;
  selectorIndex?: number;
}

interface ShaderCacheEntry {
  shader: PiShader;
  lastUsed: number;
}

type CaptureContinuation = () => boolean;

const SHADER_CACHE_MAX = 20;
const FLOAT_BYTES = 4;
const RGBA_CHANNELS = 4;

export class VariableCapturer {
  private static nextCaptureRequestId = 1;
  private pendingCaptures: PendingCapture[] = [];
  private shaderCache = new Map<string, ShaderCacheEntry>();
  private shaderCacheOrder: string[] = [];

  // PBO pools (keyed by byte size)
  private pboPool = new Map<number, WebGLBuffer[]>();

  // Reusable fullscreen quad VAO
  private quadVao: WebGLVertexArrayObject | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  // Custom uniform state for capture shaders
  private customUniformDeclarations = '';
  private customUniforms: CaptureCustomUniform[] = [];
  private inputBindings: (PiTexture | null)[] = [];
  private compileContext: CaptureCompileContext = {};
  private lastError: string | null = null;
  private fboTextures = new WeakMap<WebGLFramebuffer, WebGLTexture>();

  constructor(
    private gl: WebGL2RenderingContext,
    private shaderCompiler: ShaderCompiler,
    compileContext: CaptureCompileContext = {},
    private resolveInputBindings?: (inputConfig: Record<string, ConfigInput>) => (PiTexture | null)[],
  ) {
    this.compileContext = compileContext;
    this.initQuad();
    // Enable float texture rendering
    this.gl.getExtension('EXT_color_buffer_float');
  }

  setCompileContext(context: CaptureCompileContext): void {
    const nextCommonCode = context.commonCode || '';
    const nextAssignments = JSON.stringify(context.slotAssignments || []);
    const nextTypes = JSON.stringify(context.channelTypes || []);
    const currentCommonCode = this.compileContext.commonCode || '';
    const currentAssignments = JSON.stringify(this.compileContext.slotAssignments || []);
    const currentTypes = JSON.stringify(this.compileContext.channelTypes || []);

    if (
      nextCommonCode !== currentCommonCode ||
      nextAssignments !== currentAssignments ||
      nextTypes !== currentTypes
    ) {
      this.shaderCache.clear();
      this.shaderCacheOrder = [];
    }

    this.compileContext = context;
  }

  /**
   * Set custom uniform declarations and current values for capture shader compilation/rendering.
   */
  setCustomUniforms(declarations: string, uniforms: CaptureCustomUniform[]): void {
    if (declarations !== this.customUniformDeclarations) {
      // Declarations changed — invalidate shader cache since compiled shaders are stale
      this.shaderCache.clear();
      this.shaderCacheOrder = [];
    }
    this.customUniformDeclarations = declarations;
    this.customUniforms = uniforms;
  }

  setInputBindings(inputConfig: Record<string, ConfigInput>): void {
    this.inputBindings = this.resolveInputBindings?.(inputConfig) ?? [];
  }

  clearLastError(): void {
    this.lastError = null;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Issue async variable captures at a specific pixel. Returns immediately.
   * Call collectResults() on next frame to get decoded values.
   */
  async issueCaptureAtPixel(
    captures: CaptureRequest[],
    pixelX: number,
    pixelY: number,
    canvasWidth: number,
    canvasHeight: number,
    uniforms: CaptureUniforms,
    shouldContinue: CaptureContinuation = () => true,
  ): Promise<number> {
    this.clearLastError();
    if (captures.length === 0) return 0;

    const requestId = VariableCapturer.nextCaptureRequestId++;
    const preExistingErrors = this.drainGlErrors();
    if (preExistingErrors.length > 0) {
      console.warn('[VariableCapture] pre-existing GL errors at issue start', { requestId, preExistingErrors });
    }
    const startedAt = performance.now();
    const fbo = this.createFloatFBO(1, 1);
    if (!fbo) {
      console.error('[VariableCapture] issue pixel failed', {
        requestId,
        reason: 'float-fbo-create',
        elapsedMs: this.roundElapsed(performance.now() - startedAt),
        glError: this.readGlError(),
      });
      return 0;
    }

    // WebGL Y-flip: bottom-left origin
    const captureY = canvasHeight - pixelY - 1;
    let issued = 0;
    const requestShaderResults = new Map<string, PiShader | null>();

    for (const cap of captures) {
      if (!shouldContinue()) break;

      try {
        const hasRequestShaderResult = requestShaderResults.has(cap.captureShader);
        const wasCacheMiss = !hasRequestShaderResult && !this.shaderCache.has(cap.captureShader);
        if (wasCacheMiss) {
          if (this.gl.isContextLost()) break;
          await this.nextFrame();
          if (!shouldContinue() || this.gl.isContextLost()) break;
        }
        if (this.gl.isContextLost()) break;
        let piShader = requestShaderResults.get(cap.captureShader) ?? null;
        if (!hasRequestShaderResult) {
          try {
            piShader = await this.getOrCompileShader(cap.captureShader, requestId, cap.varName);
            requestShaderResults.set(cap.captureShader, piShader);
          } catch (error) {
            requestShaderResults.set(cap.captureShader, null);
            throw error;
          }
        }
        if (!shouldContinue() || this.gl.isContextLost()) break;
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
          cap.selectorIndex,
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
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        console.error(`[VariableCapture] Failed pixel capture for ${cap.varName}:`, error, {
          requestId,
          glError: this.readGlError(),
        });
        continue;
      }
    }

    this.deleteFBOWithTexture(fbo);
    return issued;
  }

  /**
   * Issue N async captures on a gridWidth×gridHeight grid covering the full canvas. Returns immediately.
   */
  async issueCaptureGrid(
    captures: CaptureRequest[],
    uniforms: CaptureUniforms,
    gridWidth: number,
    gridHeight: number,
    shouldContinue: CaptureContinuation = () => true,
  ): Promise<number> {
    this.clearLastError();
    if (captures.length === 0) return 0;

    const requestId = VariableCapturer.nextCaptureRequestId++;
    const preExistingErrors = this.drainGlErrors();
    if (preExistingErrors.length > 0) {
      console.warn('[VariableCapture] pre-existing GL errors at issue start', { requestId, preExistingErrors });
    }
    const startedAt = performance.now();
    const fbo = this.createFloatFBO(gridWidth, gridHeight);
    if (!fbo) {
      console.error('[VariableCapture] issue grid failed', {
        requestId,
        reason: 'float-fbo-create',
        gridWidth,
        gridHeight,
        elapsedMs: this.roundElapsed(performance.now() - startedAt),
        glError: this.readGlError(),
      });
      return 0;
    }
    let issued = 0;
    const requestShaderResults = new Map<string, PiShader | null>();

    for (const cap of captures) {
      if (!shouldContinue()) break;

      try {
        const hasRequestShaderResult = requestShaderResults.has(cap.captureShader);
        const wasCacheMiss = !hasRequestShaderResult && !this.shaderCache.has(cap.captureShader);
        if (wasCacheMiss) {
          if (this.gl.isContextLost()) break;
          await this.nextFrame();
          if (!shouldContinue() || this.gl.isContextLost()) break;
        }
        if (this.gl.isContextLost()) break;
        let piShader = requestShaderResults.get(cap.captureShader) ?? null;
        if (!hasRequestShaderResult) {
          try {
            piShader = await this.getOrCompileShader(cap.captureShader, requestId, cap.varName);
            requestShaderResults.set(cap.captureShader, piShader);
          } catch (error) {
            requestShaderResults.set(cap.captureShader, null);
            throw error;
          }
        }
        if (!shouldContinue() || this.gl.isContextLost()) break;
        if (!piShader || !piShader.mProgram) continue;

        this.renderCaptureShader(
          piShader,
          fbo,
          gridWidth,
          gridHeight,
          uniforms,
          uniforms.res[0],
          uniforms.res[1],
          null,
          cap.selectorIndex,
        );

        const dataSize = gridWidth * gridHeight * RGBA_CHANNELS * FLOAT_BYTES;
        const pbo = this.allocatePBO(dataSize);

        this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, pbo);
        this.gl.bindFramebuffer(this.gl.READ_FRAMEBUFFER, fbo);
        this.gl.readPixels(0, 0, gridWidth, gridHeight, this.gl.RGBA, this.gl.FLOAT, 0);
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
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        console.error(`[VariableCapture] Failed grid capture for ${cap.varName}:`, error, {
          requestId,
          glError: this.readGlError(),
        });
        continue;
      }
    }

    this.deleteFBOWithTexture(fbo);
    return issued;
  }

  cancelPendingCaptures(): void {
    for (const pending of this.pendingCaptures) {
      this.gl.deleteSync(pending.fence);
      this.gl.deleteBuffer(pending.pbo);
    }
    this.pendingCaptures = [];
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
    this.cancelPendingCaptures();

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

  private async getOrCompileShader(code: string, requestId?: number, varName?: string): Promise<PiShader | null> {
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

    const startedAt = performance.now();

    const piShader = await this.shaderCompiler.compileShaderAsync(
      code,
      this.compileContext.commonCode,
      this.compileContext.slotAssignments,
      this.compileContext.channelTypes,
      this.customUniformDeclarations || undefined,
    );
    if (!piShader || !piShader.mProgram) {
      if (piShader?.mInfo) {
        this.lastError = piShader.mInfo;
        console.error('[VariableCapture] Shader compile failed:', piShader.mInfo, {
          requestId,
          varName,
          elapsedMs: this.roundElapsed(performance.now() - startedAt),
          glError: this.readGlError(),
        });
      } else {
        this.lastError = 'Shader compile failed';
        console.error('[VariableCapture] Shader compile failed', {
          requestId,
          varName,
          elapsedMs: this.roundElapsed(performance.now() - startedAt),
          glError: this.readGlError(),
        });
      }
      return null;
    }

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

    this.fboTextures.set(fbo, texture);
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
    selectorIndex?: number,
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

    if (this.inputBindings.length > 0) {
      bindTextures(gl, this.inputBindings);
      for (let i = 0; i < this.inputBindings.length; i++) {
        const loc = gl.getUniformLocation(program, `iChannel${i}`);
        if (loc !== null) {
          gl.uniform1i(loc, i);
        }
      }
    }

    // Set uniforms
    gl.uniform3fv(gl.getUniformLocation(program, 'iResolution'), [canvasWidth, canvasHeight, 1.0]);
    gl.uniform1f(gl.getUniformLocation(program, 'iTime'), uniforms.time);
    gl.uniform1f(gl.getUniformLocation(program, 'iTimeDelta'), uniforms.timeDelta);
    gl.uniform1f(gl.getUniformLocation(program, 'iFrameRate'), uniforms.frameRate);
    gl.uniform1i(gl.getUniformLocation(program, 'iFrame'), uniforms.frame);
    gl.uniform4fv(gl.getUniformLocation(program, 'iMouse'), uniforms.mouse);
    gl.uniform4fv(gl.getUniformLocation(program, 'iDate'), uniforms.date);
    gl.uniform3fv(gl.getUniformLocation(program, 'iCameraPos'), uniforms.cameraPos);
    gl.uniform3fv(gl.getUniformLocation(program, 'iCameraDir'), uniforms.cameraDir);

    // Set custom uniforms from script
    for (const u of this.customUniforms) {
      const loc = gl.getUniformLocation(program, u.name);
      if (loc === null) continue;
      switch (u.type) {
        case 'float':
          gl.uniform1f(loc, u.value as number);
          break;
        case 'vec2': {
          const v = u.value as number[];
          gl.uniform2f(loc, v[0], v[1]);
          break;
        }
        case 'vec3': {
          const v = u.value as number[];
          gl.uniform3f(loc, v[0], v[1], v[2]);
          break;
        }
        case 'vec4': {
          const v = u.value as number[];
          gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
          break;
        }
        case 'bool':
          gl.uniform1i(loc, u.value ? 1 : 0);
          break;
      }
    }

    if (captureCoord !== null) {
      const loc = gl.getUniformLocation(program, '_dbgCaptureCoord');
      if (loc !== null) {
        gl.uniform2f(loc, captureCoord.x, captureCoord.y);
      }
    }

    if (selectorIndex !== undefined) {
      const loc = gl.getUniformLocation(program, '_dbgVarIndex');
      if (loc !== null) {
        gl.uniform1i(loc, selectorIndex);
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

  private roundElapsed(elapsedMs: number): number {
    return Math.round(elapsedMs * 100) / 100;
  }

  private nextFrame(): Promise<void> {
    return new Promise<void>(resolve => {
      let resolved = false;
      const done = () => {
        if (!resolved) { resolved = true; resolve(); }
      };
      requestAnimationFrame(done);
      // Safety: if rAF is throttled (e.g. WebGL context loss killing Metal), don't
      // hang indefinitely. 500ms covers any reasonable frame rate while still
      // resolving orders of magnitude faster than the ~42s we saw post-crash.
      setTimeout(done, 500);
    });
  }


  private deleteFBOWithTexture(fbo: WebGLFramebuffer): void {
    const texture = this.fboTextures.get(fbo);
    this.fboTextures.delete(fbo);
    this.gl.deleteFramebuffer(fbo);
    if (texture) {
      this.gl.deleteTexture(texture);
    }
  }

  private drainGlErrors(): number[] {
    const errors: number[] = [];
    for (let i = 0; i < 16; i++) {
      const err = this.readGlError();
      if (err === null) break;
      errors.push(err);
    }
    return errors;
  }

  private readGlError(): number | null {
    const getError = (this.gl as { getError?: () => number }).getError;
    if (!getError) return null;

    const error = getError.call(this.gl);
    const noError = (this.gl as { NO_ERROR?: number }).NO_ERROR ?? 0;
    return error === noError ? null : error;
  }
}
