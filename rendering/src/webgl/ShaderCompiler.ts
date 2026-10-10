import { VR_INPUT_DECLARATIONS } from "../webxr/WebXrPassState";
import { buildFragmentEntry } from "./VrShaderEntry";
import { buildGlslNamedChannelDeclarations, type GeometryType, type MeshTopology, type VertexSpace, type VertexTopology } from "@shader-studio/types";
import {
  INSTANCE_INDEX,
  isMeshGeometry,
  MESH_FRAGMENT_CONTEXT,
  MESH_FRAGMENT_CONTEXT_TYPES,
} from "../preview3d/MeshFragmentContext";
import type { PiRenderer, PiShader } from "../types/piRenderer";
import type { SlotAssignment } from "../util/InputSlotAssigner";

export type ChannelSamplerType = '2D' | 'Cube' | '3D';

export interface ShaderWrapOptions {
  geometry?: GeometryType;
  /** Generate the optional desktop VR branch for the Image pass. */
  vrPreview?: boolean;
  commonCode?: string;
  slotAssignments?: SlotAssignment[];
  channelTypes?: ChannelSamplerType[];
  customUniformDeclarations?: string;
  vertexCode?: string;
  /** Resolved space and topology for vertices geometry. */
  vertices?: { space: VertexSpace; topology: VertexTopology };
  /** Resolved topology for plane, cube, sphere and model geometry. */
  meshTopology?: MeshTopology;
}

export interface WrappedShaderSource {
  vertexSource: string;
  wrappedCode: string;
  headerLineCount: number;
  commonCodeLineCount: number;
  /**
   * User-hook placement in vertexSource lines (before the GL prefix), when
   * the pass has a hook. Absent for the generated stub.
   */
  vertexRange?: { startLine: number; lineCount: number };
}

const ASYNC_COMPILE_TIMEOUT_MS = 5000;

const INSTANCE_INDEX_OUT = `flat out int ${INSTANCE_INDEX};`;
const CAMERA_MATRIX_UNIFORMS = `uniform mat4 iViewMatrix;
uniform mat4 iProjectionMatrix;
uniform mat4 iViewProjection;`;

/** Corners of the oversized triangle that covers clip space, indexed by gl_VertexID. */
const FULLSCREEN_TRIANGLE_CORNERS = "vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0)";
const FULLSCREEN_TRIANGLE_VERTEX_SOURCE =
  `out vec2 ${MESH_FRAGMENT_CONTEXT.uv};
void main() { vec2 corners[3] = vec2[3](${FULLSCREEN_TRIANGLE_CORNERS}); vec2 corner = corners[gl_VertexID]; ${MESH_FRAGMENT_CONTEXT.uv} = corner * 0.5 + 0.5; gl_Position = vec4(corner, 0.0, 1.0); }`;

/** Every vertices-geometry vertex starts here before mainVertex moves it. */
const VERTICES_SEED = ` vec3 _vertexPosition = vec3(0.0);
 vec3 _vertexNormal = vec3(0.0, 0.0, 1.0);
 vec2 _vertexUv = vec2(0.0);`;

/**
 * Meshes read their seeds from vertex attributes; world-space vertices have
 * no vertex buffers and start every vertex at the origin.
 */
function projectedVertexInputs(vertices: boolean): { attributes: string; seed: string } {
  return vertices
    ? { attributes: "", seed: VERTICES_SEED }
    : {
      attributes: `layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
`,
      seed: ` vec3 _vertexPosition = position;
 vec3 _vertexNormal = normal;
 vec2 _vertexUv = uv;`,
    };
}

