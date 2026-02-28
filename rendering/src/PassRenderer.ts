import type { ResourceManager } from "./ResourceManager";
import type { BufferManager } from "./BufferManager";
import type { Pass, PassUniforms } from "./models";
import type { PiRenderer, PiRenderTarget, PiShader, PiTexture } from "./types/piRenderer";
import type { KeyboardManager } from "./input/KeyboardManager";
import { assignInputSlots, type SlotAssignment } from "./util/InputSlotAssigner";
import { bindTextures } from "./util/TextureBinder";

export class PassRenderer {
  private canvas: HTMLCanvasElement;
  private resourceManager: ResourceManager;
  private bufferManager: BufferManager;
  private renderer: PiRenderer;
  private keyboardManager: KeyboardManager;
  private gl: WebGL2RenderingContext | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    resourceManager: ResourceManager,
    bufferManager: BufferManager,
    renderer: PiRenderer,
    keyboardManager: KeyboardManager,
  ) {
    this.canvas = canvas;
    this.resourceManager = resourceManager;
    this.bufferManager = bufferManager;
    this.renderer = renderer;
    this.keyboardManager = keyboardManager;
    this.gl = canvas.getContext("webgl2");
  }

  public renderPass(
    passConfig: Pass,
    target: PiRenderTarget | null,
    shader: PiShader | null,
    uniforms: PassUniforms,
  ): void {
    if (!shader) return;

    const slotAssignments = assignInputSlots(passConfig.inputs);
    const textureBindings = this.getTextureBindings(passConfig, slotAssignments);

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

    const channelResolutions = this.getChannelResolutions(textureBindings);
    this.renderer.SetShaderConstant3FV("iChannelResolution[0]", channelResolutions);

    if (this.gl) {
      bindTextures(this.gl, textureBindings);
    }
    // Bind iChannel{N} for all slots
    for (let i = 0; i < textureBindings.length; i++) {
      this.renderer.SetShaderTextureUnit(`iChannel${i}`, i);
    }
    // Bind custom name aliases
    for (const { slot, key, isCustomName } of slotAssignments) {
      if (isCustomName) {
        this.renderer.SetShaderTextureUnit(key, slot);
      }
    }

    const posLoc = this.renderer.GetAttribLocation(shader, "position");
    this.renderer.DrawUnitQuad_XY(posLoc);
  }

  private getChannelResolutions(
    textureBindings: (PiTexture | null)[],
  ): number[] {
    const resolutions: number[] = [];
    for (const texture of textureBindings) {
      if (texture) {
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
  ): (PiTexture | null)[] {
    const channelCount = Math.max(4, slotAssignments.length);
    const defaultTexture = this.resourceManager.getDefaultTexture();
    const passBuffers = this.bufferManager.getPassBuffers();
    const textureBindings: (PiTexture | null)[] = new Array(channelCount).fill(defaultTexture);

    for (const { slot, key } of slotAssignments) {
      const input = passConfig.inputs[key];
      if (!input) {
        textureBindings[slot] = defaultTexture;
        continue;
      }

      if (input.type === "texture" && input.path) {
        const imageCache = this.resourceManager.getImageTextureCache();
        textureBindings[slot] = imageCache[input.resolved_path || input.path] || imageCache[input.path] || defaultTexture;
      } else if (input.type === "keyboard") {
        this.resourceManager.updateKeyboardTexture(
          this.keyboardManager.getKeyHeld(),
          this.keyboardManager.getKeyPressed(),
          this.keyboardManager.getKeyToggled(),
        );
        textureBindings[slot] = this.resourceManager.getKeyboardTexture() || defaultTexture;
      } else if (input.type === "buffer") {
        if (input.source === passConfig.name) {
          textureBindings[slot] = passBuffers[passConfig.name]?.front?.mTex0 || defaultTexture;
        } else if (passBuffers[input.source]) {
          textureBindings[slot] = passBuffers[input.source]?.front?.mTex0 || defaultTexture;
        } else {
          textureBindings[slot] = defaultTexture;
        }
      } else if (input.type === "video" && input.path) {
        textureBindings[slot] = this.resourceManager.getVideoTexture(input.resolved_path || input.path) || this.resourceManager.getVideoTexture(input.path) || defaultTexture;
      }
    }
    return textureBindings;
  }
}
