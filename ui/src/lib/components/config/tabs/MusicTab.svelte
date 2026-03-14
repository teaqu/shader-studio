<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import AssetBrowser from "../AssetBrowser.svelte";
  import { AUDIO_EXTENSIONS } from "../../../constants/assetExtensions";
  import { getWaveformPeaks } from "../../../util/waveformCache";
  import { formatTime } from "../../../util/formatTime";

  export let tempInput: ConfigInput | undefined;
  export let channelName: string;
  export let shaderPath: string;
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let getWebviewUri: (path: string) => string | undefined;
  export let lastSelectedResolvedUri: string;
  export let onAssetSelect: (path: string, resolvedUri?: string) => void;
  export let onUpdatePath: (path: string) => void;
  export let onUpdateTempInput: (input: ConfigInput) => void;
  export let onAutoSave: () => void;
  export let onAudioControl: ((path: string, action: string) => void) | undefined = undefined;
  export let getAudioState: ((path: string) => { paused: boolean; muted: boolean; currentTime: number; duration: number } | null) | undefined = undefined;

  // Track whether loop region has been changed so we can persist on destroy
  let pendingLoopRegionSave = false;

  /** Resolve the effective audio path for engine commands (prefers resolved webview URI) */
  function getEffectiveAudioPath(): string {
    if (!tempInput || tempInput.type !== 'audio' || !tempInput.path) return '';
    return (tempInput as any).resolved_path
      || (getWebviewUri ? getWebviewUri(tempInput.path) : null)
      || lastSelectedResolvedUri
      || tempInput.path;
  }

  function updateStartTime(value: string, save: boolean = true) {
    if (tempInput && tempInput.type === "audio") {
      const num = parseFloat(value);
      if (value === "" || isNaN(num)) {
        const { startTime, ...rest } = tempInput as any;
        onUpdateTempInput({ ...rest } as ConfigInput);
      } else {
        const endTime = (tempInput as any).endTime;
        const clamped = endTime != null ? Math.min(Math.max(0, num), endTime) : Math.max(0, num);
        onUpdateTempInput({ ...tempInput, startTime: clamped });
      }
      if (save) {
        sendLoopRegionUpdate();
        pendingLoopRegionSave = true;
      }
    }
  }

  function updateEndTime(value: string, save: boolean = true) {
    if (tempInput && tempInput.type === "audio") {
      const num = parseFloat(value);
      if (value === "" || isNaN(num)) {
        const { endTime, ...rest } = tempInput as any;
        onUpdateTempInput({ ...rest } as ConfigInput);
      } else {
        const startTime = (tempInput as any).startTime ?? 0;
        const clamped = Math.max(startTime, Math.max(0, num));
        onUpdateTempInput({ ...tempInput, endTime: clamped });
      }
      if (save) {
        sendLoopRegionUpdate();
        pendingLoopRegionSave = true;
      }
    }
  }

  /** Send a loopRegion command to the engine — updates live without recompile */
  function sendLoopRegionUpdate() {
    if (tempInput?.type === 'audio' && tempInput.path && onAudioControl) {
      const path = getEffectiveAudioPath();
      const start = (tempInput as any).startTime;
      const end = (tempInput as any).endTime;
      onAudioControl(path, `loopRegion:${start ?? ''},${end ?? ''}`);
    }
  }

  // Audio control state (runtime only, not persisted)
  let audioState: { paused: boolean; muted: boolean; currentTime: number; duration: number } | null = null;

  // Track current audio path so we can detect changes
  let lastAudioPath: string | undefined;

  // Poll audio state
  let audioStateInterval: ReturnType<typeof setInterval> | undefined;
  $: if (tempInput?.type === "audio" && tempInput.path && getAudioState) {
    const currentPath = tempInput.path;
    if (currentPath !== lastAudioPath) {
      lastAudioPath = currentPath;
      audioState = null;
      waveformPeaks = null;
      if (audioStateInterval) {
        clearInterval(audioStateInterval);
        audioStateInterval = undefined;
      }
    }
    if (!audioState) {
      audioState = getAudioState(getEffectiveAudioPath());
    }
    if (!audioStateInterval) {
      audioStateInterval = setInterval(() => {
        if (tempInput?.type === "audio" && tempInput.path && getAudioState) {
          audioState = getAudioState(getEffectiveAudioPath());
        }
      }, 500);
    }
  } else {
    if (audioStateInterval) {
      clearInterval(audioStateInterval);
      audioStateInterval = undefined;
    }
    audioState = null;
    lastAudioPath = undefined;
  }

  function handleAudioControl(action: string) {
    if (tempInput?.type === "audio" && tempInput.path && onAudioControl) {
      const path = getEffectiveAudioPath();
      onAudioControl(path, action);
      if (getAudioState) {
        setTimeout(() => {
          if (tempInput?.type === "audio" && tempInput.path && getAudioState) {
            audioState = getAudioState(getEffectiveAudioPath());
          }
        }, 100);
      }
    }
  }

  // --- Waveform timeline editor ---
  let waveformCanvas: HTMLCanvasElement | null = null;
  let waveformContainer: HTMLElement | null = null;
  let waveformPeaks: Float32Array | null = null;
  let dragging: 'start' | 'end' | null = null;
  let seekDragging = false;

  $: audioUri = tempInput?.type === 'audio' && tempInput.path
    ? (tempInput as any).resolved_path || (getWebviewUri ? getWebviewUri(tempInput.path) : null) || lastSelectedResolvedUri || ''
    : '';

  $: if (audioUri) {
    getWaveformPeaks(audioUri, 350).then(async peaks => {
      waveformPeaks = peaks;
      await tick();
      if (peaks && waveformCanvas) drawWaveformTimeline();
    });
  } else {
    waveformPeaks = null;
  }

  $: if (waveformCanvas && waveformPeaks) {
    drawWaveformTimeline();
  }

  $: audioDuration = audioState?.duration || 0;
  $: audioCurrentTime = audioState?.currentTime || 0;

  $: startPercent = tempInput?.type === 'audio' && tempInput.startTime != null && audioDuration > 0
    ? Math.min((tempInput.startTime / audioDuration) * 100, 100) : 0;
  $: endPercent = tempInput?.type === 'audio' && tempInput.endTime != null && audioDuration > 0
    ? Math.min((tempInput.endTime / audioDuration) * 100, 100) : 100;
  $: cursorPercent = audioDuration > 0
    ? Math.min((audioCurrentTime / audioDuration) * 100, 100) : 0;

  function drawWaveformTimeline() {
    if (!waveformCanvas || !waveformPeaks) return;
    const ctx = waveformCanvas.getContext('2d');
    if (!ctx) return;
    const w = waveformCanvas.width;
    const h = waveformCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const n = waveformPeaks.length;
    if (n === 0) return;
    const centerY = h / 2;
    const amplitude = centerY * 0.85;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, centerY - waveformPeaks[0] * amplitude);
    for (let i = 1; i < n; i++) {
      const prevX = ((i - 1) / (n - 1)) * w;
      const x = (i / (n - 1)) * w;
      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(
        cpX, centerY - waveformPeaks[i - 1] * amplitude,
        cpX, centerY - waveformPeaks[i] * amplitude,
        x, centerY - waveformPeaks[i] * amplitude
      );
    }
    for (let i = n - 1; i >= 1; i--) {
      const nextX = (i / (n - 1)) * w;
      const x = ((i - 1) / (n - 1)) * w;
      const cpX = (nextX + x) / 2;
      ctx.bezierCurveTo(
        cpX, centerY + waveformPeaks[i] * amplitude,
        cpX, centerY + waveformPeaks[i - 1] * amplitude,
        x, centerY + waveformPeaks[i - 1] * amplitude
      );
    }
    ctx.closePath();
    ctx.fill();
  }

  function getTimeFromMouseEvent(event: MouseEvent): number {
    if (!waveformContainer || audioDuration <= 0) return 0;
    const rect = waveformContainer.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return Math.round(percent * audioDuration * 10) / 10;
  }

  function handleHandleMouseDown(event: MouseEvent, handle: 'start' | 'end') {
    event.preventDefault();
    event.stopPropagation();
    dragging = handle;
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(event: MouseEvent) {
    if (!dragging) return;
    const time = getTimeFromMouseEvent(event);
    if (dragging === 'start') {
      updateStartTime(time.toString(), false);
    } else {
      updateEndTime(time.toString(), false);
    }
    sendLoopRegionUpdate();
  }

  function handleDragEnd() {
    if (dragging) {
      pendingLoopRegionSave = true;
    }
    dragging = null;
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
  }

  function handleWaveformMouseDown(event: MouseEvent) {
    if (dragging) return;
    if (!waveformContainer || !audioDuration || !onAudioControl || tempInput?.type !== 'audio' || !tempInput.path) return;
    event.preventDefault();
    seekDragging = true;
    const time = getTimeFromMouseEvent(event);
    onAudioControl(getEffectiveAudioPath(), `seek:${time}`);
    window.addEventListener('mousemove', handleSeekDragMove);
    window.addEventListener('mouseup', handleSeekDragEnd);
  }

  function handleSeekDragMove(event: MouseEvent) {
    if (!seekDragging) return;
    if (!waveformContainer || !audioDuration || !onAudioControl || tempInput?.type !== 'audio' || !tempInput.path) return;
    const time = getTimeFromMouseEvent(event);
    onAudioControl(getEffectiveAudioPath(), `seek:${time}`);
  }

  function handleSeekDragEnd() {
    seekDragging = false;
    window.removeEventListener('mousemove', handleSeekDragMove);
    window.removeEventListener('mouseup', handleSeekDragEnd);
  }

  onDestroy(() => {
    window.removeEventListener('mousemove', handleDragMove);
    window.removeEventListener('mouseup', handleDragEnd);
    window.removeEventListener('mousemove', handleSeekDragMove);
    window.removeEventListener('mouseup', handleSeekDragEnd);
    if (audioStateInterval) {
      clearInterval(audioStateInterval);
    }
    if (pendingLoopRegionSave) {
      pendingLoopRegionSave = false;
      onAutoSave();
    }
  });
</script>

{#if postMessage}
  <AssetBrowser
    extensions={AUDIO_EXTENSIONS}
    {shaderPath}
    {postMessage}
    onSelect={onAssetSelect}
    selectedPath={(tempInput?.type === "audio" && tempInput.path) || ""}
  />
{/if}

<div class="input-group">
  <label for="path-{channelName}">Path:</label>
  <input
    id="path-{channelName}"
    type="text"
    value={(tempInput?.type === "audio" && tempInput.path) || ""}
    on:input={(e) => onUpdatePath(e.currentTarget.value)}
    placeholder="Path to audio file (.mp3, .wav, .ogg)"
    class="input-text"
  />
</div>
<div class="input-note">
  Audio provides a 512x2 texture: row 0 = FFT frequency data, row 1 = time-domain waveform.
</div>

{#if tempInput?.type === "audio" && tempInput.path}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="waveform-editor" bind:this={waveformContainer} on:mousedown={handleWaveformMouseDown}>
    <canvas bind:this={waveformCanvas} class="waveform-editor-canvas" width="700" height="80"></canvas>
    <!-- Dim outside region -->
    <div class="waveform-dim waveform-dim-left" style="width: {startPercent}%"></div>
    <div class="waveform-dim waveform-dim-right" style="width: {100 - endPercent}%"></div>
    <!-- Playback cursor -->
    {#if audioDuration > 0}
      <div class="waveform-cursor" style="left: {cursorPercent}%"></div>
    {/if}
    <!-- Start handle -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="waveform-handle waveform-handle-start"
      style="left: {startPercent}%"
      on:mousedown={(e) => handleHandleMouseDown(e, 'start')}
    >
      <div class="handle-bar"></div>
    </div>
    <!-- End handle -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="waveform-handle waveform-handle-end"
      style="left: {endPercent}%"
      on:mousedown={(e) => handleHandleMouseDown(e, 'end')}
    >
      <div class="handle-bar"></div>
    </div>
    <!-- Time labels -->
    <div class="waveform-times">
      <span class="waveform-time-label">{tempInput.startTime != null ? formatTime(tempInput.startTime) : '0:00'}</span>
      <span class="waveform-time-label">{audioDuration > 0 ? formatTime(audioCurrentTime) : ''}</span>
      <span class="waveform-time-label">{tempInput.endTime != null ? formatTime(tempInput.endTime) : (audioDuration > 0 ? formatTime(audioDuration) : '')}</span>
    </div>
  </div>
{/if}

{#if tempInput?.type === "audio" && tempInput.path && onAudioControl}
  <div class="video-controls">
    <span class="controls-label">Playback:</span>
    <div class="controls-row">
      <button
        class="btn-control"
        on:click={() => handleAudioControl(audioState?.paused ? 'play' : 'pause')}
        title={audioState?.paused ? 'Play' : 'Pause'}
      >
        {audioState?.paused ? '\u25B6' : '\u23F8'}
      </button>
      <button
        class="btn-control"
        on:click={() => handleAudioControl(audioState?.muted ? 'unmute' : 'mute')}
        title={audioState?.muted ? 'Unmute' : 'Mute'}
      >
        {#if audioState?.muted}
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        {:else}
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        {/if}
      </button>
      <button
        class="btn-control"
        on:click={() => handleAudioControl('reset')}
        title="Reset to beginning"
      >
        &#x21BA;
      </button>
      {#if audioState && audioState.duration > 0}
        <span class="video-timer">{formatTime(audioState.currentTime)} / {formatTime(audioState.duration)}</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  .input-group label {
    font-size: 14px;
    font-weight: 500;
    color: var(--vscode-foreground, #cccccc);
  }

  .input-text {
    padding: 8px 12px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    font-size: 14px;
  }

  .input-text:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .input-note {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #888);
    margin-bottom: 12px;
  }

  .video-controls {
    margin-bottom: 16px;
  }

  .controls-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--vscode-foreground, #cccccc);
    display: block;
    margin-bottom: 6px;
  }

  .controls-row {
    display: flex;
    gap: 8px;
  }

  .btn-control {
    padding: 6px 12px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-foreground, #cccccc);
    cursor: pointer;
    font-size: 16px;
    transition: all 0.2s ease;
    min-width: 36px;
    text-align: center;
  }

  .btn-control:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .video-timer {
    font-size: 13px;
    font-family: monospace;
    color: var(--vscode-descriptionForeground, #888);
    margin-left: 8px;
    white-space: nowrap;
    line-height: 36px;
  }

  .btn-control :global(.btn-icon) {
    width: 16px;
    height: 16px;
    vertical-align: middle;
    display: inline-block;
  }

  /* Waveform timeline editor */
  .waveform-editor {
    position: relative;
    margin-bottom: 16px;
    border-radius: 6px;
    overflow: hidden;
    background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%);
    cursor: pointer;
    user-select: none;
  }

  .waveform-editor-canvas {
    width: 100%;
    height: 80px;
    display: block;
  }

  .waveform-dim {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  .waveform-dim-left {
    left: 0;
  }

  .waveform-dim-right {
    right: 0;
  }

  .waveform-cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--vscode-focusBorder, #007acc);
    pointer-events: none;
    z-index: 2;
    box-shadow: 0 0 4px rgba(0, 122, 204, 0.6);
  }

  .waveform-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 18px;
    margin-left: -9px;
    cursor: ew-resize;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .handle-bar {
    width: 3px;
    height: 100%;
    border-radius: 2px;
  }

  .waveform-handle-start .handle-bar {
    background: var(--vscode-charts-green, #89d185);
    box-shadow: 0 0 4px rgba(137, 209, 133, 0.6);
  }

  .waveform-handle-end .handle-bar {
    background: var(--vscode-charts-red, #f48771);
    box-shadow: 0 0 4px rgba(244, 135, 113, 0.6);
  }

  .waveform-handle:hover .handle-bar {
    width: 5px;
  }

  .waveform-times {
    display: flex;
    justify-content: space-between;
    padding: 4px 6px;
    background: rgba(0, 0, 0, 0.4);
  }

  .waveform-time-label {
    font-size: 11px;
    font-family: monospace;
    color: rgba(255, 255, 255, 0.8);
  }
</style>
