import type { PiRenderer, PiTexture } from "./types/piRenderer";
import { TextureCache } from "./resources/TextureCache";
import { VideoTextureManager } from "./resources/VideoTextureManager";
import { CubemapTextureManager } from "./resources/CubemapTextureManager";
import { AudioTextureManager } from "./resources/AudioTextureManager";
import { ShaderKeyboardInput } from "./resources/ShaderKeyboardInput";
import type { TextureConfigInput, VideoConfigInput, CubemapConfigInput } from "./models/ShaderConfig";

export interface VideoLoadResult {
  texture: PiTexture | null;
  warning?: string;
}

export class ResourceManager {
  private readonly textureCache: TextureCache;
  private readonly videoTextureManager: VideoTextureManager;
  private readonly cubemapTextureManager: CubemapTextureManager;
  private readonly audioTextureManager: AudioTextureManager;
  private readonly keyboardInput: ShaderKeyboardInput;

  constructor(
    private readonly renderer: PiRenderer,
  ) {
    this.textureCache = new TextureCache(renderer);
    this.videoTextureManager = new VideoTextureManager(renderer);
    this.cubemapTextureManager = new CubemapTextureManager(renderer);
    this.audioTextureManager = new AudioTextureManager(renderer);
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

  public getVideoElement(path: string): HTMLVideoElement | undefined {
    return this.videoTextureManager.getVideoElement(path);
  }

  public getCubemapTexture(path: string): PiTexture | null {
    return this.cubemapTextureManager.getCubemapTexture(path);
  }

  public async loadCubemapTexture(
    path: string,
    opts: Partial<Pick<CubemapConfigInput, 'filter' | 'wrap' | 'vflip'>> = {}
  ): Promise<PiTexture | null> {
    try {
      return await this.cubemapTextureManager.loadCubemapFromCrossImage(path, opts);
    } catch (error) {
      console.error(`Failed to load cubemap from ${path}:`, error);
      return null;
    }
  }

  public getDefaultTexture(): PiTexture | null {
    return this.textureCache.getDefaultTexture();
  }

  public async loadImageTexture(
    path: string, 
    opts: Partial<Pick<TextureConfigInput, 'filter' | 'wrap' | 'vflip' | 'grayscale'>> = {}
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

  // Audio methods
  public async loadAudioSource(path: string, options?: { muted?: boolean; volume?: number; startTime?: number; endTime?: number }): Promise<PiTexture> {
    return this.audioTextureManager.loadAudioSource(path, options);
  }

  public async resumeAudioContext(): Promise<void> {
    return this.audioTextureManager.resumeAudioContext();
  }

  public updateAudioLoopRegion(path: string, startTime?: number, endTime?: number): void {
    this.audioTextureManager.updateLoopRegion(path, startTime, endTime);
  }

  public getAudioTexture(path: string): PiTexture | null {
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
    if (duration === 0 && !this.audioTextureManager.getAudioTexture(path)) return null;
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

  public setAudioVolume(path: string, volume: number): void {
    this.audioTextureManager.setAudioVolume(path, volume);
  }

  public setAllAudioVolumes(volume: number): void {
    this.audioTextureManager.setAllAudioVolumes(volume);
  }

  public muteAllAudio(): void {
    this.audioTextureManager.muteAllAudio();
  }

  public unmuteAllAudio(volume: number): void {
    this.audioTextureManager.unmuteAllAudio(volume);
  }

  public cleanup(): void {
    if (!this.renderer) return;

    this.textureCache.cleanup();
    this.videoTextureManager.cleanup();
    this.cubemapTextureManager.cleanup();
    this.audioTextureManager.cleanup();
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

  public setVideoVolume(path: string, volume: number): void {
    this.videoTextureManager.setVideoVolume(path, volume);
  }

  public setAllVideoVolumes(volume: number): void {
    this.videoTextureManager.setAllVideoVolumes(volume);
  }

  public muteAllVideos(): void {
    this.videoTextureManager.muteAllVideos();
  }

  public unmuteAllVideos(volume: number): void {
    this.videoTextureManager.unmuteAllVideos(volume);
  }

  public getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    const video = this.videoTextureManager.getVideoElement(path);
    if (!video) return null;
    return {
      paused: this.videoTextureManager.isVideoPaused(path),
      muted: this.videoTextureManager.isVideoMuted(path),
      currentTime: video.currentTime,
      duration: video.duration || 0,
    };
  }
}
