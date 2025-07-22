<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { currentTheme, toggleTheme } from "../stores/themeStore";
  import { isVSCodeEnvironment } from "../transport/TransportFactory";
  
  import resetIcon from '../../assets/reset.svg?raw';
  import playIcon from '../../assets/play.svg?raw';
  import pauseIcon from '../../assets/pause.svg?raw';
  import moonIcon from '../../assets/moon.svg?raw';
  import sunIcon from '../../assets/sun.svg?raw';
  import lockIcon from '../../assets/lock.svg?raw';
  import unlockIcon from '../../assets/unlock.svg?raw';
  import fullscreenIcon from '../../assets/fullscreen.svg?raw';
  
  // Import piWebUtils functions
  import { piRequestFullScreen, piIsFullScreen, piExitFullScreen } from '../../../vendor/pilibs/src/piWebUtils.js';

  export let timeManager: any;
  export let currentFPS: number;
  export let canvasWidth: number = 0;
  export let canvasHeight: number = 0;
  export let isLocked: boolean = false;
  export let canvasElement: HTMLCanvasElement | null = null;

  export let onReset: () => void = () => {};
  export let onTogglePause: () => void = () => {};
  export let onToggleLock: () => void = () => {};

  let currentTime = 0.0;
  let timeUpdateInterval: ReturnType<typeof setInterval>;
  let isPaused = false;
  let theme: 'light' | 'dark' = 'light';
  let showThemeButton = false;
  let showFullscreenButton = false;

  onMount(() => {
    timeUpdateInterval = setInterval(() => {
      if (timeManager) {
        currentTime = timeManager.getCurrentTime(performance.now());
        // Update pause state reactively
        isPaused = timeManager.isPaused();
      }
    }, 16);

    showThemeButton = !isVSCodeEnvironment();
    showFullscreenButton = !isVSCodeEnvironment();

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

  function handleFullscreenToggle() {
    // For true canvas-only fullscreen like Shadertoy, target the canvas container
    if (canvasElement) {
      // Find the .canvas-container parent element
      let container = canvasElement.parentElement;
      
      // Look for the canvas-container class specifically
      while (container && !container.classList.contains('canvas-container')) {
        container = container.parentElement;
      }
      
      if (container && container.classList.contains('canvas-container')) {
        piRequestFullScreen(container);
      } else {
        // Fallback to canvas parent if container not found
        piRequestFullScreen(canvasElement.parentElement || canvasElement);
      }
    } else {
      // Fallback to document element if no canvas
      piRequestFullScreen(null);
    }
  }
</script>

<div class="menu-bar">
  <div class="left-group">
    <button on:click={onReset} aria-label="Reset shader">
      {@html resetIcon}
    </button>
    <button on:click={onTogglePause} aria-label="Toggle pause">
      {#if isPaused}
        {@html playIcon}
      {:else}
        {@html pauseIcon}
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
          {@html moonIcon}
        {:else}
          {@html sunIcon}
        {/if}
      </button>
    {/if}
    <button on:click={onToggleLock} aria-label="Toggle lock">
      {#if isLocked}
        {@html lockIcon}
      {:else}
        {@html unlockIcon}
      {/if}
    </button>
    {#if showFullscreenButton}
      <button on:click={handleFullscreenToggle} aria-label="Toggle fullscreen">
        {@html fullscreenIcon}
      </button>
    {/if}
  </div>
</div>
