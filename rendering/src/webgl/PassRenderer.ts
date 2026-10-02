import type { ResourceManager } from "../resources/ResourceManager";
import type { BufferManager } from "./BufferManager";
import type { Pass, PassUniforms } from "../models";
import type { PiRenderer, PiRenderTarget, PiShader, PiTexture } from "../types/piRenderer";
import type { KeyboardManager } from "../input/KeyboardManager";
import type { CustomUniform } from "./CustomUniformManager";
import { assignInputSlots, type SlotAssignment } from "../util/InputSlotAssigner";
import { bindTextures } from "../util/TextureBinder";
import { resolveBufferSamplerSettings, resolveTextureBindings } from "../util/TextureBindingResolver";
import type { WebGLMeshResources } from "./WebGLMeshResources";
import { OrbitCamera, type CameraMatrices } from "../preview3d/OrbitCamera";
import { createModelMatrix, createNormalMatrix3 } from "../preview3d/math";
import { WebGLSamplerCache } from "./WebGLSamplerCache";
import {
  depthClearValue,
  geometryInstanceCount,
  isClipSpaceVertices,
  resolveRenderState,
  verticesTopology,
  verticesVertexCount,
  type ResolvedRenderState,
} from "../types/Geometry";
import { FULLSCREEN_VERTEX_COUNT, type VertexTopology } from "@shader-studio/types";
import { applyWebGLRenderState } from "./WebGLRenderState";

/** piRenderer primitive for each portable vertices topology. */
const WEBGL_PRIMITIVES = {
  "triangle-list": "TRIANGLES",
  "triangle-strip": "TRIANGLE_STRIP",
  "line-list": "LINES",
  "line-strip": "LINE_STRIP",
  "point-list": "POINTS",
} as const satisfies Record<VertexTopology, keyof PiRenderer["PRIMTYPE"]>;

export class PassRenderer {
  private canvas: HTMLCanvasElement;
  private resourceManager: ResourceManager<PiTexture>;
  private bufferManager: BufferManager;
  private renderer: PiRenderer;
  private keyboardManager: KeyboardManager;
  private gl: WebGL2RenderingContext | null = null;
  private samplerCache: WebGLSamplerCache | null = null;
  private readonly meshCamera = new OrbitCamera();

  constructor(
    canvas: HTMLCanvasElement,
    resourceManager: ResourceManager<PiTexture>,
    bufferManager: BufferManager,
    renderer: PiRenderer,
    keyboardManager: KeyboardManager,
    private readonly meshResources: WebGLMeshResources | null = null,
  ) {
    this.canvas = canvas;
    this.resourceManager = resourceManager;
    this.bufferManager = bufferManager;
    this.renderer = renderer;
    this.keyboardManager = keyboardManager;
    this.gl = canvas.getContext("webgl2");
    this.samplerCache = this.gl ? new WebGLSamplerCache(this.gl) : null;
  }

  private drawFullscreen(passConfig: Pass, state: ResolvedRenderState): void {
    // A vertex hook may leave pixels uncovered, and blending reads the
    // target; clear to the same configured colour as WebGPU's render pass.
    if (passConfig.vertexSrc?.trim() || state.blend !== "none" || passConfig.clear !== undefined) {
      this.renderer.Clear(this.renderer.CLEAR.Color, [...state.clear], 1, 0);
    }
    // The vertex stage derives the oversized triangle from gl_VertexID.
    this.renderer.DrawPrimitive(this.renderer.PRIMTYPE.TRIANGLES, 3, false, 1);
  }

  /** Non-indexed draw with no vertex buffers; mainVertex places every vertex. */
  private drawVertices(passConfig: Pass): void {
    const primitive = this.renderer.PRIMTYPE[WEBGL_PRIMITIVES[verticesTopology(passConfig)]];
    this.renderer.DrawPrimitive(primitive, verticesVertexCount(passConfig), false, geometryInstanceCount(passConfig));
  }

