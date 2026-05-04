<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import type { AudioVideoController } from "../../AudioVideoController";

  interface Props {
    channelInput: ConfigInput | undefined;
    getWebviewUri: (path: string) => string | undefined;
    audioVideoController?: AudioVideoController;
    globalMuted?: boolean;
    showControls?: boolean;
  }

  let {
    channelInput,
    getWebviewUri,
    audioVideoController = undefined as AudioVideoController | undefined,
    globalMuted = false,
    showControls = true,
  }: Props = $props();

  let onVideoControl = $derived(audioVideoController ? (p: string, a: string) => audioVideoController!.videoControl(p, a) : undefined);
  let getVideoState = $derived(audioVideoController ? (p: string) => audioVideoController!.getVideoState(p) : undefined);
  let onAudioControl = $derived(audioVideoController ? (p: string, a: string) => audioVideoController!.audioControl(p, a) : undefined);
  let getAudioState = $derived(audioVideoController ? (p: string) => audioVideoController!.getAudioState(p) : undefined);
  let getAudioFFT = $derived(audioVideoController ? (t: string, p?: string) => audioVideoController!.getAudioFFT(t, p) : undefined);

  let imageLoaded = $state(false);
  let imageError = $state(false);
  let imageElement: HTMLImageElement | null = $state(null);

  // Use resolved_path (webview URI) for image display, fall back to pathMap lookup or raw path
  let imageSrc = $derived(channelInput && (channelInput.type === "texture" || channelInput.type === "cubemap") && channelInput.path
    ? channelInput.resolved_path || getWebviewUri(channelInput.path) || channelInput.path
    : "");

  // Video preview source
  let videoSrc = $derived(channelInput && channelInput.type === "video" && channelInput.path
    ? (channelInput as any).resolved_path || getWebviewUri(channelInput.path) || channelInput.path
    : "");

  let videoLoaded = $state(false);
  let videoError = $state(false);
  let videoElement: HTMLVideoElement | null = $state(null);

  function handleVideoLoad() {
    videoLoaded = true;
    videoError = false;
  }

  function handleVideoError() {
    videoError = true;
    videoLoaded = false;
  }

  // Video control state polling
  let videoState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = $state(null);

  $effect(() => {
    const type = channelInput?.type;
    const path = channelInput && 'path' in channelInput ? (channelInput as any).path : undefined;
    const gvs = getVideoState;
    const ovc = onVideoControl;
    if (type === "video" && path && gvs && ovc) {
      const resolvedPath = (channelInput as any).resolved_path || path;
      videoState = gvs(resolvedPath);
      const interval = setInterval(() => {
        if (channelInput?.type === "video" && 'path' in channelInput && gvs) {
          const p = (channelInput as any).resolved_path || (channelInput as any).path;
          videoState = gvs(p);
        }
      }, 500);
      return () => clearInterval(interval);
    } else {
      videoState = null;
    }
  });

  function handlePreviewVideoControl(action: string, event: MouseEvent) {
    event.stopPropagation();
    if (channelInput?.type === "video" && channelInput.path && onVideoControl) {
      const path = (channelInput as any).resolved_path || channelInput.path;
      onVideoControl(path, action);
      if (getVideoState) {
        setTimeout(() => {
          if (channelInput?.type === "video" && channelInput.path && getVideoState) {
            const p = (channelInput as any).resolved_path || channelInput.path;
            videoState = getVideoState(p);
          }
        }, 100);
      }
    }
  }

  // Sync preview video element with shader video state (pause/play/currentTime)
  $effect(() => {
    if (videoElement && videoState) {
      // Sync pause/play
      if (videoState.paused && !videoElement.paused) {
        videoElement.pause();
      } else if (!videoState.paused && videoElement.paused) {
        const p = videoElement.play();
        if (p && p.catch) {
          p.catch(() => {});
        }
      }
      // Sync currentTime if drifted more than 1 second
      if (Math.abs(videoElement.currentTime - videoState.currentTime) > 1) {
        videoElement.currentTime = videoState.currentTime;
      }
    }
  });

  function formatVideoTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) {
      return '0:00';
    }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function handlePreviewVideoControlWithSync(action: string, event: MouseEvent) {
    if (action === 'reset' && videoElement) {
      videoElement.currentTime = 0;
    }
    handlePreviewVideoControl(action, event);
  }

  // Audio control state polling
  let audioControlState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = $state(null);

  $effect(() => {
    const type = channelInput?.type;
    const path = channelInput && 'path' in channelInput ? (channelInput as any).path : undefined;
    const gas = getAudioState;
    const oac = onAudioControl;
    if (type === "audio" && path && gas && oac) {
      const resolvedPath = (channelInput as any).resolved_path || path;
      audioControlState = gas(resolvedPath);
      const interval = setInterval(() => {
        if (channelInput?.type === "audio" && 'path' in channelInput && gas) {
          const p = (channelInput as any).resolved_path || (channelInput as any).path;
          audioControlState = gas(p);
        }
      }, 500);
      return () => clearInterval(interval);
    } else {
      audioControlState = null;
    }
  });

  function handlePreviewAudioControl(action: string, event: MouseEvent) {
    event.stopPropagation();
    if (channelInput?.type === "audio" && channelInput.path && onAudioControl) {
      const path = (channelInput as any).resolved_path || channelInput.path;
      onAudioControl(path, action);
      if (getAudioState) {
        setTimeout(() => {
          if (channelInput?.type === "audio" && channelInput.path && getAudioState) {
            const p = (channelInput as any).resolved_path || channelInput.path;
            audioControlState = getAudioState(p);
          }
        }, 100);
      }
    }
  }

  // Apply vflip: Shadertoy convention is vflip=true (default), so flip when vflip is false/unchecked
  let isFlipped = $derived(channelInput && (channelInput.type === "texture" || channelInput.type === "video") && channelInput.vflip === false);
  let isGrayscale = $derived(channelInput && channelInput.type === "texture" && channelInput.grayscale === true);

  // Build CSS transform/filter string for images
  let imageStyle = $derived([
    isFlipped ? 'transform: scaleY(-1)' : '',
    isGrayscale ? 'filter: grayscale(100%)' : '',
  ].filter(Boolean).join('; '));

  // Build CSS transform string for video
  let videoStyle = $derived(isFlipped ? 'transform: scaleY(-1)' : '');

  function handleImageLoad() {
    imageLoaded = true;
    imageError = false;
  }

  function handleImageError() {
    imageError = true;
    imageLoaded = false;
  }

  // FFT canvas rendering for audio types
  let fftCanvas: HTMLCanvasElement | null = $state(null);
  let fftAnimFrame: number | null = null;

  function isAudioType(type: string | undefined): boolean {
    return type === 'audio';
  }

  function startFFTAnimation() {
    stopFFTAnimation(); // Prevent overlapping animation loops
    if (!fftCanvas || !getAudioFFT || !channelInput || !isAudioType(channelInput.type)) {
      return;
    }

    const ctx = fftCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const draw = () => {
      if (!fftCanvas || !ctx || !getAudioFFT || !channelInput) {
        return;
      }

      const type = channelInput.type;
      const path = 'path' in channelInput ? (channelInput as any).resolved_path || (channelInput as any).path : undefined;
      const fftData = getAudioFFT(type, path);

      const w = fftCanvas.width;
      const h = fftCanvas.height;
      ctx.clearRect(0, 0, w, h);

      const barCount = 32;
      const barWidth = w / barCount;
      const gap = 1;

      if (fftData) {
        const step = Math.floor(fftData.length / barCount);
        for (let i = 0; i < barCount; i++) {
          const value = fftData[i * step] / 255;
          const barHeight = value * h;
          ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + value * 0.5})`;
          ctx.fillRect(i * barWidth + gap / 2, h - barHeight, barWidth - gap, barHeight);
        }
      }

      fftAnimFrame = requestAnimationFrame(draw);
    };

    draw();
  }

  function stopFFTAnimation() {
    if (fftAnimFrame !== null) {
      cancelAnimationFrame(fftAnimFrame);
      fftAnimFrame = null;
    }
  }

  $effect(() => {
    if (fftCanvas && channelInput && isAudioType(channelInput.type) && getAudioFFT) {
      startFFTAnimation();
      return () => stopFFTAnimation();
    } else {
      stopFFTAnimation();
    }
  });

  onDestroy(() => {
    stopFFTAnimation();
    // Clean up image element
    if (imageElement) {
      imageElement.src = "";
      imageElement = null;
    }
    // Clean up video element
    if (videoElement) {
      videoElement.src = "";
      videoElement = null;
    }
  });
</script>

<div class="channel-preview-container">
  {#if !channelInput}
    <!-- Empty/Unconfigured state -->
    <div class="empty-preview">
      <div class="empty-icon">+</div>
    </div>
  {:else if channelInput.type === "texture"}
    <!-- Texture preview -->
    <div class="texture-preview">
      {#if imageSrc}
        <img
          bind:this={imageElement}
          src={imageSrc}
          alt="Texture preview"
          loading="lazy"
          onload={handleImageLoad}
          onerror={handleImageError}
          class="preview-image"
          class:loaded={imageLoaded}
          style={imageStyle}
        />
      {/if}
      {#if !imageLoaded}
        <div class="preview-fallback">
          <div class="texture-icon-grid">
            <div class="texture-square"></div>
            <div class="texture-square"></div>
            <div class="texture-square"></div>
            <div class="texture-square"></div>
          </div>
          <div class="fallback-text">Texture</div>
        </div>
      {:else}
        <div class="preview-overlay">
          <span class="preview-label">Texture</span>
        </div>
      {/if}
    </div>
  {:else if channelInput.type === "video"}
    <!-- Video preview -->
    <div class="video-preview">
      {#if videoSrc}
        <video
          bind:this={videoElement}
          src={videoSrc}
          muted
          autoplay
          loop
          playsinline
          onloadeddata={handleVideoLoad}
          onerror={handleVideoError}
          class="preview-video"
          class:loaded={videoLoaded}
          style={videoStyle}
        ></video>
      {/if}
      {#if !videoLoaded}
        <div class="video-icon-container">
          <div class="video-play-button">
            <div class="play-triangle"></div>
          </div>
          <div class="video-label">Video</div>
        </div>
      {/if}
      <div class="preview-overlay video-overlay">
        {#if videoState && videoState.duration > 0}
          <span class="preview-timer">{formatVideoTime(videoState.currentTime)}/{formatVideoTime(videoState.duration)}</span>
        {:else}
          <span class="preview-label">Video</span>
        {/if}
        {#if onVideoControl && showControls && channelInput.path}
          <div class="preview-controls" role="presentation" onclick={(e) => e.stopPropagation()}>
            <button
              class="preview-ctrl-btn"
              onclick={(e) => handlePreviewVideoControlWithSync(videoState?.paused ? 'play' : 'pause', e)}
              title={videoState?.paused ? 'Play' : 'Pause'}
            >
              {#if videoState?.paused}<i class="codicon codicon-play"></i>{:else}<i class="codicon codicon-debug-pause"></i>{/if}
            </button>
            <button
              class="preview-ctrl-btn"
              onclick={(e) => handlePreviewVideoControlWithSync(videoState?.muted ? 'unmute' : 'mute', e)}
              title={videoState?.muted && globalMuted ? 'Unmute globally first (options menu)' : videoState?.muted ? 'Unmute' : 'Mute'}
              disabled={videoState?.muted && globalMuted}
            >
              {#if videoState?.muted}
                <i class="codicon codicon-mute"></i>
              {:else}
                <i class="codicon codicon-unmute"></i>
              {/if}
            </button>
            <button
              class="preview-ctrl-btn"
              onclick={(e) => handlePreviewVideoControlWithSync('reset', e)}
              aria-label="Reset video to beginning"
              title="Reset to beginning"
            >
              <i class="codicon codicon-debug-restart"></i>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {:else if channelInput.type === "audio"}
    <!-- Audio preview -->
    <div class="audio-preview">
      {#if getAudioFFT}
        <canvas bind:this={fftCanvas} class="fft-canvas" width="120" height="90"></canvas>
      {:else}
        <div class="audio-wave-icon">
          <div class="wave-bar" style="height: 40%"></div>
          <div class="wave-bar" style="height: 70%"></div>
          <div class="wave-bar" style="height: 100%"></div>
          <div class="wave-bar" style="height: 60%"></div>
          <div class="wave-bar" style="height: 30%"></div>
        </div>
      {/if}
      <div class="preview-overlay audio-overlay">
        {#if audioControlState && audioControlState.duration > 0}
          <span class="preview-timer">{formatVideoTime(audioControlState.currentTime)}/{formatVideoTime(audioControlState.duration)}</span>
        {:else}
          <span class="preview-label">Audio</span>
        {/if}
        {#if onAudioControl && showControls && channelInput.path}
          <div class="preview-controls" role="presentation" onclick={(e) => e.stopPropagation()}>
            <button
              class="preview-ctrl-btn"
              onclick={(e) => handlePreviewAudioControl(audioControlState?.paused ? 'play' : 'pause', e)}
              title={audioControlState?.paused ? 'Play' : 'Pause'}
            >
              {#if audioControlState?.paused}<i class="codicon codicon-play"></i>{:else}<i class="codicon codicon-debug-pause"></i>{/if}
            </button>
            <button
              class="preview-ctrl-btn"
              onclick={(e) => handlePreviewAudioControl(audioControlState?.muted ? 'unmute' : 'mute', e)}
              title={audioControlState?.muted && globalMuted ? 'Unmute globally first (options menu)' : audioControlState?.muted ? 'Unmute' : 'Mute'}
              disabled={audioControlState?.muted && globalMuted}
            >
              {#if audioControlState?.muted}
                <i class="codicon codicon-mute"></i>
              {:else}
                <i class="codicon codicon-unmute"></i>
              {/if}
            </button>
            <button
              class="preview-ctrl-btn"
              onclick={(e) => handlePreviewAudioControl('reset', e)}
              aria-label="Reset audio to beginning"
              title="Reset to beginning"
            >
              <i class="codicon codicon-debug-restart"></i>
            </button>
          </div>
        {/if}
      </div>
    </div>
  {:else if channelInput.type === "buffer"}
    <!-- Buffer preview -->
    <div class="buffer-preview">
      <i class="codicon codicon-layers buffer-type-icon"></i>
      <span class="buffer-letter">{(channelInput.source || 'B').replace(/^.*?([A-Za-z])$/, '$1').toUpperCase()}</span>
    </div>

  {:else if channelInput.type === "cubemap"}
    <!-- Cubemap preview -->
    <div class="texture-preview">
      {#if imageSrc}
        <img
          bind:this={imageElement}
          src={imageSrc}
          alt="Cubemap preview"
          onerror={handleImageError}
          class="preview-image"
        />
      {/if}
      {#if imageError || !imageSrc}
        <div class="preview-fallback">
          <svg viewBox="0 0 24 24" fill="none" width="36" height="36" opacity="0.4">
            <polygon points="12,2 22,20 2,20" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <line x1="7" y1="11" x2="12" y2="20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <div class="fallback-text">Cubemap</div>
        </div>
      {:else}
        <div class="preview-overlay">
          <span class="preview-label">Cubemap</span>
        </div>
      {/if}
    </div>
  {:else if channelInput.type === "keyboard"}
    <!-- Keyboard preview -->
    <div class="keyboard-preview">
      <i class="codicon codicon-keyboard type-icon"></i>
    </div>
  {/if}
</div>

<style>
  .channel-preview-container {
    width: 100%;
    aspect-ratio: 4/3;
    position: relative;
    overflow: hidden;
    background: var(--vscode-editor-background, #1e1e1e);
    border-radius: 4px 4px 0 0;
    display: flex;
    align-items: center;
    justify-content: center;
    container-type: inline-size;
  }

  /* Empty state */
  .empty-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--vscode-descriptionForeground, #888);
    height: 100%;
  }

  .empty-icon {
    font-size: 24px;
    opacity: 0.5;
  }

  /* Texture preview */
  .texture-preview {
    width: 100%;
    height: 100%;
    position: relative;
    background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
  }

  .preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .preview-image.loaded {
    opacity: 1;
  }

  /* Fallback states */
  .preview-fallback {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .fallback-text {
    font-size: 10px;
    color: var(--vscode-descriptionForeground, #888);
  }

  /* Texture icon grid */
  .texture-icon-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    width: 36px;
    height: 36px;
  }

  .texture-square {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 2px;
  }

  .texture-square:nth-child(1) {
    background: rgba(255, 255, 255, 0.3);
  }

  .texture-square:nth-child(2) {
    background: rgba(255, 255, 255, 0.15);
  }

  .texture-square:nth-child(3) {
    background: rgba(255, 255, 255, 0.15);
  }

  .texture-square:nth-child(4) {
    background: rgba(255, 255, 255, 0.25);
  }

  /* Buffer preview */
  .buffer-preview {
    position: relative;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .buffer-type-icon {
    position: absolute;
    font-size: 28px;
    color: rgba(255, 255, 255, 0.35);
    top: 50%;
    left: 50%;
    transform: translate(-95%, -72%);
  }

  /* Video preview */
  .video-preview {
    width: 100%;
    height: 100%;
    position: relative;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .video-icon-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .video-play-button {
    width: 36px;
    height: 36px;
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .play-triangle {
    width: 0;
    height: 0;
    border-left: 12px solid rgba(255, 255, 255, 0.9);
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    margin-left: 3px;
  }

  .video-label {
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  /* Keyboard preview */
  .keyboard-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  }

  .buffer-letter {
    position: absolute;
    font-size: 26px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.95);
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    top: 50%;
    left: 50%;
    transform: translate(-5%, -28%);
    line-height: 1;
  }

  /* Shared icon for non-visual types */
  .type-icon {
    font-size: 22px;
    color: rgba(255, 255, 255, 0.9);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
  }

  @container (min-width: 100px) {
    .type-icon {
      font-size: 40px;
    }

    .buffer-type-icon {
      font-size: 48px;
    }

    .buffer-letter {
      font-size: 44px;
    }
  }

  /* Preview overlay (bottom gradient with label) */
  .preview-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 4px 6px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .preview-label {
    color: white;
    font-size: 9px;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .preview-timer {
    color: white;
    font-size: 11px;
    font-family: monospace;
    font-weight: 600;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    height: 22px;
    line-height: 22px;
    padding-left: 4px;
    white-space: nowrap;
  }

  .video-overlay,
  .audio-overlay {
    z-index: 1;
    padding: 6px;
    align-items: flex-end;
    overflow: hidden;
    flex-wrap: wrap;
    gap: 2px;
  }

  .preview-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.3s ease;
    position: absolute;
    top: 0;
    left: 0;
  }

  .preview-video.loaded {
    opacity: 1;
  }

  /* Video/Audio preview controls */
  .preview-controls {
    display: flex;
    gap: 3px;
    margin-left: auto;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .preview-ctrl-btn {
    background: rgba(0, 0, 0, 0.5);
    border: none;
    color: white;
    cursor: pointer;
    font-size: 13px;
    padding: 3px 5px;
    border-radius: 3px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 22px;
    transition: background 0.15s ease;
  }

  .preview-ctrl-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.7);
  }

  .preview-ctrl-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .preview-ctrl-btn :global(.ctrl-icon) {
    width: 14px;
    height: 14px;
    display: inline-block;
  }

  /* Audio preview */
  .audio-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%);
  }

  .audio-wave-icon {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 30px;
  }

  .wave-bar {
    width: 5px;
    background: rgba(255, 255, 255, 0.85);
    border-radius: 2px;
  }

  /* FFT canvas */
  .fft-canvas {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
  }
</style>
