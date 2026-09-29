<script lang="ts">
  import { onDestroy } from "svelte";
  import { recordingStore, type RecordingState } from "../../stores/recordingStore";
  import type { OnScreenshot, OnRecord } from "../../recording/types";
  import ScreenshotTab from "./ScreenshotTab.svelte";
  import VideoTab from "./VideoTab.svelte";
  import GifTab from "./GifTab.svelte";

  interface Props {
    canvasWidth: number;
    canvasHeight: number;
    displayFrameRate: number;
    onScreenshot: OnScreenshot;
    onRecord: OnRecord;
    onCancel: () => void;
    onStopLive: () => void;
  }

  let {
    canvasWidth,
    canvasHeight,
    displayFrameRate,
    onScreenshot,
    onRecord,
    onCancel,
    onStopLive,
  }: Props = $props();

  let recordingTab: "screenshot" | "video" | "gif" = $state("screenshot");

  // Recording store subscription
  let recordingState: RecordingState = $state({ phase: "idle", isRecording: false, isLive: false, isPreparing: false, isFinalizing: false, finalizingStartTime: 0, progress: 0, currentFrame: 0, totalFrames: 0, preparationFrame: 0, preparationFrames: 0, format: null, error: null, notice: null, previewCanvas: null });
  const unsubRecording = recordingStore.subscribe((s) => {
    recordingState = s;
  });
  let recordingPercent = $derived(Math.round(recordingState.progress * 100));

  // Elapsed time ticker for finalization
  let finalizingElapsed = $state(0);
  let finalizingTimer: ReturnType<typeof setInterval> | null = null;
  let liveElapsed = $state(0);
  let liveTimer: ReturnType<typeof setInterval> | null = null;
  let liveStartedAt = 0;
  $effect(() => {
    const isFinalizing = recordingState.isFinalizing;
    const startTime = recordingState.finalizingStartTime;
    if (isFinalizing && !finalizingTimer) {
      finalizingElapsed = 0;
      finalizingTimer = setInterval(() => {
        finalizingElapsed = Math.round((performance.now() - startTime) / 1000);
      }, 500);
    } else if (!isFinalizing && finalizingTimer) {
      clearInterval(finalizingTimer);
      finalizingTimer = null;
      finalizingElapsed = 0;
    }
  });

  $effect(() => {
    const isLiveRecording = recordingState.isRecording && recordingState.isLive && !recordingState.isFinalizing;
    if (isLiveRecording && !liveTimer) {
      liveElapsed = 0;
      liveStartedAt = performance.now();
      liveTimer = setInterval(() => {
        liveElapsed = Math.floor((performance.now() - liveStartedAt) / 1000);
      }, 250);
    } else if (!isLiveRecording && liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
      liveElapsed = 0;
    }
  });

  onDestroy(() => {
    unsubRecording();
    if (finalizingTimer) {
      clearInterval(finalizingTimer);
    }
    if (liveTimer) {
      clearInterval(liveTimer);
    }
  });

  // Svelte action: mirrors content from a source canvas to a preview canvas on each frame
  function mirrorCanvas(node: HTMLCanvasElement, source: HTMLCanvasElement) {
    let rafId: number;
    const ctx = node.getContext("2d");

    function draw() {
      if (ctx && source) {
        node.width = source.width;
        node.height = source.height;
        ctx.drawImage(source, 0, 0);
      }
      rafId = requestAnimationFrame(draw);
    }
    rafId = requestAnimationFrame(draw);

    return {
      update(newSource: HTMLCanvasElement) {
        source = newSource; 
      },
      destroy() {
        cancelAnimationFrame(rafId); 
      },
    };
  }
</script>