  /** Without WebGL2 mesh support every mesh pass falls back to the fullscreen draw. */
  private drawsFullscreen(passConfig: Pass): boolean {
    return passConfig.geometry === "fullscreen" ||
      (passConfig.geometry !== "vertices" && (!this.gl || !this.meshResources));
  }

  /** The loaded mesh a pass draws; undefined for fullscreen, vertices, or a model still loading. */
  private resolveMesh(passConfig: Pass) {
    const meshResources = this.gl ? this.meshResources : null;
    if (passConfig.geometry === "fullscreen" || passConfig.geometry === "vertices" || !meshResources) {
      return undefined;
    }
    return passConfig.modelPath
      ? meshResources.getModel(passConfig.name)
      : passConfig.geometry === "model" ? undefined : meshResources.get(passConfig.geometry);
  }

  /** iVertexCount: the vertices the pass draws, matching the range of gl_VertexID. */
  public getPassVertexCount(passConfig: Pass): number {
    if (passConfig.geometry === "vertices") {
      return verticesVertexCount(passConfig);
    }
    return this.drawsFullscreen(passConfig)
      ? FULLSCREEN_VERTEX_COUNT
      : this.resolveMesh(passConfig)?.vertexCount ?? 0;
  }

  /** iViewMatrix, iProjectionMatrix and iViewProjection: the orbit camera at the pass's aspect ratio. */
  public getCameraMatrices(res: ArrayLike<number>): CameraMatrices {
    return this.meshCamera.getMatrices(Math.max(res[0] / Math.max(res[1], 1), 0.01));
  }

  /** iInstanceCount: a mesh pass that falls back to fullscreen draws once. */
  public getPassInstanceCount(passConfig: Pass): number {
    return this.drawsFullscreen(passConfig) ? 1 : geometryInstanceCount(passConfig);
  }

  public clearCanvas(): void {
    this.renderer.SetRenderTarget(null);
    this.renderer.SetViewport([0, 0, this.canvas.width, this.canvas.height]);
    this.renderer.Clear(this.renderer.CLEAR.Color, [0, 0, 0, 1], 1, 0);
  }

  public attachMeshCamera(): void {
    this.meshCamera.attach(this.canvas);
  }

  public dispose(): void {
    this.meshCamera.detach();
    this.samplerCache?.dispose();
    this.samplerCache = null;
  }

