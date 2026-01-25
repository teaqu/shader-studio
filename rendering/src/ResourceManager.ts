import type { PiRenderer, PiTexture } from "./types/piRenderer";
import { TextureCache } from "./resources/TextureCache";
import { VideoTextureManager } from "./resources/VideoTextureManager";
import { ShaderKeyboardInput } from "./resources/ShaderKeyboardInput";
import type { TextureConfigInput, VideoConfigInput } from "./models/ShaderConfig";

export interface VideoLoadResult {
  texture: PiTexture | null;
  warning?: string;
}

export class ResourceManager {
  private readonly textureCache: TextureCache;
  private readonly videoTextureManager: VideoTextureManager;
  private readonly keyboardInput: ShaderKeyboardInput;

  constructor(
    private readonly renderer: PiRenderer,
  ) {
    this.textureCache = new TextureCache(renderer);
    this.videoTextureManager = new VideoTextureManager(renderer);
    this.keyboardInput = new ShaderKeyboardInput(renderer);
  }

  public getImageTextureCache(): Record<string, PiTexture> {
    return this.textureCache.getImageTextureCache();
  }

  public getKeyboardTexture(): PiTexture | null {
    return this.keyboardInput.getKeyboardTexture();
  }

  public getVideoTexture(path: string): PiTexture | null {
    const texture = this.videoTextureManager.getVideoTexture(path);
    return texture ?? null;
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

  public async loadVideoTexture(
    path: string, 
    opts: Partial<Pick<VideoConfigInput, 'filter' | 'wrap' | 'vflip'>> = {}
  ): Promise<VideoLoadResult> {
    try {
      const texture = await this.videoTextureManager.loadVideoTexture(path, opts);
      return { texture };
    } catch (error) {
      const warningMessage = `Video is not loading: ${path}. If using in a VS Code panel, try opening Shader Studio in its own window or browser. You could also try converting the video to another format`;
      console.error(warningMessage);
      
      // Return default texture as fallback instead of throwing
      const defaultTexture = this.textureCache.getDefaultTexture();
      if (defaultTexture) {
        console.warn(`Using default texture as fallback for video: ${path}`);
        return { texture: defaultTexture, warning: warningMessage };
      }
      return { texture: null, warning: warningMessage };
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
    this.videoTextureManager.cleanup();
    this.keyboardInput.cleanup();
  }

  public pauseAllVideos(): void {
    this.videoTextureManager.pauseAll();
  }

  public resumeAllVideos(): void {
    this.videoTextureManager.resumeAll();
  }
}
