<script lang="ts">
  import { onDestroy } from "svelte";
  import { recordingStore, type RecordingState } from "../../stores/recordingStore";
  import type { OnScreenshot, OnRecord } from "../../recording/types";
  import ScreenshotTab from "./ScreenshotTab.svelte";
  import VideoTab from "./VideoTab.svelte";
  import GifTab from "./GifTab.svelte";

  export let canvasWidth: number;
  export let canvasHeight: number;
  export let currentTime: number;
  export let onScreenshot: OnScreenshot;
  export let onRecord: OnRecord;
  export let onCancel: () => void;

  let recordingTab: "screenshot" | "video" | "gif" = "screenshot";

  // Recording store subscription
  let recordingState: RecordingState = { isRecording: false, isFinalizing: false, finalizingStartTime: 0, progress: 0, currentFrame: 0, totalFrames: 0, format: null, error: null, previewCanvas: null };
  const unsubRecording = recordingStore.subscribe((s) => {
    recordingState = s; 
  });
  $: recordingPercent = Math.round(recordingState.progress * 100);

  // Elapsed time ticker for finalization
  let finalizingElapsed = 0;
  let finalizingTimer: ReturnType<typeof setInterval> | null = null;
  $: if (recordingState.isFinalizing && !finalizingTimer) {
    finalizingElapsed = 0;
    finalizingTimer = setInterval(() => {
      finalizingElapsed = Math.round((performance.now() - recordingState.finalizingStartTime) / 1000);
    }, 500);
  } else if (!recordingState.isFinalizing && finalizingTimer) {
    clearInterval(finalizingTimer);
    finalizingTimer = null;
    finalizingElapsed = 0;
  }

  onDestroy(() => {
    unsubRecording();
    if (finalizingTimer) {
      clearInterval(finalizingTimer);
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

<div class="recording-tabs">
  <button class="recording-tab" class:active={recordingTab === "screenshot"} on:click={() => (recordingTab = "screenshot")} disabled={recordingState.isRecording}>Screenshot</button>
  <button class="recording-tab" class:active={recordingTab === "video"} on:click={() => (recordingTab = "video")} disabled={recordingState.isRecording}>Video</button>
  <button class="recording-tab" class:active={recordingTab === "gif"} on:click={() => (recordingTab = "gif")} disabled={recordingState.isRecording}>GIF</button>
</div>

{#if recordingState.isRecording}
  <div class="recording-tab-content">
    {#if recordingState.previewCanvas}
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
        {#if recordingState.isFinalizing}
          Encoding {recordingState.format?.toUpperCase()} ({recordingState.totalFrames} frames)...
        {:else}
          Recording {recordingState.format?.toUpperCase()}
        {/if}
      </div>
      <div class="recording-progress-bar">
        {#if recordingState.isFinalizing}
          <div class="recording-progress-fill recording-progress-indeterminate"></div>
        {:else}
          <div class="recording-progress-fill" style="width: {recordingPercent}%"></div>
        {/if}
      </div>
      {#if recordingState.isFinalizing}
        <div class="recording-info-text">
          {finalizingElapsed}s elapsed
        </div>
      {:else}
        <div class="recording-info-text">
          {recordingState.currentFrame} / {recordingState.totalFrames} frames ({recordingPercent}%)
        </div>
      {/if}
      <button class="recording-cancel-btn" on:click={onCancel}>Cancel</button>
    </div>
  </div>
{:else}
  <div class="recording-tab-content">
    {#if recordingTab === "screenshot"}
      <ScreenshotTab {canvasWidth} {canvasHeight} {currentTime} {onScreenshot} />
    {:else if recordingTab === "video"}
      <VideoTab {canvasWidth} {canvasHeight} {currentTime} {onRecord} />
    {:else if recordingTab === "gif"}
      <GifTab {canvasWidth} {canvasHeight} {currentTime} {onRecord} />
    {/if}
  </div>
{/if}

<style>
  .recording-tabs {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 1;
    background-color: var(--vscode-notifications-background);
    border-bottom: 1px solid var(--vscode-notifications-border);
  }

  .recording-tab {
    flex: 1;
    padding: 7px 0;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: -1px;
  }

  .recording-tab:hover {
    color: var(--vscode-editor-foreground);
    background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.04));
  }

  .recording-tab.active {
    color: var(--vscode-button-foreground);
    background-color: var(--vscode-button-background);
    border-bottom-color: var(--vscode-button-background);
  }

  .recording-tab:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .recording-tab-content {
    padding: 0.75rem 0.5rem 0.75rem 1rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  :global(.recording-submit) {
    margin-top: 0.25rem;
  }

  :global(.recording-info-text) {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    padding-top: 4px;
  }

  :global(.recording-custom-res) {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 2px 4px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: var(--vscode-input-background);
    cursor: pointer;
  }

  :global(.recording-custom-res.active) {
    border-color: var(--vscode-focusBorder);
  }

  :global(.recording-custom-res-input) {
    appearance: textfield;
    background: transparent;
    border: none;
    color: var(--vscode-input-foreground);
    font-size: 11px;
    width: 38px;
    text-align: center;
    padding: 1px 0;
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
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    line-height: 1;
  }

  :global(.recording-custom-fps) {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: var(--vscode-input-background);
    cursor: pointer;
    margin-left: 2px;
  }

  :global(.recording-custom-fps.active) {
    border-color: var(--vscode-focusBorder);
  }

  :global(.recording-custom-fps-input) {
    appearance: textfield;
    background: transparent;
    border: none;
    color: var(--vscode-input-foreground);
    font-size: 11px;
    width: 100%;
    min-width: 24px;
    text-align: center;
    padding: 1px 0;
    outline: none;
    -moz-appearance: textfield;
  }

  :global(.recording-duration-input) {
    width: 40px;
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
