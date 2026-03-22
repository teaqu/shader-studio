<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import type { AudioVideoController } from "../../AudioVideoController";

  export let channelInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;
  export let audioVideoController: AudioVideoController | undefined = undefined;
  export let globalMuted: boolean = false;

  $: onVideoControl = audioVideoController ? (p: string, a: string) => audioVideoController!.videoControl(p, a) : undefined;
  $: getVideoState = audioVideoController ? (p: string) => audioVideoController!.getVideoState(p) : undefined;
  $: onAudioControl = audioVideoController ? (p: string, a: string) => audioVideoController!.audioControl(p, a) : undefined;
  $: getAudioState = audioVideoController ? (p: string) => audioVideoController!.getAudioState(p) : undefined;
  $: getAudioFFT = audioVideoController ? (t: string, p?: string) => audioVideoController!.getAudioFFT(t, p) : undefined;

  let imageLoaded = false;
  let imageError = false;
  let imageElement: HTMLImageElement | null = null;

  // Use resolved_path (webview URI) for image display, fall back to pathMap lookup or raw path
  $: imageSrc = channelInput && (channelInput.type === "texture" || channelInput.type === "cubemap") && channelInput.path
    ? channelInput.resolved_path || getWebviewUri(channelInput.path) || channelInput.path
    : "";

  // Video preview source
  $: videoSrc = channelInput && channelInput.type === "video" && channelInput.path
    ? (channelInput as any).resolved_path || getWebviewUri(channelInput.path) || channelInput.path
    : "";

  let videoLoaded = false;
  let videoError = false;
  let videoElement: HTMLVideoElement | null = null;

  function handleVideoLoad() {
    videoLoaded = true;
    videoError = false;
  }

  function handleVideoError() {
    videoError = true;
    videoLoaded = false;
  }

  // Video control state polling
  let videoState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = null;
  let videoStateInterval: ReturnType<typeof setInterval> | undefined;

  $: if (channelInput?.type === "video" && channelInput.path && getVideoState && onVideoControl) {
    const path = (channelInput as any).resolved_path || channelInput.path;
    videoState = getVideoState(path);
    if (!videoStateInterval) {
      videoStateInterval = setInterval(() => {
        if (channelInput?.type === "video" && channelInput.path && getVideoState) {
          const p = (channelInput as any).resolved_path || channelInput.path;
          videoState = getVideoState(p);
        }
      }, 500);
    }
  } else {
    if (videoStateInterval) {
      clearInterval(videoStateInterval);
      videoStateInterval = undefined;
    }
    videoState = null;
  }

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
  $: if (videoElement && videoState) {
    // Sync pause/play
    if (videoState.paused && !videoElement.paused) {
      videoElement.pause();
    } else if (!videoState.paused && videoElement.paused) {
      const p = videoElement.play();
      if (p && p.catch) p.catch(() => {});
    }
    // Sync currentTime if drifted more than 1 second
    if (Math.abs(videoElement.currentTime - videoState.currentTime) > 1) {
      videoElement.currentTime = videoState.currentTime;
    }
  }

  function formatVideoTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
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
  let audioControlState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = null;
  let audioStateInterval: ReturnType<typeof setInterval> | undefined;

  $: if (channelInput?.type === "audio" && channelInput.path && getAudioState && onAudioControl) {
    const path = (channelInput as any).resolved_path || channelInput.path;
    audioControlState = getAudioState(path);
    if (!audioStateInterval) {
      audioStateInterval = setInterval(() => {
        if (channelInput?.type === "audio" && channelInput.path && getAudioState) {
          const p = (channelInput as any).resolved_path || channelInput.path;
          audioControlState = getAudioState(p);
        }
      }, 500);
    }
  } else {
    if (audioStateInterval) {
      clearInterval(audioStateInterval);
      audioStateInterval = undefined;
    }
    audioControlState = null;
  }

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
  $: isFlipped = channelInput && (channelInput.type === "texture" || channelInput.type === "video") && channelInput.vflip === false;
  $: isGrayscale = channelInput && channelInput.type === "texture" && channelInput.grayscale === true;

  // Build CSS transform/filter string for images
  $: imageStyle = [
    isFlipped ? 'transform: scaleY(-1)' : '',
    isGrayscale ? 'filter: grayscale(100%)' : '',
  ].filter(Boolean).join('; ');

  // Build CSS transform string for video
  $: videoStyle = isFlipped ? 'transform: scaleY(-1)' : '';

  function handleImageLoad() {
    imageLoaded = true;
    imageError = false;
  }

  function handleImageError() {
    imageError = true;
    imageLoaded = false;
  }

  // FFT canvas rendering for audio types
  let fftCanvas: HTMLCanvasElement | null = null;
  let fftAnimFrame: number | null = null;

  function isAudioType(type: string | undefined): boolean {
    return type === 'audio';
  }

  function startFFTAnimation() {
    stopFFTAnimation(); // Prevent overlapping animation loops
    if (!fftCanvas || !getAudioFFT || !channelInput || !isAudioType(channelInput.type)) return;

    const ctx = fftCanvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      if (!fftCanvas || !ctx || !getAudioFFT || !channelInput) return;

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

  $: if (fftCanvas && channelInput && isAudioType(channelInput.type) && getAudioFFT) {
    startFFTAnimation();
  } else {
    stopFFTAnimation();
  }

  onDestroy(() => {
    stopFFTAnimation();
    if (videoStateInterval) {
      clearInterval(videoStateInterval);
      videoStateInterval = undefined;
    }
    if (audioStateInterval) {
      clearInterval(audioStateInterval);
      audioStateInterval = undefined;
    }
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
          on:load={handleImageLoad}
          on:error={handleImageError}
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
          on:loadeddata={handleVideoLoad}
          on:error={handleVideoError}
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
        {#if onVideoControl && channelInput.path}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <div class="preview-controls" on:click|stopPropagation>
            <button
              class="preview-ctrl-btn"
              on:click={(e) => handlePreviewVideoControlWithSync(videoState?.paused ? 'play' : 'pause', e)}
              title={videoState?.paused ? 'Play' : 'Pause'}
            >
              {#if videoState?.paused}<i class="codicon codicon-play"></i>{:else}<i class="codicon codicon-debug-pause"></i>{/if}
            </button>
            <button
              class="preview-ctrl-btn"
              on:click={(e) => handlePreviewVideoControlWithSync(videoState?.muted ? 'unmute' : 'mute', e)}
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
              on:click={(e) => handlePreviewVideoControlWithSync('reset', e)}
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
        {#if onAudioControl && channelInput.path}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <div class="preview-controls" on:click|stopPropagation>
            <button
              class="preview-ctrl-btn"
              on:click={(e) => handlePreviewAudioControl(audioControlState?.paused ? 'play' : 'pause', e)}
              title={audioControlState?.paused ? 'Play' : 'Pause'}
            >
              {#if audioControlState?.paused}<i class="codicon codicon-play"></i>{:else}<i class="codicon codicon-debug-pause"></i>{/if}
            </button>
            <button
              class="preview-ctrl-btn"
              on:click={(e) => handlePreviewAudioControl(audioControlState?.muted ? 'unmute' : 'mute', e)}
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
              on:click={(e) => handlePreviewAudioControl('reset', e)}
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
      <div class="buffer-layers">
        <div class="buffer-layer layer-1"></div>
        <div class="buffer-layer layer-2"></div>
        <div class="buffer-layer layer-3"></div>
      </div>
      <div class="buffer-name">{channelInput.source || "Buffer"}</div>
    </div>
  {:else if channelInput.type === "cubemap"}
    <!-- Cubemap preview -->
    <div class="texture-preview">
      {#if imageSrc}
        <img
          bind:this={imageElement}
          src={imageSrc}
          alt="Cubemap preview"
          on:error={handleImageError}
          class="preview-image"
        />
      {/if}
      {#if imageError || !imageSrc}
        <div class="preview-fallback">
          <svg viewBox="0 0 24 24" fill="currentColor" width="36" height="36" opacity="0.4"><path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.36.2-.8.2-1.14 0l-7.9-4.44A.99.99 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.36-.2.8-.2 1.14 0l7.9 4.44c.32.17.53.5.53.88v9zM12 4.15L5 8.09v7.82l7 3.94 7-3.94V8.09l-7-3.94z"/></svg>
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
      <div class="keyboard-grid">
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
        <div class="keyboard-key"></div>
      </div>
      <div class="keyboard-label">Keyboard</div>
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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .buffer-layers {
    position: relative;
    width: 36px;
    height: 28px;
  }

  .buffer-layer {
    position: absolute;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 2px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  .buffer-layer.layer-1 {
    top: 0;
    left: 0;
    transform: rotate(-5deg);
    opacity: 0.5;
  }

  .buffer-layer.layer-2 {
    top: 2px;
    left: 2px;
    transform: rotate(0deg);
    opacity: 0.7;
  }

  .buffer-layer.layer-3 {
    top: 4px;
    left: 4px;
    transform: rotate(3deg);
    opacity: 0.9;
  }

  .buffer-name {
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
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
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  }

  .keyboard-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    padding: 6px;
  }

  .keyboard-key {
    width: 12px;
    height: 12px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 2px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .keyboard-label {
    font-size: 11px;
    font-weight: 600;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
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
