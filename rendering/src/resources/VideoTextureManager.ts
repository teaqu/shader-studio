import type { PiRenderer, PiTexture } from "../types/piRenderer";
import type { VideoConfigInput } from "../models/ShaderConfig";

export class VideoTextureManager {
  private readonly videoElements: Record<string, HTMLVideoElement> = {};
  private readonly videoTextures: Record<string, PiTexture> = {};
  private readonly animationFrameIds: Record<string, number> = {};

  constructor(private readonly renderer: PiRenderer) {}

  public async loadVideoTexture(
    path: string,
    options: Partial<Pick<VideoConfigInput, 'filter' | 'wrap' | 'vflip'>> = {}
  ): Promise<PiTexture> {
    // Check if video is already loaded
    if (this.videoTextures[path]) {
      return this.videoTextures[path];
    }

    console.log(`Attempting to load video from path: ${path}`);

    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.autoplay = true;
      video.volume = 0;

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
        if (resolved) return;

        // Check if video has valid dimensions
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          console.warn(`Video ${path} has zero dimensions, waiting...`);
          return; // Wait for dimensions to be available
        }

        resolved = true;
        // Remove both listeners to prevent any further calls
        video.removeEventListener('canplay', handleVideoCanPlay);
        video.removeEventListener('loadeddata', handleVideoCanPlay);