/** Clip-space vertices write the hook's position straight to gl_Position. */
function buildClipVerticesMain(hasHook: boolean, pointSize: string): string {
  const callHook = hasHook ? "\n mainVertex(gl_VertexID, _vertexPosition, _vertexNormal, _vertexUv);" : "";
  return `void main() {
 ${INSTANCE_INDEX} = gl_InstanceID;
${VERTICES_SEED}${callHook}
 ${MESH_FRAGMENT_CONTEXT.uv} = _vertexUv;
 gl_Position = vec4(_vertexPosition, 1.0);${pointSize}
}`;
}

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

  public wrapShaderToyCode(code: string, options?: ShaderWrapOptions): WrappedShaderSource;
  public wrapShaderToyCode(
    code: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): WrappedShaderSource;
  public wrapShaderToyCode(
    code: string,
    optionsOrCommonCode?: ShaderWrapOptions | string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): WrappedShaderSource {
    const options = this.normalizeWrapOptions(
      optionsOrCommonCode,
      slotAssignments,
      channelTypes,
      customUniformDeclarations,
    );
    const types = options.channelTypes || ['2D', '2D', '2D', '2D'];
    const channelCount = this.getChannelCount(options.slotAssignments);
    const channelDeclarations = this.buildChannelDeclarations(options.slotAssignments, types);
    const mesh = isMeshGeometry(options.geometry);
    // World-space vertices are projected by the orbit camera like a mesh.
    const worldVertices = options.geometry === "vertices" && options.vertices?.space !== "clip";
    const fragmentContext = `in ${MESH_FRAGMENT_CONTEXT_TYPES.uv} ${MESH_FRAGMENT_CONTEXT.uv};
${mesh || worldVertices
    ? `in ${MESH_FRAGMENT_CONTEXT_TYPES.worldPosition} ${MESH_FRAGMENT_CONTEXT.worldPosition};
in ${MESH_FRAGMENT_CONTEXT_TYPES.normal} ${MESH_FRAGMENT_CONTEXT.normal};
uniform ${MESH_FRAGMENT_CONTEXT_TYPES.cameraPosition} ${MESH_FRAGMENT_CONTEXT.cameraPosition};`
    : `const ${MESH_FRAGMENT_CONTEXT_TYPES.worldPosition} ${MESH_FRAGMENT_CONTEXT.worldPosition} = ${MESH_FRAGMENT_CONTEXT_TYPES.worldPosition}(0.0);
const ${MESH_FRAGMENT_CONTEXT_TYPES.normal} ${MESH_FRAGMENT_CONTEXT.normal} = ${MESH_FRAGMENT_CONTEXT_TYPES.normal}(0.0);
const ${MESH_FRAGMENT_CONTEXT_TYPES.cameraPosition} ${MESH_FRAGMENT_CONTEXT.cameraPosition} = ${MESH_FRAGMENT_CONTEXT_TYPES.cameraPosition}(0.0);`}`;
    const frontFacingContext = options.geometry === undefined || options.geometry === "fullscreen"
      ? `const ${MESH_FRAGMENT_CONTEXT_TYPES.frontFacing} ${MESH_FRAGMENT_CONTEXT.frontFacing} = true;`
      : `#define ${MESH_FRAGMENT_CONTEXT.frontFacing} gl_FrontFacing`;
    // Fullscreen draws a single instance; every other geometry receives the
    // vertex stage's gl_InstanceID unchanged across the primitive.
    const instanceIndexContext = options.geometry === undefined || options.geometry === "fullscreen"
      ? `const int ${INSTANCE_INDEX} = 0;`
      : `flat in int ${INSTANCE_INDEX};`;

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
uniform float iChannelTime[${channelCount}];
uniform float iSampleRate;
uniform vec3 iCameraPos;
uniform vec3 iCameraDir;
${VR_INPUT_DECLARATIONS}
uniform int iVertexCount;
uniform int iInstanceCount;
${CAMERA_MATRIX_UNIFORMS}
${fragmentContext}
${frontFacingContext}
${instanceIndexContext}
${this.buildChannelMetadataDeclarations(types, channelCount)}
`;

    if (options.customUniformDeclarations) {
      header += options.customUniformDeclarations + "\n";
    }

    let commonCodeLineCount = 0;
    if (options.commonCode) {
      commonCodeLineCount = (options.commonCode.match(/\n/g) || []).length + 1;
      header += options.commonCode + "\n";
    }

    const coordinate = mesh || worldVertices
      ? `${MESH_FRAGMENT_CONTEXT.uv} * iResolution.xy`
      : "gl_FragCoord.xy";
    const fullscreen = options.geometry === undefined || options.geometry === "fullscreen";
    const shaderCode = header + code + buildFragmentEntry(`${options.commonCode ?? ""}\n${code}`, coordinate, fullscreen && options.vrPreview === true);
    const headerLineCount = (header.match(/\n/g) || []).length;
    const vertexBuilt = this.buildVertexSource(mesh, options);
    return {
      vertexSource: vertexBuilt.source,
      wrappedCode: shaderCode,
      headerLineCount,
      commonCodeLineCount,
      ...(vertexBuilt.vertexLineCount === 0 ? {} : {
        vertexRange: { startLine: vertexBuilt.vertexStartLine, lineCount: vertexBuilt.vertexLineCount },
      }),
    };
  }

  public compileShaderAsync(shaderSrc: string, options?: ShaderWrapOptions): Promise<PiShader | null>;
  public compileShaderAsync(
    shaderSrc: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): Promise<PiShader | null>;
  public async compileShaderAsync(
    shaderSrc: string,
    optionsOrCommonCode?: ShaderWrapOptions | string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): Promise<PiShader | null> {
    const options = this.normalizeWrapOptions(
      optionsOrCommonCode,
      slotAssignments,
      channelTypes,
      customUniformDeclarations,
    );
    const gl = this.gl;
    const ext = this.khrParallelCompile;
    if (!gl) {
      return this.compileShader(shaderSrc, options);
    }
    if (!ext) {
      return this.compileShaderSynchronously(shaderSrc, options, gl);
    }

    const {
      vsSource,
      fsSource,
      mHeaderLines,
    } = this.buildWebGLSources(shaderSrc, options);
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
      gl.shaderSource(fs, fsSource);
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
          if (!resolved) {
            resolved = true; resolve(outcome);
          }
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
      if (vs) {
        gl.deleteShader(vs);
      }
      if (fs) {
        gl.deleteShader(fs);
      }
      if (program) {
        gl.deleteProgram(program);
      }
      throw error;
    }
  }

  private compileShaderSynchronously(
    shaderSrc: string,
    options: ShaderWrapOptions,
    gl: WebGL2RenderingContext,
  ): PiShader {
    const { vsSource, fsSource, mHeaderLines } = this.buildWebGLSources(shaderSrc, options);
    const compileId = ShaderCompiler.nextAsyncCompileId++;
    const startedAt = performance.now();
    const pollCount = 0;
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
      gl.shaderSource(fs, fsSource);
      gl.compileShader(vs);
      gl.compileShader(fs);

      const vsOk = gl.getShaderParameter(vs, gl.COMPILE_STATUS);
      if (!vsOk) {
        const info = gl.getShaderInfoLog(vs) ?? 'Unknown vertex shader error';
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.logAsyncCompileFailure(compileId, 'vertex', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 0 };
      }

      const fsOk = gl.getShaderParameter(fs, gl.COMPILE_STATUS);
      if (!fsOk) {
        const info = gl.getShaderInfoLog(fs) ?? 'Unknown fragment shader error';
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        this.logAsyncCompileFailure(compileId, 'fragment', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 1 };
      }

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

      const linkOk = gl.getProgramParameter(program, gl.LINK_STATUS);
      if (!linkOk) {
        const info = gl.getProgramInfoLog(program) ?? 'Unknown link error';
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteProgram(program);
        this.logAsyncCompileFailure(compileId, 'link', info, startedAt, pollCount, gl);
        return { mProgram: null, mResult: false, mInfo: info, mHeaderLines, mErrorType: 2 };
      }

      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return { mProgram: program, mResult: true, mInfo: 'Shader compiled successfully', mHeaderLines, mErrorType: 0 };
    } catch (error) {
      console.error('[ShaderCompiler] synchronous compile exception', {
        compileId,
        elapsedMs: this.roundElapsed(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error),
        glError: this.readGlError(gl),
      });
      if (vs) {
        gl.deleteShader(vs);
      }
      if (fs) {
        gl.deleteShader(fs);
      }
      if (program) {
        gl.deleteProgram(program);
      }
      throw error;
    }
  }

  private buildWebGLSources(
    shaderSrc: string,
    options: ShaderWrapOptions,
  ): { vsSource: string; fsSource: string; mHeaderLines: number } {
    const glslPrefix = `#version 300 es\n#ifdef GL_ES\nprecision highp float;\nprecision highp int;\nprecision mediump sampler3D;\n#endif\n`;
    const glslPrefixLines = (glslPrefix.match(/\n/g) ?? []).length;
    const {
      vertexSource,
      wrappedCode,
      headerLineCount,
    } = this.wrapShaderToyCode(shaderSrc, options);
    return {
      vsSource: `${glslPrefix}${vertexSource}`,
      fsSource: `${glslPrefix}${wrappedCode}`,
      mHeaderLines: glslPrefixLines + headerLineCount,
    };
  }

  public compileShader(shaderSrc: string, options?: ShaderWrapOptions): PiShader | null;
  public compileShader(
    shaderSrc: string,
    commonCode?: string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): PiShader | null;
  public compileShader(
    shaderSrc: string,
    optionsOrCommonCode?: ShaderWrapOptions | string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): PiShader | null {
    const options = this.normalizeWrapOptions(
      optionsOrCommonCode,
      slotAssignments,
      channelTypes,
      customUniformDeclarations,
    );
    const { vertexSource, wrappedCode } = this.wrapShaderToyCode(shaderSrc, options);
    return this.renderer.CreateShader(vertexSource, wrappedCode);
  }

  private normalizeWrapOptions(
    optionsOrCommonCode?: ShaderWrapOptions | string,
    slotAssignments?: SlotAssignment[],
    channelTypes?: ChannelSamplerType[],
    customUniformDeclarations?: string,
  ): ShaderWrapOptions {
    if (typeof optionsOrCommonCode === "object" && optionsOrCommonCode !== null) {
      return optionsOrCommonCode;
    }
    return {
      commonCode: optionsOrCommonCode,
      slotAssignments,
      channelTypes,
      customUniformDeclarations,
    };
  }

  private buildVertexSource(mesh: boolean, options: ShaderWrapOptions): {
    source: string;
    vertexStartLine: number;
    vertexLineCount: number;
  } {
    const hasHook = Boolean(options.vertexCode?.trim());
    const vertices = options.geometry === "vertices" ? options.vertices ?? { space: "world", topology: "triangle-list" } : null;
    if (!hasHook && !mesh && !vertices) {
      return {
        source: FULLSCREEN_TRIANGLE_VERTEX_SOURCE,
        vertexStartLine: 1,
        vertexLineCount: 0,
      };
    }
    const hook = hasHook ? `${options.vertexCode}\n` : "";
    const vertexUniforms = hasHook ? this.buildVertexUniformDeclarations(options) : "";
    const channelHelpers = hasHook
      ? this.buildVertexChannelHelpers(options.slotAssignments, options.channelTypes)
      : "";
    // Lines of real hook code inside vertexSource. Leading blank lines in the
    // user code belong to no hook line, so the range starts at real code.
    const codeLines = (options.vertexCode ?? "").split("\n");
    const firstCodeLine = codeLines.findIndex((line) => line.trim() !== "");
    let lastCodeLine = codeLines.length - 1;
    while (lastCodeLine >= 0 && codeLines[lastCodeLine].trim() === "") {
      lastCodeLine -= 1;
    }
    const place = (head: string, tail: string): {
      source: string;
      vertexStartLine: number;
      vertexLineCount: number;
    } => ({
      source: `${head}${hook}\n${tail}`,
      vertexStartLine: (head.match(/\n/g) ?? []).length + 1 + (hasHook ? firstCodeLine : 0),
      vertexLineCount: hasHook ? lastCodeLine - firstCodeLine + 1 : 0,
    });
    // WebGL leaves the point size undefined unless the vertex stage writes it.
    const pointSize = vertices?.topology === "point-list" || (mesh && options.meshTopology === "point-list")
      ? "\n gl_PointSize = 1.0;"
      : "";
    if (vertices?.space === "clip") {
      return place(`${vertexUniforms}${channelHelpers}
out ${MESH_FRAGMENT_CONTEXT_TYPES.uv} ${MESH_FRAGMENT_CONTEXT.uv};
${INSTANCE_INDEX_OUT}
`, buildClipVerticesMain(hasHook, pointSize));
    }
    if (!mesh && !vertices) {
      return place(`${vertexUniforms}${channelHelpers}
out ${MESH_FRAGMENT_CONTEXT_TYPES.uv} ${MESH_FRAGMENT_CONTEXT.uv};
const int ${INSTANCE_INDEX} = 0;
`, `void main() {
 vec2 _vertexCorners[3] = vec2[3](${FULLSCREEN_TRIANGLE_CORNERS});
 vec2 _vertexCorner = _vertexCorners[gl_VertexID];
 vec3 _vertexPosition = vec3(_vertexCorner, 0.0);
 vec3 _vertexNormal = vec3(0.0, 0.0, 1.0);
 vec2 _vertexUv = _vertexCorner * 0.5 + 0.5;
 mainVertex(gl_VertexID, _vertexPosition, _vertexNormal, _vertexUv);
 ${MESH_FRAGMENT_CONTEXT.uv} = _vertexUv;
 gl_Position = vec4(_vertexPosition, 1.0);
}`);
    }
    const { attributes, seed } = projectedVertexInputs(Boolean(vertices));
    return place(`${attributes}uniform mat4 _meshModel;
uniform mat4 _meshView;
uniform mat4 _meshProjection;
uniform mat3 _meshNormalMatrix;
${vertexUniforms}${channelHelpers}
out vec2 ${MESH_FRAGMENT_CONTEXT.uv};
out ${MESH_FRAGMENT_CONTEXT_TYPES.worldPosition} ${MESH_FRAGMENT_CONTEXT.worldPosition};
out ${MESH_FRAGMENT_CONTEXT_TYPES.normal} ${MESH_FRAGMENT_CONTEXT.normal};
${INSTANCE_INDEX_OUT}
`, `void main() {
 ${INSTANCE_INDEX} = gl_InstanceID;
${seed}
 ${hasHook ? "mainVertex(gl_VertexID, _vertexPosition, _vertexNormal, _vertexUv);" : ""}
 vec4 _meshWorldPosition = _meshModel * vec4(_vertexPosition, 1.0);
 gl_Position = _meshProjection * _meshView * _meshWorldPosition;
 ${MESH_FRAGMENT_CONTEXT.uv} = _vertexUv;
 ${MESH_FRAGMENT_CONTEXT.worldPosition} = _meshWorldPosition.xyz;
 ${MESH_FRAGMENT_CONTEXT.normal} = _meshNormalMatrix * _vertexNormal;${pointSize}
}`);
  }

  private buildVertexUniformDeclarations(options: ShaderWrapOptions): string {
    const types = options.channelTypes || ['2D', '2D', '2D', '2D'];
    const channelCount = this.getChannelCount(options.slotAssignments);
    const channelDeclarations = this.buildChannelDeclarations(options.slotAssignments, types, false);
    return `uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
${channelDeclarations}uniform vec4 iMouse;
uniform int iFrame;
uniform vec4 iDate;
uniform float iChannelTime[${channelCount}];
uniform float iSampleRate;
uniform vec3 iCameraPos;
uniform vec3 iCameraDir;
${VR_INPUT_DECLARATIONS}
uniform int iVertexCount;
uniform int iInstanceCount;
${CAMERA_MATRIX_UNIFORMS}
${this.buildChannelMetadataDeclarations(types, channelCount)}${options.customUniformDeclarations ? `${options.customUniformDeclarations}\n` : ""}`;
  }

  private buildVertexChannelHelpers(slotAssignments?: SlotAssignment[], channelTypes?: ChannelSamplerType[]): string {
    const types = channelTypes || ['2D', '2D', '2D', '2D'];
    const channelCount = !slotAssignments || slotAssignments.length === 0
      ? 4
      : Math.max(4, slotAssignments.length);
    const aliasedHelperNames = new Set(
      (slotAssignments ?? [])
        .filter(({ isCustomName }) => isCustomName)
        .map(({ key }) => `sample${key[0].toUpperCase()}${key.slice(1)}`),
    );
    let helpers = "";
    for (let slot = 0; slot < channelCount; slot++) {
      if (aliasedHelperNames.has(`sampleIChannel${slot}`)) {
        continue;
      }
      const type = types[slot] || '2D';
      const coordinateType = type === '2D' ? 'vec2' : 'vec3';
      const coordinateName = type === '2D' ? 'uv' : 'dir';
      helpers += `vec4 sampleIChannel${slot}(${coordinateType} ${coordinateName})
{
    return textureLod(iChannel${slot}, ${coordinateName}, 0.0);
}
`;
    }
    for (const { slot, key, isCustomName } of slotAssignments ?? []) {
      if (!isCustomName) {
        continue;
      }
      const type = types[slot] || '2D';
      const coordinateType = type === '2D' ? 'vec2' : 'vec3';
      const coordinateName = type === '2D' ? 'uv' : 'dir';
      const helperName = `sample${key[0].toUpperCase()}${key.slice(1)}`;
      helpers += `vec4 ${helperName}(${coordinateType} ${coordinateName})
{
    return textureLod(${key}, ${coordinateName}, 0.0);
}
`;
    }
    return helpers;
  }

  private buildChannelMetadataDeclarations(types: ChannelSamplerType[], channelCount: number): string {
    return Array.from({ length: channelCount }, (_, slot) => `uniform struct {
  ${this.getSamplerType(types[slot] || '2D')} sampler;
  vec3 size;
  float time;
  int loaded;
} iCh${slot};
`).join("");
  }

  private getChannelCount(slotAssignments?: SlotAssignment[]): number {
    return !slotAssignments || slotAssignments.length === 0
      ? 4
      : Math.max(4, slotAssignments.length);
  }

  private buildChannelDeclarations(slotAssignments?: SlotAssignment[], channelTypes?: ChannelSamplerType[], fragmentStage = true): string {
    const types = channelTypes || ['2D', '2D', '2D', '2D'];
    // At least 4 slots for backwards compatibility
    const channelCount = this.getChannelCount(slotAssignments);

    const aliasedNames = new Set(
      (slotAssignments ?? [])
        .filter(({ isCustomName }) => isCustomName)
        .map(({ key }) => key),
    );
    let decl = "";
    // Declare slot uniforms unless a sparse built-in name aliases another slot.
    for (let i = 0; i < channelCount; i++) {
      if (aliasedNames.has(`iChannel${i}`)) {
        continue;
      }
      const samplerType = this.getSamplerType(types[i] || '2D');
      decl += `uniform ${samplerType} iChannel${i};\n`;
    }
    // Declare custom name aliases for slots where the key differs from iChannel{N}
    if (slotAssignments) {
      for (const { slot, key, isCustomName } of slotAssignments) {
        if (isCustomName && /^iChannel\d+$/.test(key)) {
          const samplerType = this.getSamplerType(types[slot] || '2D');
          decl += `uniform ${samplerType} ${key};\n`;
        }
      }
    }
    decl += buildGlslNamedChannelDeclarations((slotAssignments ?? []).map(binding => ({
      ...binding, samplerType: this.getSamplerType(types[binding.slot] || '2D') as 'sampler2D' | 'samplerCube' | 'sampler3D',
    })), fragmentStage) + '\n';
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
    if (!getError) {
      return null;
    }

    const error = getError.call(gl);
    const noError = (gl as { NO_ERROR?: number }).NO_ERROR ?? 0;
    return error === noError ? null : error;
  }
}
