import type { TextureBackend, TextureFilter, TextureWrap } from "./TextureBackend";
import type { VideoConfigInput } from "../models/ShaderConfig";

export class VideoTextureManager<T> {
  private readonly videoElements: Record<string, HTMLVideoElement> = {};
  private readonly videoTextures: Record<string, T> = {};
  private readonly animationFrameIds: Record<string, number> = {};
  // Per-video user-initiated pause tracking
  private readonly userPaused: Set<string> = new Set();
  private globalMuted = false;
  private globalVolume = 1;
  private readonly channelMuted: Record<string, boolean> = {};

  constructor(private readonly backend: TextureBackend<T>) {}

  public async loadVideoTexture(
    path: string,
    options: Partial<Pick<VideoConfigInput, 'filter' | 'wrap' | 'vflip' | 'muted'>> = {}
  ): Promise<T> {
    // Check if video is already loaded
    if (this.videoTextures[path]) {
      // Config may have changed since first load (e.g. muted toggled, then recompile)
      this.channelMuted[path] = options.muted === true;
      this.applyEffectiveAudioState(path);
      return this.videoTextures[path];
    }

    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      video.autoplay = false;
      this.channelMuted[path] = options.muted === true;
      const muted = this.channelMuted[path] || this.globalMuted;
      video.muted = muted;
      video.volume = muted ? 0 : this.globalVolume;

      // webkit-playsinline for iOS/Safari compatibility
      video.setAttribute('webkit-playsinline', 'true');

      // Append to DOM (hidden) — required for audio output
      video.style.position = 'fixed';
      video.style.top = '-9999px';
      video.style.left = '-9999px';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      document.body.appendChild(video);

      const handleVideoError = () => {
        console.error(`Video loading error for ${path}:`, video.error);
        reject(new Error(`Failed to load video from URL: ${path}`));
      };

      let resolved = false;
      const handleVideoCanPlay = () => {
        // Guard against multiple fires (canplay + loadeddata both registered)
        if (resolved) {
          return;
        }

        // Check if video has valid dimensions
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          console.warn(`Video ${path} has zero dimensions, waiting...`);
          return; // Wait for dimensions to be available
        }

        resolved = true;
        // Remove both listeners to prevent any further calls
        video.removeEventListener('canplay', handleVideoCanPlay);
        video.removeEventListener('loadeddata', handleVideoCanPlay);
        video.removeEventListener('error', handleVideoError);

        try {
          const texture = this.createTextureFromVideo(video, options);
          this.videoElements[path] = video;
          this.videoTextures[path] = texture;

          this.startVideoTextureUpdates(path, video, texture);

          resolve(texture);
        } catch (error) {
          console.error(`Failed to create texture from video ${path}:`, error);
          reject(error);
        }
      };

      video.addEventListener('canplay', handleVideoCanPlay);
      video.addEventListener('loadeddata', handleVideoCanPlay);
      video.addEventListener('error', handleVideoError);

