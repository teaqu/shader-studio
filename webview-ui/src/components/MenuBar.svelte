<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  
  export let timeManager: any;
  export let currentFPS: number;
  export let canvasWidth: number = 0;
  export let canvasHeight: number = 0;
  export let isLocked: boolean = false;
  
  export let onReset: () => void = () => {};
  export let onTogglePause: () => void = () => {};
  export let onToggleLock: () => void = () => {};
  
  let currentTime = 0.00;
  let timeUpdateInterval: ReturnType<typeof setInterval>;
  let isPaused = false;
  
  onMount(() => {
    timeUpdateInterval = setInterval(() => {
      if (timeManager) {
        currentTime = timeManager.getCurrentTime(performance.now());
        // Update pause state reactively
        isPaused = timeManager.isPaused();
      }
    }, 16);
  });
  
  onDestroy(() => {
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
    }
  });
</script>

<div class="menu-bar">
  <div class="left-group">
    <button on:click={onReset} aria-label="Reset shader"> 
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <rect x="2" y="5" width="2" height="14" />
        <path d="M20 5L8 12L20 19V5Z" />
      </svg>
    </button>
    <button on:click={onTogglePause} aria-label="Toggle pause">
      {#if isPaused}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </svg>
      {/if}
    </button>
    <div class="menu-title">{currentTime.toFixed(2)}</div>
    <div class="menu-title">{currentFPS.toFixed(1)} FPS</div>
    <div class="menu-title">{canvasWidth} × {canvasHeight}</div>
  </div>
  <div class="right-group">
    <button on:click={onToggleLock} aria-label="Toggle lock">
      {#if isLocked}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" stroke="none" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </svg>
      {/if}
    </button>
  </div>
</div>
