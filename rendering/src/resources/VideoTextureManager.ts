import type { TextureBackend, TextureFilter, TextureWrap } from "./TextureBackend";
import type { VideoConfigInput } from "../models/ShaderConfig";

interface PendingVideoLoad<T> {
  path: string;
  video: HTMLVideoElement;
  promise: Promise<T>;
  resolve: (texture: T) => void;
  reject: (error: Error) => void;
  handleCanPlay: () => void;
  handleError: () => void;
  settled: boolean;
}

export class VideoTextureManager<T> {
  private readonly videoElements: Record<string, HTMLVideoElement> = {};
  private readonly videoTextures: Record<string, T> = {};
  private readonly animationFrameIds: Record<string, number> = {};
  private readonly pendingLoads = new Map<string, PendingVideoLoad<T>>();
  // Per-video user-initiated pause tracking
  private readonly userPaused: Set<string> = new Set();
  private globalMuted = false;
  private globalVolume = 1;
  private readonly channelMuted: Record<string, boolean> = {};
  // Paths that were force-muted to work around the browser autoplay policy,
  // pending a real user gesture to restore their effective audio state.
  private readonly pendingGestureUnmute: Set<string> = new Set();
  private gestureListenersArmed = false;

  constructor(private readonly backend: TextureBackend<T>) {}

  // Bound once so add/removeEventListener target the same reference.
  private readonly onGestureUnmute = (): void => {
    const paths = Array.from(this.pendingGestureUnmute);
    this.pendingGestureUnmute.clear();
    this.disarmGestureListeners();
    for (const path of paths) {
      if (this.videoElements[path]) {
        this.applyEffectiveAudioState(path);
      }
    }
  };

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

    const existingPending = this.pendingLoads.get(path);
    if (existingPending) {
      return existingPending.promise;
    }

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

    let resolveLoad!: (texture: T) => void;
    let rejectLoad!: (error: Error) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    const pending: PendingVideoLoad<T> = {
      path,
      video,
      promise,
      resolve: resolveLoad,
      reject: rejectLoad,
      handleCanPlay: () => {},
      handleError: () => {},
      settled: false,
    };
    pending.handleError = () => {
      if (!this.isPendingLoadActive(pending)) {
        return;
      }
      console.error(`Video loading error for ${path}:`, video.error);
      this.failPendingLoad(pending, new Error(`Failed to load video from URL: ${path}`));
    };
    pending.handleCanPlay = () => {
      if (!this.isPendingLoadActive(pending)) {
        return;
      }

      // Check if video has valid dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn(`Video ${path} has zero dimensions, waiting...`);
        return;
      }

      let texture: T;
      try {
        texture = this.createTextureFromVideo(video, options);
      } catch (error) {
        console.error(`Failed to create texture from video ${path}:`, error);
        this.failPendingLoad(
          pending,
          error instanceof Error ? error : new Error(String(error)),
        );
        return;
      }

      // Texture creation is synchronous but may call user/browser hooks that
      // dispose this manager re-entrantly. Never publish a handle from a load
      // that lost ownership while createTextureFromImage was running.
      if (!this.isPendingLoadActive(pending)) {
        this.backend.destroyTexture(texture);
        return;
      }

