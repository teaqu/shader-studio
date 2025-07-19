import type { ResourceManager } from "./ResourceManager";
import type { PassConfig, PassUniforms, PassBuffers } from "../models";
import type { PiRenderer, PiRenderTarget, PiShader, PiTexture } from "../types/piRenderer";
import type { InputManager } from "../input/InputManager";

export class PassRenderer {
  private canvas: HTMLCanvasElement;
  private resourceManager: ResourceManager;
  private renderer: PiRenderer;

  constructor(
    canvas: HTMLCanvasElement,
    resourceManager: ResourceManager,
    renderer: PiRenderer,
  ) {
    this.canvas = canvas;
    this.resourceManager = resourceManager;
    this.renderer = renderer;
  }

  public renderPass(
    pass: PassConfig,
    target: PiRenderTarget | null,
    shader: PiShader | null,
    uniforms: PassUniforms,
    inputManager: InputManager,
    passBuffers: PassBuffers,
  ): void {
    if (!shader) return;

    const textureBindings = this.getTextureBindings(pass, inputManager, passBuffers);

    // Set viewport
    if (target?.mTex0) {
      this.renderer.SetViewport([0, 0, target.mTex0.mXres, target.mTex0.mYres]);
    } else if (this.canvas) {
      this.renderer.SetViewport([0, 0, this.canvas.width, this.canvas.height]);
    }

    this.renderer.SetRenderTarget(target);
    this.renderer.AttachShader(shader);

    this.renderer.SetShaderConstant3FV("iResolution", uniforms.res);
    this.renderer.SetShaderConstant1F("iTime", uniforms.time);
    this.renderer.SetShaderConstant4FV("iMouse", uniforms.mouse);
    this.renderer.SetShaderConstant1I("iFrame", uniforms.frame);

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

    // Draw quad
    const posLoc = this.renderer.GetAttribLocation(shader, "position");
    this.renderer.DrawUnitQuad_XY(posLoc);
  }


  private getTextureBindings(
    pass: PassConfig,
    inputManager: InputManager,
    passBuffers: PassBuffers,
  ): (PiTexture | null)[] {
    const defaultTexture = this.resourceManager.getDefaultTexture();
    let textureBindings: (PiTexture | null)[] = [
      defaultTexture,
      defaultTexture,
      defaultTexture,
      defaultTexture,
    ];

    for (let i = 0; i < 4; i++) {
      const input = pass.inputs[`iChannel${i}`];
      if (input) {
        if (input.type === "image" && input.path) {
          const imageCache = this.resourceManager.getImageTextureCache();
          textureBindings[i] = imageCache[input.path] || defaultTexture;
        } else if (input.type === "keyboard") {
          this.resourceManager.updateKeyboardTexture(
            inputManager.getKeyHeld(),
            inputManager.getKeyPressed(),
            inputManager.getKeyToggled(),
          );
          textureBindings[i] = this.resourceManager.getKeyboardTexture() ||
            defaultTexture;
        } else if (input.type === "buffer") {
          if (input.source === pass.name) {
            textureBindings[i] = passBuffers[pass.name]?.front?.mTex0 || defaultTexture;
          } else if (passBuffers[input.source]) {
            textureBindings[i] = passBuffers[input.source]?.front?.mTex0 || defaultTexture;
          }
        }
      }
    }
    return textureBindings;
  }
}
