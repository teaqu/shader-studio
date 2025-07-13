import type { WebGLRenderer } from "./WebGLRenderer";
import type { ResourceManager } from "./ResourceManager";
import type { PassConfig } from "../domain/PassConfig";

/**
 * Handles the actual rendering of shader passes.
 * Knows how to coordinate between passes, manage buffers, and execute the render pipeline.
 */
export class PassRenderer {
  private webglRenderer: WebGLRenderer;
  private resourceManager: ResourceManager;

  constructor(
    webglRenderer: WebGLRenderer,
    resourceManager: ResourceManager,
  ) {
    this.webglRenderer = webglRenderer;
    this.resourceManager = resourceManager;
  }

  /**
   * Get texture bindings for a specific pass, resolving inputs to actual textures.
   */
  public getTextureBindings(
    pass: PassConfig,
    inputManager: any,
    passBuffers: Record<string, { front: any; back: any }>,
  ): any[] {
    const defaultTexture = this.webglRenderer.getDefaultTexture();
    let textureBindings = [
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
            textureBindings[i] = passBuffers[pass.name].front.mTex0;
          } else if (passBuffers[input.source]) {
            textureBindings[i] = passBuffers[input.source].front.mTex0;
          }
        }
      }
    }
    return textureBindings;
  }

  /**
   * Render a single pass to the specified target.
   */
  public renderPass(
    pass: PassConfig,
    target: any,
    shader: any,
    uniforms: any,
    textureBindings: any[],
  ): void {
    this.webglRenderer.renderQuad(target, shader, uniforms, textureBindings);
  }
}
