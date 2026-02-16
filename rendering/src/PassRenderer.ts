import type { ResourceManager } from "./ResourceManager";
import type { BufferManager } from "./BufferManager";
import type { Pass, PassUniforms } from "./models";
import type { PiRenderer, PiRenderTarget, PiShader, PiTexture } from "./types/piRenderer";
import type { KeyboardManager } from "./input/KeyboardManager";

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

    const channelResolutions = this.getChannelResolutions(passConfig, textureBindings);
    this.renderer.SetShaderConstant3FV("iChannelResolution[0]", channelResolutions);

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


  private getChannelResolutions(
    passConfig: Pass,
    textureBindings: (PiTexture | null)[]
  ): number[] {
    // Returns a flat array of 12 floats representing 4 vec3 channel resolutions
    // Format: [ch0.x, ch0.y, ch0.z, ch1.x, ch1.y, ch1.z, ch2.x, ch2.y, ch2.z, ch3.x, ch3.y, ch3.z]
    const resolutions: number[] = [];
    
    for (let i = 0; i < 4; i++) {
      const texture = textureBindings[i];
      const input = passConfig.inputs[`iChannel${i}`];
      
      if (texture && input) {
        // For keyboard input: 256x3 (as per ShaderToy spec)
        if (input.type === 'keyboard') {
          resolutions.push(256, 3, 1);
        } else {
          // For textures, videos, and buffers: use actual texture dimensions
          resolutions.push(texture.mXres, texture.mYres, 1);
        }
      } else {
        // No input or no texture: default to 0, 0, 0
        resolutions.push(0, 0, 0);
      }
    }
    
    return resolutions;
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
        if (input.type === "texture" && input.path) {
          const imageCache = this.resourceManager.getImageTextureCache();
          // Look up by resolved_path first (webview URI used for loading), then fall back to path
          textureBindings[i] = imageCache[input.resolved_path || input.path] || imageCache[input.path] || defaultTexture;
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
          } else {
            textureBindings[i] = defaultTexture;
          }
        } else if (input.type === "video" && input.path) {
          textureBindings[i] = this.resourceManager.getVideoTexture(input.resolved_path || input.path) || this.resourceManager.getVideoTexture(input.path) || defaultTexture;
        }
      }
    }
    return textureBindings;
  }
}
