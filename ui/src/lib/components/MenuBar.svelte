<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { currentTheme, toggleTheme } from "../stores/themeStore";
  import { isVSCodeEnvironment } from "../transport/TransportFactory";

  export let timeManager: any;
  export let currentFPS: number;
  export let canvasWidth: number = 0;
  export let canvasHeight: number = 0;
  export let isLocked: boolean = false;

  export let onReset: () => void = () => {};
  export let onTogglePause: () => void = () => {};
  export let onToggleLock: () => void = () => {};

  let currentTime = 0.0;
  let timeUpdateInterval: ReturnType<typeof setInterval>;
  let isPaused = false;
  let theme: 'light' | 'dark' = 'light';
  let showThemeButton = false;

  onMount(() => {
    timeUpdateInterval = setInterval(() => {
      if (timeManager) {
        currentTime = timeManager.getCurrentTime(performance.now());
        // Update pause state reactively
        isPaused = timeManager.isPaused();
      }
    }, 16);

    showThemeButton = !isVSCodeEnvironment();

    const unsubscribe = currentTheme.subscribe(value => {
      theme = value;
    });

    return () => {
      unsubscribe();
    };
  });

  onDestroy(() => {
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
    }
  });

  function handleThemeToggle() {
    toggleTheme();
  }
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
    {#if showThemeButton}
      <button on:click={handleThemeToggle} aria-label="Toggle theme">
        {#if theme === 'light'}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {:else}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {/if}
      </button>
    {/if}
    <button on:click={onToggleLock} aria-label="Toggle lock">
      {#if isLocked}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect
            x="3"
            y="11"
            width="18"
            height="11"
            rx="2"
            ry="2"
            fill="currentColor"
            stroke="none"
          />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      {:else}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
      {/if}
    </button>
  </div>
</div>
