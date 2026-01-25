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
      video.crossOrigin = ""; // Same as images
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.autoplay = true;
      
      // Additional attributes for better autoplay support
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('muted', 'true');
      video.volume = 0; // Ensure volume is 0 for autoplay
      
      const handleVideoError = () => {
        console.error(`Video loading error for ${path}:`, video.error);
        reject(new Error(`Failed to load video from URL: ${path}`));
      };

      const handleVideoCanPlay = () => {
        // Check if video has valid dimensions
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          console.warn(`Video ${path} has zero dimensions, waiting...`);
          return; // Wait for dimensions to be available
        }
        
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
      case "linear": return this.renderer.FILTER.LINEAR;
      case "nearest": return this.renderer.FILTER.NONE;
      case "mipmap": 
      default: return this.renderer.FILTER.MIPMAP;
    }
  }

  private getWrapFromOptions(wrap?: string): any {
    switch (wrap) {
      case "clamp": return this.renderer.TEXWRP.CLAMP;
      case "repeat":
      default: return this.renderer.TEXWRP.REPEAT;
    }
  }
}
