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

  const cameraIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
    <circle cx="12" cy="13" r="3"/>
  </svg>`;

  export function toggle() {
    showMenu = !showMenu;
  }

  export function getIcon(): string {
    return cameraIcon;
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
    {@html cameraIcon}
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
    z-index: 1000;
    animation: aspect-menu-appear 0.2s ease-out;
  }
</style>
