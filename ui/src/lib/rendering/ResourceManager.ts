import type { PiRenderer, PiTexture } from "../types/piRenderer";
import { TextureCache } from "./resources/TextureCache";
import { ShaderKeyboardInput } from "./resources/ShaderKeyboardInput";
import type { TextureConfigInput } from "../models/ShaderConfig";

export class ResourceManager {
  private readonly textureCache: TextureCache;
  private readonly keyboardInput: ShaderKeyboardInput;

  constructor(
    private readonly renderer: PiRenderer,
  ) {
    this.textureCache = new TextureCache(renderer);
    this.keyboardInput = new ShaderKeyboardInput(renderer);
  }

  public getImageTextureCache(): Record<string, PiTexture> {
    return this.textureCache.getImageTextureCache();
  }

  public getKeyboardTexture(): PiTexture | null {
    return this.keyboardInput.getKeyboardTexture();
  }

  public getDefaultTexture(): PiTexture | null {
    return this.textureCache.getDefaultTexture();
  }

  public async loadImageTexture(
    path: string, 
    opts: Partial<Pick<TextureConfigInput, 'filter' | 'wrap' | 'vflip'>> = {}
  ): Promise<PiTexture | null> {
    const cachedTexture = this.textureCache.removeCachedTexture(path);
    
    if (cachedTexture) {
      // Reuse existing texture and re-cache it
      this.textureCache.cacheTexture(path, cachedTexture);
      return cachedTexture;
    }
    
    try {
      const texture = await this.textureCache.loadTextureFromUrl(path, opts);
      this.textureCache.cacheTexture(path, texture);
      return texture;
    } catch (error) {
      console.error(`Failed to load texture from ${path}:`, error);
      const defaultTexture = this.textureCache.getDefaultTexture();
      if (defaultTexture) {
        this.textureCache.cacheTexture(path, defaultTexture);
        return defaultTexture;
      }
      return null;
    }
  }

  public updateKeyboardTexture(
    keyHeld: Uint8Array,
    keyPressed: Uint8Array,
    keyToggled: Uint8Array,
  ): void {
    this.keyboardInput.updateKeyboardTexture(keyHeld, keyPressed, keyToggled);
  }

  public cleanup(): void {
    if (!this.renderer) return;

    this.textureCache.cleanup();
    this.keyboardInput.cleanup();
  }
}
