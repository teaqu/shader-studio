<svelte:options runes={true} />
<script lang="ts">
  interface Props {
    hasShader: boolean;
    isRecording: boolean;
    isActive?: boolean;
    onToggle?: () => void;
  }

  let { hasShader, isRecording, isActive = false, onToggle }: Props = $props();
</script>

<button
  class="collapse-record toolbar-icon-button"
  onclick={onToggle}
  aria-label="Toggle export panel"
  class:recording={isRecording}
  class:active={isActive}
  disabled={!hasShader}
  title="Export screenshot, video, or GIF"
>
  <i class="codicon codicon-device-camera"></i>
  {#if isRecording}
    <span class="recording-indicator"></span>
  {/if}
</button>

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
</style>