<div class="recording-panel">
  <div class="tab-navigation">
    <button class="tab-button" class:active={recordingTab === "screenshot"} onclick={() => (recordingTab = "screenshot")} disabled={recordingState.isRecording}><span class="tab-label">Screenshot</span></button>
    <button class="tab-button" class:active={recordingTab === "video"} onclick={() => (recordingTab = "video")} disabled={recordingState.isRecording}><span class="tab-label">Video</span></button>
    <button class="tab-button" class:active={recordingTab === "gif"} onclick={() => (recordingTab = "gif")} disabled={recordingState.isRecording}><span class="tab-label">GIF</span></button>
  </div>

  {#if recordingState.notice}
    <div class="recording-notice" role="status">
      <span>{recordingState.notice}</span>
      <button class="recording-error-dismiss" onclick={() => recordingStore.reset()}>Dismiss</button>
    </div>
  {/if}

  {#if recordingState.error}
    <div class="recording-error" role="alert">
      <span>{recordingState.error}</span>
      <button class="recording-error-dismiss" onclick={() => recordingStore.reset()}>Dismiss</button>
    </div>
  {/if}

  {#if recordingState.isRecording}
    <div class="recording-tab-content">
      <div class="recording-tab-inner">
        {#if recordingState.previewCanvas && !recordingState.isLive}
          <div class="recording-preview">
            <canvas
              class="recording-preview-canvas"
              width={recordingState.previewCanvas.width}
              height={recordingState.previewCanvas.height}
              use:mirrorCanvas={recordingState.previewCanvas}
            ></canvas>
          </div>
        {/if}
        <div class="recording-progress-section">
          <div class="recording-progress-header">
            <span class="recording-dot-inline"></span>
            {#if recordingState.phase === "saving"}
              Saving {recordingState.format?.toUpperCase()}...
            {:else if recordingState.isPreparing}
              Preparing simulation
            {:else if recordingState.isFinalizing}
              Encoding {recordingState.format?.toUpperCase()} ({recordingState.totalFrames} frames)...
            {:else}
              Recording {recordingState.format?.toUpperCase()}
            {/if}
          </div>
          <div class="recording-progress-bar">
            {#if recordingState.isLive || recordingState.isFinalizing || recordingState.phase === "saving"}
              <div class="recording-progress-fill recording-progress-indeterminate"></div>
            {:else}
              <div class="recording-progress-fill" style="width: {recordingPercent}%"></div>
            {/if}
          </div>
          {#if recordingState.phase === "saving"}
            <div class="recording-info-text">Waiting for the host to finish saving</div>
          {:else if recordingState.isPreparing}
            <div class="recording-info-text">
              {recordingState.preparationFrame} / {recordingState.preparationFrames} preceding frames ({recordingPercent}%)
            </div>
          {:else if recordingState.isFinalizing}
            <div class="recording-info-text">
              {finalizingElapsed}s elapsed
            </div>
          {:else if recordingState.isLive}
            <div class="recording-info-text">
              {liveElapsed}s elapsed
            </div>
          {:else}
            <div class="recording-info-text">
              {recordingState.currentFrame} / {recordingState.totalFrames} frames ({recordingPercent}%)
            </div>
          {/if}
          {#if recordingState.phase !== "saving"}
            {#if recordingState.isLive && !recordingState.isFinalizing}
              <div class="recording-live-actions">
                <button class="recording-cancel-btn" onclick={onCancel}>Discard</button>
                <button class="export-action-btn" onclick={onStopLive}>Stop &amp; save</button>
              </div>
            {:else}
              <button class="recording-cancel-btn" onclick={onCancel}>Cancel</button>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="recording-tab-content">
      <div class="recording-tab-inner">
        {#if recordingTab === "screenshot"}
          <ScreenshotTab {canvasWidth} {canvasHeight} {onScreenshot} />
        {:else if recordingTab === "video"}
          <VideoTab {canvasWidth} {canvasHeight} {displayFrameRate} {onRecord} />
        {:else if recordingTab === "gif"}
          <GifTab {canvasWidth} {canvasHeight} {onRecord} />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .recording-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .recording-tab-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .recording-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 12px 0;
    padding: 6px 8px;
    border: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
    border-radius: 3px;
    font-size: 12px;
  }

  .recording-error {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 12px 0;
    padding: 8px;
    border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
    color: var(--vscode-errorForeground, #f48771);
    font-size: 11px;
  }

  .recording-error-dismiss {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  .recording-tab-inner {
    padding: 12px;
  }

  /* Override global menu-bar button styles for panel context */
  :global(.recording-tab-inner .scale-buttons) {
    flex-wrap: wrap;
    gap: 4px;
  }

  :global(.recording-tab-content .scale-buttons .resolution-option) {
    flex: 0 0 auto;
    width: auto;
    padding: 3px 8px;
    font-size: 11px;
    background: none;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-descriptionForeground, #888);
    margin-bottom: 0;
    transition: all 0.15s;
  }

  :global(.recording-tab-content .scale-buttons .resolution-option:hover) {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
    background: none;
  }

  :global(.recording-tab-content .scale-buttons .resolution-option.active) {
    background: var(--vscode-focusBorder, #007acc);
    border-color: var(--vscode-focusBorder, #007acc);
    color: #fff;
  }

  :global(.recording-tab-content .scale-buttons .resolution-option.active:hover) {
    background: var(--vscode-button-hoverBackground, #005f9e);
    border-color: var(--vscode-button-hoverBackground, #005f9e);
  }

  :global(.export-action-btn) {
    flex: 0 0 auto;
    padding: 3px 12px;
    font-size: 11px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-background);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  :global(.export-action-btn:hover) {
    background: var(--vscode-button-hoverBackground);
    border-color: var(--vscode-button-hoverBackground);
  }

  :global(.export-action-btn:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  :global(.recording-info-text) {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    padding-top: 4px;
  }

  :global(.recording-custom-res) {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-input-background);
    cursor: default;
    flex: 0 0 auto;
  }

  :global(.recording-custom-res.active) {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  :global(.recording-custom-res-input) {
    appearance: textfield;
    background: transparent;
    border: none;
    color: var(--vscode-input-foreground);
    font-size: 11px;
    width: 36px;
    text-align: center;
    padding: 0;
    outline: none;
    -moz-appearance: textfield;
  }

  :global(.recording-custom-res-input::placeholder) {
    color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
    opacity: 0.6;
  }

  :global(.recording-custom-res-input::-webkit-outer-spin-button),
  :global(.recording-custom-res-input::-webkit-inner-spin-button) {
    -webkit-appearance: none;
    margin: 0;
  }

  :global(.recording-custom-res-sep) {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
  }

  :global(.recording-custom-fps) {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-input-background);
    cursor: default;
    flex: 0 0 auto;
  }

  :global(.recording-custom-fps.active) {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  :global(.recording-custom-fps-input) {
    appearance: textfield;
    background: transparent;
    border: none;
    color: var(--vscode-input-foreground);
    font-size: 11px;
    width: 40px;
    text-align: center;
    padding: 0;
    outline: none;
    -moz-appearance: textfield;
  }

  :global(.recording-duration-input) {
    width: 36px;
  }

  :global(.recording-custom-fps-input::placeholder) {
    color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
    opacity: 0.6;
  }

  :global(.recording-custom-fps-input::-webkit-outer-spin-button),
  :global(.recording-custom-fps-input::-webkit-inner-spin-button) {
    -webkit-appearance: none;
    margin: 0;
  }

  .recording-preview {
    margin-bottom: 8px;
    border: 1px solid var(--vscode-notifications-border);
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  .recording-preview-canvas {
    width: 100%;
    height: auto;
    max-height: 160px;
    object-fit: contain;
  }

  .recording-progress-section {
    text-align: center;
  }

  .recording-progress-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--vscode-editor-foreground);
  }

  .recording-dot-inline {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #e53935;
    animation: pulse-dot 1s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .recording-progress-bar {
    height: 4px;
    background: var(--vscode-progressBar-background, #333);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 6px;
  }

  .recording-progress-fill {
    height: 100%;
    background: var(--vscode-focusBorder, #4fc3f7);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .recording-progress-indeterminate {
    width: 30% !important;
    background: #66bb6a;
    animation: indeterminate-slide 1.5s ease-in-out infinite;
  }

  @keyframes indeterminate-slide {
    0% { margin-left: 0%; }
    50% { margin-left: 70%; }
    100% { margin-left: 0%; }
  }

  .recording-cancel-btn {
    margin-top: 8px;
    padding: 4px 16px;
    border: 1px solid var(--vscode-notifications-border);
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-editor-foreground);
    cursor: pointer;
    font-size: 11px;
  }

  .recording-cancel-btn:hover {
    background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.1));
  }
</style>