        try {
          console.log(`Video ${path} can play: ${video.videoWidth}x${video.videoHeight}, duration: ${video.duration}s`);
          const texture = this.createTextureFromVideo(video, options);
          this.videoElements[path] = video;
          this.videoTextures[path] = texture;

          // Start playing the video and update texture
          this.playVideoAndUpdateTexture(path, video, texture);

          resolve(texture);
        } catch (error) {
          console.error(`Failed to create texture from video ${path}:`, error);
          reject(error);
        }
      };

      video.addEventListener('canplay', handleVideoCanPlay);
      video.addEventListener('loadeddata', handleVideoCanPlay);
      video.addEventListener('error', handleVideoError);

      video.addEventListener('loadstart', () => {
        console.log(`Starting to load video: ${path}`);
      });

      video.src = path;
    });
  }

  public getVideoTexture(path: string): PiTexture | undefined {
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
      this.renderer.DestroyTexture(texture);
      delete this.videoTextures[path];
    }
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
        console.log(`Paused video: ${path}`);
      }
    }
  }

  public resumeAll(): void {
    for (const [path, video] of Object.entries(this.videoElements)) {
      if (video.paused && !this.userPaused.has(path)) {
        video.play().then(() => {
          console.log(`Resumed video: ${path}`);
        }).catch(error => {
          console.warn(`Could not resume video ${path}:`, error);
        });
      }
    }
  }

  // Per-video user-initiated pause tracking
  private readonly userPaused: Set<string> = new Set();

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
        console.warn(`Could not resume video ${path}:`, error);
      });
    }
  }

  public muteVideo(path: string): void {
    const video = this.videoElements[path];
    if (video) {
      video.muted = true;
      video.volume = 0;
      console.log(`[VideoTexture] muteVideo ${path}`);
    }
  }

  public unmuteVideo(path: string, volume: number = 1): void {
    const video = this.videoElements[path];
    if (!video) {
      console.warn(`[VideoTexture] unmuteVideo: no video element found for path ${path}`);
      return;
    }

    video.muted = false;
    video.volume = Math.max(0, Math.min(1, volume));
    console.log(`[VideoTexture] unmuteVideo ${path}`);
  }

  public setVideoVolume(path: string, volume: number): void {
    const video = this.videoElements[path];
    if (video) {
      video.volume = Math.max(0, Math.min(1, volume));
    }
  }

  public setAllVideoVolumes(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    for (const video of Object.values(this.videoElements)) {
      video.volume = clamped;
    }
  }

  public muteAllVideos(): void {
    for (const video of Object.values(this.videoElements)) {
      video.muted = true;
      video.volume = 0;
    }
  }

  public unmuteAllVideos(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    for (const video of Object.values(this.videoElements)) {
      video.muted = false;
      video.volume = clamped;
    }
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
    if (video) return video.muted;
    return true;
  }

  private createTextureFromVideo(
    video: HTMLVideoElement,
    options: Partial<Pick<VideoConfigInput, 'filter' | 'wrap' | 'vflip'>>
  ): PiTexture {
    const filter = this.getFilterFromOptions(options.filter);
    const wrap = this.getWrapFromOptions(options.wrap);
    const vflip = options.vflip ?? true;

    const texture = this.renderer.CreateTextureFromImage(
      this.renderer.TEXTYPE.T2D,
      video,
      this.renderer.TEXFMT.C4I8,
      filter,
      wrap,
      vflip,
    );

    if (!texture) {
      throw new Error("Failed to create texture from video");
    }

    return texture;
  }

  private playVideoAndUpdateTexture(path: string, video: HTMLVideoElement, texture: PiTexture): void {
    // Cancel any existing rAF loop for this path to prevent duplicates
    const existingId = this.animationFrameIds[path];
    if (existingId) {
      cancelAnimationFrame(existingId);
      delete this.animationFrameIds[path];
    }

    let frameCount = 0;

    const updateTexture = () => {
      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        try {
          this.renderer.UpdateTextureFromImage(texture, video);
          frameCount++;
          
          // Log first few frames for debugging
          if (frameCount <= 3) {
            console.log(`Video ${path} frame ${frameCount}: ${video.videoWidth}x${video.videoHeight}, readyState: ${video.readyState}, paused: ${video.paused}, currentTime: ${video.currentTime}`);
          }
        } catch (error) {
          console.error(`Failed to update texture for video ${path}:`, error);
        }
      } else {
        // Log if video isn't ready yet
        if (frameCount <= 3) {
          console.log(`Video ${path} not ready yet, readyState: ${video.readyState}, paused: ${video.paused}`);
        }
      }
      
      // Continue updating if video is still active
      if (this.videoTextures[path]) {
        this.animationFrameIds[path] = requestAnimationFrame(updateTexture);
      }
    };

    // Video should autoplay with autoplay=true, but ensure it plays
    const ensurePlaying = () => {
      if (video.paused) {
        console.log(`Video ${path} is paused, attempting to play...`);
        video.play().then(() => {
          console.log(`Video ${path} started playing`);
        }).catch(error => {
          console.warn(`Could not autoplay video ${path}:`, error);
          // Set up user interaction fallback only if autoplay fails
          const handleUserInteraction = () => {
            video.play().then(() => {
              console.log(`Video ${path} started playing after user interaction`);
            }).catch(e => {
              console.error(`Still failed to play video ${path}:`, e);
            });
            document.removeEventListener('click', handleUserInteraction);
            document.removeEventListener('keydown', handleUserInteraction);
          };
          document.addEventListener('click', handleUserInteraction, { once: true });
          document.addEventListener('keydown', handleUserInteraction, { once: true });
        });
      } else {
        console.log(`Video ${path} is already playing`);
      }
    };

    // Try to ensure playback
    setTimeout(ensurePlaying, 100);

    // Start updating texture
    updateTexture();
  }

  private getFilterFromOptions(filter?: string): any {
    switch (filter) {
      case "linear":
      default:
        return this.renderer.FILTER.LINEAR;
      case "nearest":
        return this.renderer.FILTER.NONE;
      case "mipmap":
        return this.renderer.FILTER.MIPMAP;
    }
  }

  private getWrapFromOptions(wrap?: string): any {
    switch (wrap) {
      case "clamp":
      default:
        return this.renderer.TEXWRP.CLAMP;
      case "repeat":
        return this.renderer.TEXWRP.REPEAT;
    }
  }
}