      pending.settled = true;
      this.pendingLoads.delete(path);
      this.detachPendingLoadListeners(pending);
      this.videoElements[path] = video;
      this.videoTextures[path] = texture;
      this.startVideoTextureUpdates(path, video, texture);
      pending.resolve(texture);
    };

    this.pendingLoads.set(path, pending);
    video.addEventListener('canplay', pending.handleCanPlay);
    video.addEventListener('loadeddata', pending.handleCanPlay);
    video.addEventListener('error', pending.handleError);

    // Append to DOM (hidden) — required for audio output
    video.style.position = 'fixed';
    video.style.top = '-9999px';
    video.style.left = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    try {
      document.body.appendChild(video);
      video.src = path;
    } catch (error) {
      this.failPendingLoad(
        pending,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return promise;
  }

  public getVideoTexture(path: string): T | undefined {
    return this.videoTextures[path];
  }

  public getVideoElement(path: string): HTMLVideoElement | undefined {
    return this.videoElements[path];
  }

  public removeVideoTexture(path: string): void {
    this.cancelPendingLoad(path);

    // Stop animation frame updates
    const animationId = this.animationFrameIds[path];
    if (animationId !== undefined) {
      cancelAnimationFrame(animationId);
      delete this.animationFrameIds[path];
    }

    // Pause and remove video element
    const video = this.videoElements[path];
    if (video) {
      this.resetVideoElement(video);
      delete this.videoElements[path];
    }

    // Destroy texture
    const texture = this.videoTextures[path];
    if (texture) {
      this.backend.destroyTexture(texture);
      delete this.videoTextures[path];
    }

    delete this.channelMuted[path];
    this.userPaused.delete(path);

    if (this.pendingGestureUnmute.delete(path) && this.pendingGestureUnmute.size === 0) {
      this.disarmGestureListeners();
    }
  }

  public cleanup(): void {
    const paths = new Set([
      ...this.pendingLoads.keys(),
      ...Object.keys(this.videoElements),
      ...Object.keys(this.videoTextures),
    ]);
    for (const path of paths) {
      this.removeVideoTexture(path);
    }
    this.pendingGestureUnmute.clear();
    this.disarmGestureListeners();
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
          this.handlePlayRejection(path, video, error, `Could not resume video ${path}:`);
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
        this.handlePlayRejection(path, video, error, `Could not resume video ${path}:`);
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

  private isPendingLoadActive(pending: PendingVideoLoad<T>): boolean {
    return !pending.settled && this.pendingLoads.get(pending.path) === pending;
  }

  private detachPendingLoadListeners(pending: PendingVideoLoad<T>): void {
    pending.video.removeEventListener('canplay', pending.handleCanPlay);
    pending.video.removeEventListener('loadeddata', pending.handleCanPlay);
    pending.video.removeEventListener('error', pending.handleError);
  }

  private failPendingLoad(pending: PendingVideoLoad<T>, error: Error): void {
    if (!this.isPendingLoadActive(pending)) {
      return;
    }
    pending.settled = true;
    this.pendingLoads.delete(pending.path);
    this.detachPendingLoadListeners(pending);
    this.resetVideoElement(pending.video);
    delete this.channelMuted[pending.path];
    this.userPaused.delete(pending.path);
    pending.reject(error);
  }

  private cancelPendingLoad(path: string): void {
    const pending = this.pendingLoads.get(path);
    if (!pending) {
      return;
    }
    this.failPendingLoad(pending, new Error(`Video load cancelled: ${path}`));
  }

  private resetVideoElement(video: HTMLVideoElement): void {
    video.pause();
    video.src = '';
    if (video.parentNode) {
      video.parentNode.removeChild(video);
    }
  }

  private startVideoTextureUpdates(path: string, video: HTMLVideoElement, texture: T): void {
    // Cancel any existing rAF loop for this path to prevent duplicates
    const existingId = this.animationFrameIds[path];
    if (existingId !== undefined) {
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

  private isPlayNotAllowedError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'NotAllowedError';
  }

  /**
   * Chromium's autoplay policy only allows muted playback without a user
   * gesture. When an effectively-unmuted video's play() is rejected with
   * NotAllowedError, fall back to muted playback so the video at least
   * renders, and restore the real audio state on the next user gesture.
   */
  private handlePlayRejection(
    path: string,
    video: HTMLVideoElement,
    error: unknown,
    message: string
  ): void {
    if (this.isPlayNotAllowedError(error) && !video.muted) {
      video.muted = true;
      video.play()
        .then(() => {
          this.pendingGestureUnmute.add(path);
          this.armGestureListeners();
        })
        .catch(retryError => {
          this.warnUnlessPlayInterrupted(message, retryError);
        });
      return;
    }

    this.warnUnlessPlayInterrupted(message, error);
  }

  private armGestureListeners(): void {
    if (this.gestureListenersArmed) {
      return;
    }
    this.gestureListenersArmed = true;
    document.addEventListener('pointerdown', this.onGestureUnmute);
    document.addEventListener('keydown', this.onGestureUnmute);
  }

  private disarmGestureListeners(): void {
    if (!this.gestureListenersArmed) {
      return;
    }
    this.gestureListenersArmed = false;
    document.removeEventListener('pointerdown', this.onGestureUnmute);
    document.removeEventListener('keydown', this.onGestureUnmute);
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