  public renderPass(
    passConfig: Pass,
    target: PiRenderTarget | null,
    shader: PiShader | null,
    uniforms: PassUniforms,
    customUniforms?: CustomUniform[],
    skipInputUpdates: boolean = false,
  ): void {
    if (!shader) {
      return;
    }

    const slotAssignments = assignInputSlots(passConfig.inputs);
    const textureBindings = this.getTextureBindings(passConfig, slotAssignments, skipInputUpdates);

    if (target?.mTex0) {
      this.renderer.SetViewport([0, 0, target.mTex0.mXres, target.mTex0.mYres]);
    } else if (this.canvas) {
      this.renderer.SetViewport([0, 0, this.canvas.width, this.canvas.height]);
    }

    this.renderer.SetRenderTarget(target);
    this.renderer.AttachShader(shader);

    this.renderer.SetShaderConstant3FV("iResolution", uniforms.res);
    this.renderer.SetShaderConstant1F("iTime", uniforms.time);
    this.renderer.SetShaderConstant1F("iTimeDelta", uniforms.timeDelta);
    this.renderer.SetShaderConstant1F("iFrameRate", uniforms.frameRate);
    this.renderer.SetShaderConstant4FV("iMouse", uniforms.mouse);
    this.renderer.SetShaderConstant1I("iFrame", uniforms.frame);
    this.renderer.SetShaderConstant4FV("iDate", uniforms.date);
    this.renderer.SetShaderConstant1FV("iChannelTime", uniforms.channelTime);
    this.renderer.SetShaderConstant1F("iSampleRate", uniforms.sampleRate);
    this.renderer.SetShaderConstant3FV("iCameraPos", uniforms.cameraPos);
    this.renderer.SetShaderConstant3FV("iCameraDir", uniforms.cameraDir);

    const fullscreen = this.drawsFullscreen(passConfig);
    const mesh = this.resolveMesh(passConfig);
    this.renderer.SetShaderConstant1I("iVertexCount", this.getPassVertexCount(passConfig));
    this.renderer.SetShaderConstant1I("iInstanceCount", this.getPassInstanceCount(passConfig));
    const camera = this.getCameraMatrices(uniforms.res);
    this.renderer.SetShaderConstantMat4F("iViewMatrix", Array.from(camera.view), true);
    this.renderer.SetShaderConstantMat4F("iProjectionMatrix", Array.from(camera.projection), true);
    this.renderer.SetShaderConstantMat4F("iViewProjection", Array.from(camera.viewProjection), true);

    const channelResolutions = this.getChannelResolutions(passConfig, textureBindings);
    this.renderer.SetShaderConstant3FV("iChannelResolution[0]", channelResolutions);

    // Set iCh struct uniforms (Shadertoy "new API") for every bound channel.
    for (let i = 0; i < textureBindings.length; i++) {
      this.renderer.SetShaderTextureUnit(`iCh${i}.sampler`, i);
      this.renderer.SetShaderConstant1F(`iCh${i}.time`, uniforms.channelTime[i] ?? 0);
      this.renderer.SetShaderConstant3F(
        `iCh${i}.size`,
        channelResolutions[3 * i],
        channelResolutions[3 * i + 1],
        channelResolutions[3 * i + 2],
      );
      this.renderer.SetShaderConstant1I(`iCh${i}.loaded`, uniforms.channelLoaded[i] ?? 0);
    }

    if (this.gl) {
      const samplerSettings = resolveBufferSamplerSettings(passConfig.inputs, slotAssignments);
      bindTextures(
        this.gl,
        textureBindings,
        samplerSettings.map(settings => settings ? this.samplerCache?.get(settings) ?? null : null),
      );
    }
    // Bind iChannel{N} for all slots
    for (let i = 0; i < textureBindings.length; i++) {
      this.renderer.SetShaderTextureUnit(`iChannel${i}`, i);
    }
    // Bind custom name aliases
    for (const { slot, key, isCustomName } of slotAssignments) {
      if (isCustomName) {
        if (/^iChannel\d+$/.test(key)) {
          this.renderer.SetShaderTextureUnit(key, slot);
        } else {
          this.renderer.SetShaderTextureUnit(`${key}.sampler`, slot);
          this.renderer.SetShaderConstant1F(`${key}.time`, uniforms.channelTime[slot] ?? 0);
          this.renderer.SetShaderConstant1I(`${key}.loaded`, uniforms.channelLoaded[slot] ?? 0);
          this.renderer.SetShaderConstant3F(`${key}.size`, channelResolutions[3 * slot], channelResolutions[3 * slot + 1], channelResolutions[3 * slot + 2]);
        }
      }
    }

    // Set custom uniforms from script
    if (customUniforms) {
      for (const u of customUniforms) {
        switch (u.type) {
          case 'float':
            this.renderer.SetShaderConstant1F(u.name, u.value as number);
            break;
          case 'vec2':
            this.renderer.SetShaderConstant2F(u.name, u.value as number[]);
            break;
          case 'vec3': {
            const v3 = u.value as number[];
            this.renderer.SetShaderConstant3F(u.name, v3[0], v3[1], v3[2]);
            break;
          }
          case 'vec4':
            this.renderer.SetShaderConstant4FV(u.name, u.value as number[]);
            break;
          case 'bool':
            this.renderer.SetShaderConstant1I(u.name, u.value ? 1 : 0);
            break;
        }
      }
    }

    const state = resolveRenderState(passConfig);
    if (fullscreen) {
      this.withRenderState(state, () => this.drawFullscreen(passConfig, state));
      return;
    }
    if (passConfig.geometry === "vertices") {
      if (!isClipSpaceVertices(passConfig)) {
        this.setCameraUniforms(shader, camera);
      }
      this.clearColorAndDepth(state);
      this.withRenderState(state, () => this.drawVertices(passConfig));
      return;
    }
    if (!mesh || !this.gl) {
      return;
    }
    this.setCameraUniforms(shader, camera);
    this.clearColorAndDepth(state);
    const gl = this.gl;
    this.withRenderState(state, () => {
      try {
        gl.bindVertexArray(mesh.vao);
        const instances = geometryInstanceCount(passConfig);
        if (instances > 1) {
          gl.drawElementsInstanced(gl.TRIANGLES, mesh.indexCount, mesh.indexType ?? gl.UNSIGNED_SHORT, 0, instances);
        } else {
          gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType ?? gl.UNSIGNED_SHORT, 0);
        }
      } finally {
        gl.bindVertexArray(null);
      }
    });
  }

  /** Orbit-camera matrices for meshes and world-space vertices. */
  private setCameraUniforms(shader: PiShader, camera: CameraMatrices): void {
    const model = createModelMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    this.renderer.SetShaderConstantMat4F("_meshModel", Array.from(model), true);
    this.renderer.SetShaderConstantMat4F("_meshView", Array.from(camera.view), true);
    this.renderer.SetShaderConstantMat4F("_meshProjection", Array.from(camera.projection), true);
    const normalLocation = this.gl && shader.mProgram && this.gl.getUniformLocation(shader.mProgram, "_meshNormalMatrix");
    if (normalLocation) {
      this.gl!.uniformMatrix3fv(normalLocation, false, createNormalMatrix3(model));
    }
    this.renderer.SetShaderConstant3FV("iCameraPosition", this.meshCamera.getPosition());
  }

  private clearColorAndDepth(state: ResolvedRenderState): void {
    this.renderer.Clear(
      this.renderer.CLEAR.Color | this.renderer.CLEAR.Zbuffer,
      [...state.clear],
      depthClearValue(state),
      0,
    );
  }

  /** Blend/depth/cull for one draw, restored to the GL defaults afterwards. */
  private withRenderState(state: ResolvedRenderState, draw: () => void): void {
    const restore = this.gl ? applyWebGLRenderState(this.gl, state) : null;
    try {
      draw();
    } finally {
      restore?.();
    }
  }

  private getChannelResolutions(
    passConfig: Pass,
    textureBindings: (PiTexture | null)[],
  ): number[] {
    const resolutions: number[] = [];
    const slots = assignInputSlots(passConfig.inputs);

    for (let i = 0; i < textureBindings.length; i++) {
      const texture = textureBindings[i];
      const input = passConfig.inputs[slots[i]?.key ?? `iChannel${i}`];

      if (texture && input) {
        if (input.type === 'keyboard') {
          resolutions.push(256, 3, 1);
        } else if (input.type === 'audio') {
          resolutions.push(512, 2, 1);
        } else {
          resolutions.push(texture.mXres, texture.mYres, 1);
        }
      } else if (texture) {
        resolutions.push(texture.mXres, texture.mYres, 1);
      } else {
        resolutions.push(0, 0, 0);
      }
    }
    return resolutions;
  }

  private getTextureBindings(
    passConfig: Pass,
    slotAssignments: SlotAssignment[],
    skipInputUpdates: boolean = false,
  ): (PiTexture | null)[] {
    return resolveTextureBindings({
      inputs: passConfig.inputs,
      slotAssignments,
      resourceManager: this.resourceManager,
      passBuffers: this.bufferManager.getPassBuffers(),
      // A paused frame keeps the keyboard texture it was rendered with.
      keyboard: skipInputUpdates ? null : {
        held: this.keyboardManager.getKeyHeld(),
        pressed: this.keyboardManager.getKeyPressed(),
        toggled: this.keyboardManager.getKeyToggled(),
      },
    });
  }
}
