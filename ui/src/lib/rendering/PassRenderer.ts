import type { ResourceManager } from "./ResourceManager";
import type { BufferManager } from "./BufferManager";
import type { Pass, PassUniforms } from "../models";
import type { PiRenderer, PiRenderTarget, PiShader, PiTexture } from "../types/piRenderer";
import type { KeyboardManager } from "../input/KeyboardManager";

export class PassRenderer {
  private canvas: HTMLCanvasElement;
  private resourceManager: ResourceManager;
  private bufferManager: BufferManager;
  private renderer: PiRenderer;
  private keyboardManager: KeyboardManager;

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
  }

  public renderPass(
    passConfig: Pass,
    target: PiRenderTarget | null,
    shader: PiShader | null,
    uniforms: PassUniforms,
  ): void {
    if (!shader) return;

    const textureBindings = this.getTextureBindings(passConfig);

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

    this.renderer.AttachTextures(
      4,
      textureBindings[0],
      textureBindings[1],
      textureBindings[2],
      textureBindings[3],
    );
    this.renderer.SetShaderTextureUnit("iChannel0", 0);
    this.renderer.SetShaderTextureUnit("iChannel1", 1);
    this.renderer.SetShaderTextureUnit("iChannel2", 2);
    this.renderer.SetShaderTextureUnit("iChannel3", 3);

    const posLoc = this.renderer.GetAttribLocation(shader, "position");
    this.renderer.DrawUnitQuad_XY(posLoc);
  }


  private getTextureBindings(
    passConfig: Pass,
  ): (PiTexture | null)[] {
    const defaultTexture = this.resourceManager.getDefaultTexture();
    const passBuffers = this.bufferManager.getPassBuffers();
    let textureBindings: (PiTexture | null)[] = [
      defaultTexture,
      defaultTexture,
      defaultTexture,
      defaultTexture,
    ];

    for (let i = 0; i < 4; i++) {
      const input = passConfig.inputs[`iChannel${i}`];
      if (input) {
        if (input.type === "image" && input.path) {
          const imageCache = this.resourceManager.getImageTextureCache();
          textureBindings[i] = imageCache[input.path] || defaultTexture;
        } else if (input.type === "keyboard") {
          this.resourceManager.updateKeyboardTexture(
            this.keyboardManager.getKeyHeld(),
            this.keyboardManager.getKeyPressed(),
            this.keyboardManager.getKeyToggled(),
          );
          textureBindings[i] = this.resourceManager.getKeyboardTexture() ||
            defaultTexture;
        } else if (input.type === "buffer") {
          if (input.source === passConfig.name) {
            textureBindings[i] = passBuffers[passConfig.name]?.front?.mTex0 || defaultTexture;
          } else if (passBuffers[input.source]) {
            textureBindings[i] = passBuffers[input.source]?.front?.mTex0 || defaultTexture;
          }
        }
      }
    }
    return textureBindings;
  }
}
