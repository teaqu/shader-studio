<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { currentTheme, toggleTheme } from "../stores/themeStore";
  import { aspectRatioStore, getAspectRatioLabel, type AspectRatioMode } from "../stores/aspectRatioStore";
  import { qualityStore, getQualityLabel, type QualityMode } from "../stores/qualityStore";
  import { isVSCodeEnvironment } from "../transport/TransportFactory";
  
  import resetIcon from '../../assets/reset.svg?raw';
  import playIcon from '../../assets/play.svg?raw';
  import pauseIcon from '../../assets/pause.svg?raw';
  import moonIcon from '../../assets/moon.svg?raw';
  import sunIcon from '../../assets/sun.svg?raw';
  import lockIcon from '../../assets/lock.svg?raw';
  import unlockIcon from '../../assets/unlock.svg?raw';
  import fullscreenIcon from '../../assets/fullscreen.svg?raw';
  
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
  export let onAspectRatioChange: (mode: AspectRatioMode) => void = () => {};
  export let onQualityChange: (mode: QualityMode) => void = () => {};
  export let onZoomChange: (zoom: number) => void = () => {};

  let currentTime = 0.0;
  let timeUpdateInterval: ReturnType<typeof setInterval>;
  let isPaused = false;
  let theme: 'light' | 'dark' = 'light';
  let showThemeButton = false;
  let showFullscreenButton = false;
  let currentAspectRatio: AspectRatioMode = '16:9';
  let currentQuality: QualityMode = 'HD';
  let showResolutionMenu = false;
  let zoomLevel = 1.0;

  onMount(() => {
    if (timeManager) {
      currentTime = timeManager.getCurrentTime(performance.now());
      isPaused = timeManager.isPaused();
      
      // Set up interval to update time continuously
      timeUpdateInterval = setInterval(() => {
        if (timeManager) {
          currentTime = timeManager.getCurrentTime(performance.now());
          isPaused = timeManager.isPaused();
        }
      }, 16); // Update every 16ms (~60fps) for smooth time display
    }

    showThemeButton = !isVSCodeEnvironment();
    showFullscreenButton = !isVSCodeEnvironment();

    const unsubscribeTheme = currentTheme.subscribe(value => {
      theme = value;
    });

    const unsubscribeAspectRatio = aspectRatioStore.subscribe(state => {
      currentAspectRatio = state.mode;
    });

    const unsubscribeQuality = qualityStore.subscribe(state => {
      currentQuality = state.mode;
    });

    return () => {
      if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
      }
      unsubscribeTheme();
      unsubscribeAspectRatio();
      unsubscribeQuality();
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
    if (canvasElement) {
      let container = canvasElement.parentElement;
      
      while (container && !container.classList.contains('canvas-container')) {
        container = container.parentElement;
      }
      
      if (container && container.classList.contains('canvas-container')) {
        piRequestFullScreen(container);
      } else {
        piRequestFullScreen(canvasElement.parentElement || canvasElement);
      }
    } else {
      piRequestFullScreen(null);
    }
  }

  function handleResolutionClick() {
    showResolutionMenu = !showResolutionMenu;
  }

  function handleAspectRatioSelect(mode: AspectRatioMode) {
    aspectRatioStore.setMode(mode);
    onAspectRatioChange(mode);
  }

  function handleQualitySelect(mode: QualityMode) {
    qualityStore.setMode(mode);
    onQualityChange(mode);
  }

  function handleZoomChange(event: Event) {
    const target = event.target as HTMLInputElement;
    zoomLevel = parseFloat(target.value);
    onZoomChange(zoomLevel);
  }

  function handleClickOutside(event: MouseEvent) {
    if (showResolutionMenu) {
      const target = event.target as HTMLElement;
      if (!target.closest('.resolution-menu-container')) {
        showResolutionMenu = false;
      }
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

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
    <div class="menu-title fixed-width">{currentTime.toFixed(2)}</div>
    <div class="menu-title fixed-width">{currentFPS.toFixed(1)} FPS</div>
    <div class="resolution-menu-container">
      <button class="menu-title resolution-button" on:click={handleResolutionClick} aria-label="Change resolution settings">
        {canvasWidth} × {canvasHeight}
      </button>
      {#if showResolutionMenu}
        <div class="resolution-menu">
          <div class="resolution-section">
            <h4>Quality</h4>
            <button 
              class="resolution-option menu-title"
              class:active={currentQuality === 'HD'}
              on:click={() => handleQualitySelect('HD')}
            >
              HD
            </button>
            <button 
              class="resolution-option menu-title"
              class:active={currentQuality === 'SD'}
              on:click={() => handleQualitySelect('SD')}
            >
              SD
            </button>
          </div>
          
          <div class="resolution-section">
            <h4>Aspect Ratio</h4>
            <button 
              class="resolution-option menu-title" 
              class:active={currentAspectRatio === '16:9'}
              on:click={() => handleAspectRatioSelect('16:9')}
            >
              16:9
            </button>
            <button 
              class="resolution-option menu-title" 
              class:active={currentAspectRatio === '4:3'}
              on:click={() => handleAspectRatioSelect('4:3')}
            >
              4:3
            </button>
            <button 
              class="resolution-option menu-title" 
              class:active={currentAspectRatio === '1:1'}
              on:click={() => handleAspectRatioSelect('1:1')}
            >
              1:1
            </button>
            <button 
              class="resolution-option menu-title" 
              class:active={currentAspectRatio === 'fill'}
              on:click={() => handleAspectRatioSelect('fill')}
            >
              Fill
            </button>
            <button 
              class="resolution-option menu-title" 
              class:active={currentAspectRatio === 'auto'}
              on:click={() => handleAspectRatioSelect('auto')}
            >
              Auto
            </button>
          </div>
          
          <div class="resolution-section">
            <h4>Zoom</h4>
            <div class="zoom-control">
              <label for="zoom-slider">Zoom: {zoomLevel.toFixed(1)}x</label>
              <input 
                id="zoom-slider"
                type="range" 
                min="0.1" 
                max="3.0" 
                step="0.1" 
                bind:value={zoomLevel}
                on:input={handleZoomChange}
                class="zoom-slider"
              />
            </div>
          </div>
        </div>
      {/if}
    </div>
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
