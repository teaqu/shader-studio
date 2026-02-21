<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { currentTheme, toggleTheme } from "../stores/themeStore";
  import {
    aspectRatioStore,
    type AspectRatioMode,
  } from "../stores/aspectRatioStore";
  import { qualityStore, type QualityMode } from "../stores/qualityStore";
  import { isVSCodeEnvironment } from "../transport/TransportFactory";
  import TimeControls from "./TimeControls.svelte";
  import type { ShaderDebugState } from "../types/ShaderDebugState";

  import resetIcon from "../../assets/reset.svg?raw";
  import refreshIcon from "../../assets/refresh.svg?raw";
  import playIcon from "../../assets/play.svg?raw";
  import pauseIcon from "../../assets/pause.svg?raw";
  import moonIcon from "../../assets/moon.svg?raw";
  import sunIcon from "../../assets/sun.svg?raw";
  import lockIcon from "../../assets/lock.svg?raw";
  import unlockIcon from "../../assets/unlock.svg?raw";
  import fullscreenIcon from "../../assets/fullscreen.svg?raw";
  import menuIcon from "../../assets/menu.svg?raw";
  import configIcon from "../../assets/config.svg?raw";
  // Bug icon SVG for debug toggle
  const debugIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m8 2 1.88 1.88"/>
    <path d="M14.12 3.88 16 2"/>
    <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/>
    <path d="M12 20v-9"/>
    <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
    <path d="M6 13H2"/>
    <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/>
    <path d="M22 13h-4"/>
    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
  </svg>`;

  import { piRequestFullScreen } from "../../../../vendor/pilibs/src/piWebUtils.js";

  export let timeManager: any;
  export let currentFPS: number;
  export let canvasWidth: number = 0;
  export let canvasHeight: number = 0;
  export let isLocked: boolean = false;
  export let canvasElement: HTMLCanvasElement | null = null;
  export let errors: string[] = [];

  export let onReset: () => void = () => {};
  export let onRefresh: () => void = () => {};
  export let onTogglePause: () => void = () => {};
  export let onToggleLock: () => void = () => {};
  export let onAspectRatioChange: (mode: AspectRatioMode) => void = () => {};
  export let onQualityChange: (mode: QualityMode) => void = () => {};
  export let onZoomChange: (zoom: number) => void = () => {};
  export let onConfig: () => void = () => {};
  export let isDebugEnabled: boolean = false;
  export let onToggleDebugEnabled: () => void = () => {};
  export let debugState: ShaderDebugState | null = null;
  export let isConfigPanelVisible: boolean = false;
  export let onToggleConfigPanel: () => void = () => {};

  $: hasErrors = errors.length > 0;
  $: errorMessage = hasErrors ? errors.join('\n') : '';

  // Debug logging
  $: if (errors.length > 0) {
    console.log('[MenuBar] Errors updated:', errors, 'hasErrors:', hasErrors);
  }

  let currentTime = 0.0;
  let timeUpdateHandle: number | null = null;
  let isPaused = false;
  let theme: "light" | "dark" = "light";
  let showThemeButton = false;
  let showFullscreenButton = false;
  let currentAspectRatio: AspectRatioMode = "16:9";
  let currentQuality: QualityMode = "HD";
  let showResolutionMenu = false;
  let showOptionsMenu = false;
  let zoomLevel = 1.0;

  onMount(() => {
    if (timeManager) {
      currentTime = timeManager.getCurrentTime(performance.now());
      isPaused = timeManager.isPaused();

      const updateTime = () => {
        if (timeManager) {
          currentTime = timeManager.getCurrentTime(performance.now());
          isPaused = timeManager.isPaused();
        }
        timeUpdateHandle = requestAnimationFrame(updateTime);
      };

      timeUpdateHandle = requestAnimationFrame(updateTime);
    }

    showThemeButton = !isVSCodeEnvironment();
    showFullscreenButton = !isVSCodeEnvironment();

    const unsubscribeTheme = currentTheme.subscribe((value) => {
      theme = value;
    });

    const unsubscribeAspectRatio = aspectRatioStore.subscribe((state) => {
      currentAspectRatio = state.mode;
    });

    const unsubscribeQuality = qualityStore.subscribe((state) => {
      currentQuality = state.mode;
    });

    return () => {
      if (timeUpdateHandle !== null) {
        cancelAnimationFrame(timeUpdateHandle);
      }
      unsubscribeTheme();
      unsubscribeAspectRatio();
      unsubscribeQuality();
    };
  });

  onDestroy(() => {
    if (timeUpdateHandle !== null) {
      cancelAnimationFrame(timeUpdateHandle);
    }
  });

  function handleThemeToggle(event: MouseEvent) {
    event.stopPropagation();
    toggleTheme();
  }

  function handleRefresh(event: MouseEvent) {
    event.stopPropagation();
    showOptionsMenu = false;
    onRefresh();
  }

  function handleConfig(event: MouseEvent) {
    event.stopPropagation();
    showOptionsMenu = false;
    onConfig();
  }

  function handleFullscreenToggle() {
    if (canvasElement) {
      let container = canvasElement.parentElement;

      while (container && !container.classList.contains("canvas-container")) {
        container = container.parentElement;
      }

      if (container && container.classList.contains("canvas-container")) {
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
    showOptionsMenu = false;
  }

  function handleOptionsClick() {
    showOptionsMenu = !showOptionsMenu;
    showResolutionMenu = false;
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

  function handleToggleLock() {
    // Check if we're currently locked (before toggling)
    const wasLocked = isLocked;
    onToggleLock();
    // If we were locked and now unlocking, refresh
    if (wasLocked) {
      onRefresh();
    }
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;

    if (showResolutionMenu && !target.closest(".resolution-menu-container")) {
      showResolutionMenu = false;
    }

    if (showOptionsMenu && !target.closest(".options-menu-container")) {
      showOptionsMenu = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="menu-bar">
  <div class="left-group">
    <button on:click={onReset} aria-label="Reset shader">
      {@html resetIcon}
    </button>
    <div class="pause-button-container">
      <button
        on:click={onTogglePause}
        aria-label="Toggle pause"
        class:error={hasErrors}
      >
        {#if isPaused}
          {@html playIcon}
        {:else}
          {@html pauseIcon}
        {/if}
      </button>
      {#if hasErrors}
        <div class="error-tooltip">{errorMessage}</div>
      {/if}
    </div>
    <TimeControls {timeManager} {currentTime} />
    <div class="menu-title fps-display">{currentFPS.toFixed(1)} FPS</div>
    <div class="resolution-menu-container">
      <button
        class="menu-title resolution-button"
        on:click={handleResolutionClick}
        aria-label="Change resolution settings"
      >
        {canvasWidth} × {canvasHeight}
      </button>
      {#if showResolutionMenu}
        <div class="resolution-menu">
          <div class="resolution-section">
            <h4>Quality</h4>
            <button
              class="resolution-option menu-title"
              class:active={currentQuality === "HD"}
              on:click={() => handleQualitySelect("HD")}
            >
              HD
            </button>
            <button
              class="resolution-option menu-title"
              class:active={currentQuality === "SD"}
              on:click={() => handleQualitySelect("SD")}
            >
              SD
            </button>
          </div>

          <div class="resolution-section">
            <h4>Aspect Ratio</h4>
            <button
              class="resolution-option menu-title"
              class:active={currentAspectRatio === "16:9"}
              on:click={() => handleAspectRatioSelect("16:9")}
            >
              16:9
            </button>
            <button
              class="resolution-option menu-title"
              class:active={currentAspectRatio === "4:3"}
              on:click={() => handleAspectRatioSelect("4:3")}
            >
              4:3
            </button>
            <button
              class="resolution-option menu-title"
              class:active={currentAspectRatio === "1:1"}
              on:click={() => handleAspectRatioSelect("1:1")}
            >
              1:1
            </button>
            <button
              class="resolution-option menu-title"
              class:active={currentAspectRatio === "fill"}
              on:click={() => handleAspectRatioSelect("fill")}
            >
              Fill
            </button>
            <button
              class="resolution-option menu-title"
              class:active={currentAspectRatio === "auto"}
              on:click={() => handleAspectRatioSelect("auto")}
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
    <button
      class="collapse-debug"
      on:click={onToggleDebugEnabled}
      aria-label="Toggle debug mode"
      class:active={isDebugEnabled}
      title={debugState?.isActive
        ? `Debugging line ${(debugState.currentLine ?? 0) + 1}`
        : "Enable debug mode"}
    >
      {@html debugIcon}
    </button>
    <button
      class="collapse-config"
      on:click={onToggleConfigPanel}
      aria-label="Toggle config panel"
      class:active={isConfigPanelVisible}
      title="Toggle shader configuration panel"
    >
      {@html configIcon}
    </button>
    <button class="collapse-lock" on:click={handleToggleLock} aria-label="Toggle lock" class:active={isLocked}>
      {#if isLocked}
        {@html lockIcon}
      {:else}
        {@html unlockIcon}
      {/if}
    </button>
    <div class="options-menu-container">
      <button
        on:click={handleOptionsClick}
        aria-label="Open options menu"
        class="options-menu-button"
      >
        {@html menuIcon}
      </button>
      {#if showOptionsMenu}
        <div class="options-menu">
          <button
            class="options-menu-item show-debug"
            on:click={() => { onToggleDebugEnabled(); showOptionsMenu = false; }}
            aria-label="Toggle debug mode"
            class:active={isDebugEnabled}
          >
            {@html debugIcon}
            <span>Debug</span>
          </button>
          <button
            class="options-menu-item show-config"
            on:click={() => { onToggleConfigPanel(); showOptionsMenu = false; }}
            aria-label="Toggle config panel"
            class:active={isConfigPanelVisible}
          >
            {@html configIcon}
            <span>Config</span>
          </button>
          <button
            class="options-menu-item show-lock"
            on:click={() => { handleToggleLock(); showOptionsMenu = false; }}
            aria-label="Toggle lock"
            class:active={isLocked}
          >
            {#if isLocked}
              {@html lockIcon}
            {:else}
              {@html unlockIcon}
            {/if}
            <span>{isLocked ? 'Unlock' : 'Lock'}</span>
          </button>
          <button
            class="options-menu-item"
            on:click={handleRefresh}
            aria-label="Refresh shader"
          >
            {@html refreshIcon}
            <span>Refresh</span>
          </button>
          {#if showThemeButton}
            <button
              class="options-menu-item"
              on:click={handleThemeToggle}
              aria-label="Toggle theme"
            >
              {#if theme === "light"}
                {@html moonIcon}
                <span>Dark Mode</span>
              {:else}
                {@html sunIcon}
                <span>Light Mode</span>
              {/if}
            </button>
          {/if}
          {#if showFullscreenButton}
            <button
              class="options-menu-item"
              on:click={handleFullscreenToggle}
              aria-label="Toggle fullscreen"
            >
              {@html fullscreenIcon}
              <span>Fullscreen</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
</style>