      video.src = path;
    });
  }

  public getVideoTexture(path: string): T | undefined {
    return this.videoTextures[path];
  }

  public getVideoElement(path: string): HTMLVideoElement | undefined {
    return this.videoElements[path];
  }

  public removeVideoTexture(path: string): void {
    // Stop animation frame updates
    const animationId = this.animationFrameIds[path];
    if (animationId) {
      cancelAnimationFrame(animationId);
      delete this.animationFrameIds[path];
    }

    // Pause and remove video element
    const video = this.videoElements[path];
    if (video) {
      video.pause();
      video.src = '';
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
      delete this.videoElements[path];
    }

    // Destroy texture
    const texture = this.videoTextures[path];
    if (texture) {
      this.backend.destroyTexture(texture);
      delete this.videoTextures[path];
    }

    delete this.channelMuted[path];
  }

  public cleanup(): void {
    // Clean up all video textures
    const paths = Object.keys(this.videoTextures);
    for (const path of paths) {
      this.removeVideoTexture(path);
    }
  }

  public pauseAll(): void {
    for (const [path, video] of Object.entries(this.videoElements)) {
      if (!video.paused) {
        video.pause();
      }
    }
  }

  public resumeAll(): void {
    for (const [path, video] of Object.entries(this.videoElements)) {
      if (video.paused && !this.userPaused.has(path)) {
        video.play().catch(error => {
          this.warnUnlessPlayInterrupted(`Could not resume video ${path}:`, error);
        });
      }
    }
  }

  public pauseVideo(path: string): void {
    const video = this.videoElements[path];
    if (video && !video.paused) {
      video.pause();
      this.userPaused.add(path);
    }
  }

  public resumeVideo(path: string): void {
    const video = this.videoElements[path];
    if (video && video.paused) {
      this.userPaused.delete(path);
      video.play().catch(error => {
        this.warnUnlessPlayInterrupted(`Could not resume video ${path}:`, error);
      });
    }
  }

  private applyEffectiveAudioState(path: string): void {
    const video = this.videoElements[path];
    if (!video) {
      return;
    }
    const muted = (this.channelMuted[path] ?? false) || this.globalMuted;
    video.muted = muted;
    video.volume = muted ? 0 : this.globalVolume;
  }

  public setGlobalAudioState(volume: number, muted: boolean): void {
    this.globalVolume = Math.max(0, Math.min(1, volume));
    this.globalMuted = muted;
    for (const path of Object.keys(this.videoElements)) {
      this.applyEffectiveAudioState(path);
    }
  }

  public muteVideo(path: string): void {
    this.channelMuted[path] = true;
    this.applyEffectiveAudioState(path);
  }

  public unmuteVideo(path: string): void {
    this.channelMuted[path] = false;
    this.applyEffectiveAudioState(path);
  }

  public resetVideo(path: string): void {
    const video = this.videoElements[path];
    if (video) {
      video.currentTime = 0;
    }
  }

  public syncAllToTime(shaderTime: number): void {
    for (const video of Object.values(this.videoElements)) {
      if (video.duration && isFinite(video.duration)) {
        const targetTime = shaderTime % video.duration;
        // Only seek if drift exceeds a small threshold to avoid constant seeking
        if (Math.abs(video.currentTime - targetTime) > 0.05) {
          video.currentTime = targetTime;
        }
      }
    }
  }

  public isVideoPaused(path: string): boolean {
    const video = this.videoElements[path];
    return video ? video.paused : true;
  }

  public isVideoMuted(path: string): boolean {
    const video = this.videoElements[path];
    if (video) {
      return video.muted;
    }
    return true;
  }

  private createTextureFromVideo(
    video: HTMLVideoElement,
    options: Partial<Pick<VideoConfigInput, 'filter' | 'wrap' | 'vflip'>>
  ): T {
    const filter = this.getFilterFromOptions(options.filter);
    const wrap = this.getWrapFromOptions(options.wrap);
    const vflip = options.vflip ?? true;

    const texture = this.backend.createTextureFromImage(video, {
      type: "2d",
      format: "rgba8",
      filter,
      wrap,
      vflip,
    });

    if (!texture) {
      throw new Error("Failed to create texture from video");
    }

    return texture;
  }

  private startVideoTextureUpdates(path: string, video: HTMLVideoElement, texture: T): void {
    // Cancel any existing rAF loop for this path to prevent duplicates
    const existingId = this.animationFrameIds[path];
    if (existingId) {
      cancelAnimationFrame(existingId);
      delete this.animationFrameIds[path];
    }
    const updateTexture = () => {
      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        try {
          this.backend.updateTextureFromImage(texture, video);
        } catch (error) {
          console.error(`Failed to update texture for video ${path}:`, error);
        }
      }
      
      // Continue updating if video is still active
      if (this.videoTextures[path]) {
        this.animationFrameIds[path] = requestAnimationFrame(updateTexture);
      }
    };

    // Start updating texture
    updateTexture();
  }

  private warnUnlessPlayInterrupted(message: string, error: unknown): void {
    if (this.isPlayInterruptedError(error)) {
      return;
    }

    console.warn(message, error);
  }

  private isPlayInterruptedError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  private getFilterFromOptions(filter?: string): TextureFilter {
    switch (filter) {
      case "linear":
      default:
        return "linear";
      case "nearest":
        return "nearest";
      case "mipmap":
        return "mipmap";
    }
  }

  private getWrapFromOptions(wrap?: string): TextureWrap {
    switch (wrap) {
      case "clamp":
      default:
        return "clamp";
      case "repeat":
        return "repeat";
    }
  }
}
