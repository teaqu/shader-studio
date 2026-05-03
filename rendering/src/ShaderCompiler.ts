import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { SlotAssignment } from "./util/InputSlotAssigner";

export type ChannelSamplerType = '2D' | 'Cube' | '3D';

const ASYNC_COMPILE_TIMEOUT_MS = 5000;

export class ShaderCompiler {
  private static nextAsyncCompileId = 1;
  private khrParallelCompile: { COMPLETION_STATUS_KHR: number } | null = null;

  constructor(private renderer: PiRenderer, private gl?: WebGL2RenderingContext) {
    if (gl) {
      this.khrParallelCompile = gl.getExtension('KHR_parallel_shader_compile');
    }
  }

  private getSamplerType(type: ChannelSamplerType): string {
    switch (type) {
      case 'Cube': return 'samplerCube';
      case '3D': return 'sampler3D';
      case '2D':
      default: return 'sampler2D';
    }
  }

  public wrapShaderToyCode(
    code: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): { wrappedCode: string; headerLineCount: number; commonCodeLineCount: number } {
    const types = channelTypes || ['2D', '2D', '2D', '2D'];
    const channelDeclarations = this.buildChannelDeclarations(slotAssignments, types);

    let header = `
precision highp float;
out vec4 fragColor;
#define HW_PERFORMANCE 1
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
${channelDeclarations}
uniform vec4 iMouse;
uniform int iFrame;
uniform vec4 iDate;
uniform float iChannelTime[4];
uniform float iSampleRate;
uniform vec3 iCameraPos;
uniform vec3 iCameraDir;
uniform struct {
  ${this.getSamplerType(types[0])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh0;
uniform struct {
  ${this.getSamplerType(types[1])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh1;
uniform struct {
  ${this.getSamplerType(types[2])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh2;
uniform struct {
  ${this.getSamplerType(types[3])} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh3;
`;

    if (customUniformDeclarations) {
      header += customUniformDeclarations + "\n";
    }

    let commonCodeLineCount = 0;
    if (commonCode) {
      commonCodeLineCount = (commonCode.match(/\n/g) || []).length + 1;
      header += commonCode + "\n";
    }

    const shaderCode = header + code + "\nvoid main() {\n mainImage(fragColor, gl_FragCoord.xy);\n}";
    const headerLineCount = (header.match(/\n/g) || []).length;
    return { wrappedCode: shaderCode, headerLineCount, commonCodeLineCount };
  }

