<script lang="ts">
  import RecordingPanel from "./RecordingPanel.svelte";
  import type { OnScreenshot, OnRecord } from "../../recording/types";

  export let canvasWidth: number;
  export let canvasHeight: number;
  export let currentTime: number;
  export let hasShader: boolean;
  export let isRecording: boolean;
  export let onScreenshot: OnScreenshot;
  export let onRecord: OnRecord;
  export let onCancel: () => void;

  export let showMenu = false;

  export function toggle() {
    showMenu = !showMenu;
  }

  export function getIcon(): string {
    return '<i class="codicon codicon-device-camera"></i>';
  }

  export function isOpen(): boolean {
    return showMenu;
  }
</script>

<div class="recording-menu-container">
  <button
    class="collapse-record"
    on:click={toggle}
    aria-label="Export screenshot or recording"
    class:recording={isRecording}
    class:active={showMenu}
    disabled={!hasShader}
    title="Export screenshot, video, or GIF"
  >
    <i class="codicon codicon-device-camera"></i>
    {#if isRecording}
      <span class="recording-indicator"></span>
    {/if}
  </button>
  {#if showMenu}
    <div class="recording-menu">
      <RecordingPanel
        {canvasWidth}
        {canvasHeight}
        {currentTime}
        {onScreenshot}
        {onRecord}
        {onCancel}
      />
    </div>
  {/if}
</div>

<style>
  .collapse-record {
    position: relative;
  }

  .recording-indicator {
    position: absolute;
    top: 2px;
    right: 2px;
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

  .collapse-record.recording {
    color: #e53935;
  }

  .recording-menu-container {
    position: relative;
    display: flex;
  }

  .recording-menu {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 8px;
    background-color: var(--vscode-notifications-background);
    border: 1px solid var(--vscode-notifications-border);
    border-radius: 6px;
    padding: 0;
    min-width: 300px;
    max-height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 1301;
    animation: aspect-menu-appear 0.2s ease-out;
  }
</style>
