import type { TextureBackend } from "./TextureBackend";
import { TextureCache } from "./TextureCache";
import { VideoTextureManager } from "./VideoTextureManager";
import { CubemapTextureManager } from "./CubemapTextureManager";
import { AudioTextureManager } from "./AudioTextureManager";
import { ShaderKeyboardInput } from "./ShaderKeyboardInput";
import type { CubemapConfigInput, TextureConfigInput, VideoConfigInput } from "../models/ShaderConfig";

export interface VideoLoadResult<T> {
  texture: T | null;
  warning?: string;
}

export class ResourceManager<T> {
  private readonly textureCache: TextureCache<T>;
  private readonly videoTextureManager: VideoTextureManager<T>;
  private readonly cubemapTextureManager: CubemapTextureManager<T>;
  private readonly audioTextureManager: AudioTextureManager<T>;
  private readonly keyboardInput: ShaderKeyboardInput<T>;

  constructor(
    private readonly backend: TextureBackend<T>,
  ) {
    this.textureCache = new TextureCache(backend);
    this.videoTextureManager = new VideoTextureManager(backend);
    this.cubemapTextureManager = new CubemapTextureManager(backend);
    this.audioTextureManager = new AudioTextureManager(backend);
    this.keyboardInput = new ShaderKeyboardInput(backend);
  }

  public getImageTextureCache(): Record<string, T> {
    return this.textureCache.getImageTextureCache();
  }

  public getKeyboardTexture(): T | null {
    return this.keyboardInput.getKeyboardTexture();
  }

  public getVideoTexture(path: string): T | null {
    const texture = this.videoTextureManager.getVideoTexture(path);
    return texture ?? null;
  }

  public getCubemapTexture(path: string): T | null {
    const texture = this.cubemapTextureManager.getCubemapTexture(path);
    return texture ?? null;
  }

  public getVideoElement(path: string): HTMLVideoElement | undefined {
    return this.videoTextureManager.getVideoElement(path);
  }

  public getDefaultTexture(): T | null {
    return this.textureCache.getDefaultTexture();
  }

  public async loadImageTexture(
    path: string,
    opts: Partial<Pick<TextureConfigInput, 'filter' | 'wrap' | 'vflip' | 'grayscale'>> = {}
  ): Promise<T | null> {
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
    opts: Partial<Pick<VideoConfigInput, 'filter' | 'wrap' | 'vflip' | 'muted'>> = {}
  ): Promise<VideoLoadResult<T>> {
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

  public async loadCubemapTexture(
    path: string,
    opts: Partial<Pick<CubemapConfigInput, 'filter' | 'wrap' | 'vflip'>> = {},
  ): Promise<T | null> {
    try {
      return await this.cubemapTextureManager.loadCubemapFromCrossImage(path, opts);
    } catch (error) {
      console.error(`Failed to load cubemap from ${path}:`, error);
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

  // Audio methods
  public async loadAudioSource(path: string, options?: { muted?: boolean; startTime?: number; endTime?: number }): Promise<T> {
    return this.audioTextureManager.loadAudioSource(path, options);
  }

  public async resumeAudioContext(): Promise<void> {
    return this.audioTextureManager.resumeAudioContext();
  }

  public updateAudioLoopRegion(path: string, startTime?: number, endTime?: number): void {
    this.audioTextureManager.updateLoopRegion(path, startTime, endTime);
  }

  public getAudioTexture(path: string): T | null {
    return this.audioTextureManager.getAudioTexture(path);
  }

  // FFT data accessors
  public getAudioFFTData(path: string): Uint8Array | null {
    return this.audioTextureManager.getAudioFFTData(path);
  }

  public updateAudioTextures(): void {
    this.audioTextureManager.updateTextures();
  }

  public getAudioSampleRate(): number {
    return this.audioTextureManager.getSampleRate();
  }

  // Audio control methods
  public controlAudio(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void {
    switch (action) {
      case 'play': this.audioTextureManager.resumeAudio(path); break;
      case 'pause': this.audioTextureManager.pauseAudio(path); break;
      case 'mute': this.audioTextureManager.muteAudio(path); break;
      case 'unmute': this.audioTextureManager.unmuteAudio(path); break;
      case 'reset': this.audioTextureManager.resetAudio(path); break;
    }
  }

  public seekAudio(path: string, time: number): void {
    this.audioTextureManager.seekAudio(path, time);
  }

  public getAudioState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    const duration = this.audioTextureManager.getAudioDuration(path);
    if (duration === 0 && !this.audioTextureManager.getAudioTexture(path)) {
      return null;
    }
    return {
      paused: this.audioTextureManager.isAudioPaused(path),
      muted: this.audioTextureManager.isAudioMuted(path),
      currentTime: this.audioTextureManager.getAudioCurrentTime(path),
      duration: duration || 0,
    };
  }

  public pauseAllAudio(): void {
    this.audioTextureManager.pauseAll();
  }

  public resumeAllAudio(): void {
    this.audioTextureManager.resumeAll();
  }

  public syncAllAudioToTime(shaderTime: number): void {
    this.audioTextureManager.syncAllToTime(shaderTime);
  }

  public cleanup(): void {
    if (!this.backend) {
      return;
    }

    this.textureCache.cleanup();
    this.videoTextureManager.cleanup();
    this.cubemapTextureManager.cleanup();
    this.audioTextureManager.cleanup();
    this.keyboardInput.cleanup();
  }

  public cleanupAllExceptMedia(): void {
    if (!this.backend) {
      return;
    }

    this.textureCache.cleanup();
    this.cubemapTextureManager.cleanup();
    this.keyboardInput.cleanup();
  }

  public pauseAllVideos(): void {
    this.videoTextureManager.pauseAll();
  }

  public resumeAllVideos(): void {
    this.videoTextureManager.resumeAll();
  }

  public syncAllVideosToTime(shaderTime: number): void {
    this.videoTextureManager.syncAllToTime(shaderTime);
  }

  public controlVideo(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void {
    switch (action) {
      case 'play': this.videoTextureManager.resumeVideo(path); break;
      case 'pause': this.videoTextureManager.pauseVideo(path); break;
      case 'mute': this.videoTextureManager.muteVideo(path); break;
      case 'unmute': this.videoTextureManager.unmuteVideo(path); break;
      case 'reset': this.videoTextureManager.resetVideo(path); break;
    }
  }

  public setGlobalAudioState(volume: number, muted: boolean): void {
    this.videoTextureManager.setGlobalAudioState(volume, muted);
    this.audioTextureManager.setGlobalAudioState(volume, muted);
  }

  public getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    const video = this.videoTextureManager.getVideoElement(path);
    if (!video) {
      return null;
    }
    return {
      paused: this.videoTextureManager.isVideoPaused(path),
      muted: this.videoTextureManager.isVideoMuted(path),
      currentTime: video.currentTime,
      duration: video.duration || 0,
    };
  }
}