  public async compileShaderAsync(
    shaderSrc: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): Promise<PiShader | null> {
    const gl = this.gl;
    const ext = this.khrParallelCompile;
    if (!gl || !ext) {
      return this.compileShader(shaderSrc, commonCode, slotAssignments, channelTypes, customUniformDeclarations);
    }

    const glslPrefix = `#version 300 es\n#ifdef GL_ES\nprecision highp float;\nprecision highp int;\nprecision mediump sampler3D;\n#endif\n`;
    const glslPrefixLines = (glslPrefix.match(/\n/g) ?? []).length;
    const vsSource = `${glslPrefix}in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fsSource, headerLineCount } = this.wrapShaderToyCode(shaderSrc, commonCode, slotAssignments, channelTypes, customUniformDeclarations);
    const fsPrefixed = `${glslPrefix}${fsSource}`;
    const mHeaderLines = glslPrefixLines + headerLineCount;
    const compileId = ShaderCompiler.nextAsyncCompileId++;
    const startedAt = performance.now();
    let pollCount = 0;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let program: WebGLProgram | null = null;

    try {
      vs = gl.createShader(gl.VERTEX_SHADER);
      if (!vs) {
        const info = 'Failed to create vertex shader';
        this.logAsyncCompileFailure(compileId, 'vertex-allocation', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 0 };
      }

      fs = gl.createShader(gl.FRAGMENT_SHADER);
      if (!fs) {
        const info = 'Failed to create fragment shader';
        gl.deleteShader(vs);
        this.logAsyncCompileFailure(compileId, 'fragment-allocation', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 1 };
      }

      gl.shaderSource(vs, vsSource);
      gl.shaderSource(fs, fsPrefixed);
      gl.compileShader(vs);
      gl.compileShader(fs);

      program = gl.createProgram();
      if (!program) {
        const info = 'Failed to create shader program';
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.logAsyncCompileFailure(compileId, 'program-allocation', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 2 };
      }

      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      // Poll without blocking — yields to the browser each frame.
      // Hard setTimeout ensures we abort even if rAF freezes (context loss, Metal crash, bg tab).
      const pollOutcome = await new Promise<'completed' | 'timeout'>(resolve => {
        let resolved = false;
        const done = (outcome: 'completed' | 'timeout') => {
          if (!resolved) { resolved = true; resolve(outcome); }
        };
        const timeoutId = setTimeout(() => done('timeout'), ASYNC_COMPILE_TIMEOUT_MS);
        let slowLogged = false;
        const poll = () => {
          pollCount++;
          if (gl.isContextLost()) {
            clearTimeout(timeoutId);
            done('timeout');
            return;
          }
          if (gl.getProgramParameter(program!, ext.COMPLETION_STATUS_KHR)) {
            clearTimeout(timeoutId);
            done('completed');
            return;
          }
          const elapsedMs = performance.now() - startedAt;
          if (elapsedMs >= ASYNC_COMPILE_TIMEOUT_MS) {
            clearTimeout(timeoutId);
            done('timeout');
            return;
          }
          if (!slowLogged && elapsedMs > 1000) {
            slowLogged = true;
            console.warn('[ShaderCompiler] async compile slow', {
              compileId,
              elapsedMs: this.roundElapsed(elapsedMs),
              pollCount,
              glError: this.readGlError(gl),
            });
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });

      if (pollOutcome === 'timeout') {
        const info = `Compile timed out after ${ASYNC_COMPILE_TIMEOUT_MS}ms`;
        gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(program);
        this.logAsyncCompileFailure(compileId, 'timeout', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 2 };
      }

      const vsOk = gl.getShaderParameter(vs, gl.COMPILE_STATUS);
      const fsOk = gl.getShaderParameter(fs, gl.COMPILE_STATUS);
      const linkOk = gl.getProgramParameter(program, gl.LINK_STATUS);

      if (!vsOk) {
        const info = gl.getShaderInfoLog(vs) ?? 'Unknown vertex shader error';
        gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(program);
        this.logAsyncCompileFailure(compileId, 'vertex', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 0 };
      }
      if (!fsOk) {
        const info = gl.getShaderInfoLog(fs) ?? 'Unknown fragment shader error';
        gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(program);
        this.logAsyncCompileFailure(compileId, 'fragment', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 1 };
      }
      if (!linkOk) {
        const info = gl.getProgramInfoLog(program) ?? 'Unknown link error';
        gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(program);
        this.logAsyncCompileFailure(compileId, 'link', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 2 };
      }

      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return { mProgram: program, mResult: true, mInfo: 'Shader compiled successfully', mHeaderLines, mErrorType: 0 };
    } catch (error) {
      console.error('[ShaderCompiler] async compile exception', {
        compileId,
        elapsedMs: this.roundElapsed(performance.now() - startedAt),
        pollCount,
        message: error instanceof Error ? error.message : String(error),
        glError: this.readGlError(gl),
      });
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (program) gl.deleteProgram(program);
      throw error;
    }
  }

  public compileShader(
    shaderSrc: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): PiShader | null {
    const vs =
      `in vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const { wrappedCode: fs } = this.wrapShaderToyCode(shaderSrc, commonCode, slotAssignments, channelTypes, customUniformDeclarations);
    return this.renderer.CreateShader(vs, fs);
  }

  private buildChannelDeclarations(slotAssignments?: SlotAssignment[], channelTypes?: ChannelSamplerType[]): string {
    const types = channelTypes || ['2D', '2D', '2D', '2D'];
    // At least 4 slots for backwards compatibility
    const channelCount = !slotAssignments || slotAssignments.length === 0
      ? 4
      : Math.max(4, slotAssignments.length);

    let decl = "";
    // Always declare iChannel0 through iChannel{N-1} — these are the slot uniforms
    for (let i = 0; i < channelCount; i++) {
      const samplerType = this.getSamplerType(types[i] || '2D');
      decl += `uniform ${samplerType} iChannel${i};\n`;
    }
    // Declare custom name aliases for slots where the key differs from iChannel{N}
    if (slotAssignments) {
      for (const { slot, key, isCustomName } of slotAssignments) {
        if (isCustomName) {
          const samplerType = this.getSamplerType(types[slot] || '2D');
          decl += `uniform ${samplerType} ${key};\n`;
        }
      }
    }
    decl += `uniform vec3 iChannelResolution[${channelCount}];\n`;
    return decl;
  }

  private logAsyncCompileFailure(
    compileId: number,
    stage: string,
    info: string,
    startedAt: number,
    pollCount: number,
    gl: WebGL2RenderingContext,
  ): void {
    console.error('[ShaderCompiler] async compile failure', {
      compileId,
      stage,
      info,
      elapsedMs: this.roundElapsed(performance.now() - startedAt),
      pollCount,
      glError: this.readGlError(gl),
    });
  }

  private roundElapsed(elapsedMs: number): number {
    return Math.round(elapsedMs * 100) / 100;
  }

  private readGlError(gl: WebGL2RenderingContext): number | null {
    const getError = (gl as { getError?: () => number }).getError;
    if (!getError) return null;

    const error = getError.call(gl);
    const noError = (gl as { NO_ERROR?: number }).NO_ERROR ?? 0;
    return error === noError ? null : error;
  }
}
