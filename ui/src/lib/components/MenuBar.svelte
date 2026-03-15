<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { currentTheme, toggleTheme } from "../stores/themeStore";
  import {
    aspectRatioStore,
    type AspectRatioMode,
  } from "../stores/aspectRatioStore";
  import { resolutionStore, type ResolutionState } from "../stores/resolutionStore";
  import { isVSCodeEnvironment } from "../transport/TransportFactory";
  import TimeControls from "./TimeControls.svelte";
  import type { ShaderDebugState } from "../types/ShaderDebugState";
  import RecordingButton from "./recording/RecordingButton.svelte";
  import type { OnScreenshot, OnRecord } from "../recording/types";






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
  export let onZoomChange: (zoom: number) => void = () => {};
  export let onFpsLimitChange: (limit: number) => void = () => {};
  export let onConfig: () => void = () => {};
  export let isDebugEnabled: boolean = false;
  export let onToggleDebugEnabled: () => void = () => {};
  export let debugState: ShaderDebugState | null = null;
  export let isConfigPanelVisible: boolean = false;
  export let onToggleConfigPanel: () => void = () => {};
  export let isEditorOverlayVisible: boolean = false;
  export let onToggleEditorOverlay: () => void = () => {};
  export let isVimModeEnabled: boolean = false;
  export let onToggleVimMode: () => void = () => {};
  export let onFork: () => void = () => {};
  export let onExtensionCommand: (command: string) => void = () => {};
  import type { AudioVideoController } from "../AudioVideoController";
  export let audioVolume: number = 1.0;
  export let audioMuted: boolean = true;
  export let audioVideoController: AudioVideoController | undefined = undefined;
  export let isPerformancePanelVisible: boolean = false;
  export let onTogglePerformancePanel: () => void = () => {};

  function onVolumeChange(volume: number) {
    audioVideoController?.setVolume(volume);
  }

  function onToggleMute() {
    audioVideoController?.toggleMute();
  }
  export let hasShader: boolean = false;
  export let onResetLayout: () => void = () => {};
  export let previewVisible: boolean = true;
  export let onShowPreview: () => void = () => {};
  export let onScreenshot: OnScreenshot = () => {};
  export let onRecord: OnRecord = () => {};
  export let onCancel: () => void = () => {};
  export let isRecording: boolean = false;






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
  let currentResolution: ResolutionState = { scale: 1, savedToConfig: false };
  let showResolutionMenu = false;
  let customWidthInput = "";
  let customHeightInput = "";
  let showFPSMenu = false;
  let showOptionsMenu = false;
  let recordingButton: RecordingButton;
  let recordingMenuOpen = false;
  let zoomLevel = 1.0;
  let currentFPSLimit = 0;

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

    const unsubscribeResolution = resolutionStore.subscribe((state) => {
      currentResolution = state;
      if (state.customWidth !== undefined && state.customHeight !== undefined) {
        customWidthInput = String(state.customWidth);
        customHeightInput = String(state.customHeight);
      }
    });

    return () => {
      if (timeUpdateHandle !== null) {
        cancelAnimationFrame(timeUpdateHandle);
      }
      unsubscribeTheme();
      unsubscribeAspectRatio();
      unsubscribeResolution();
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
        container.requestFullscreen();
      } else {
        (canvasElement.parentElement || canvasElement).requestFullscreen();
      }
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  function handleResolutionClick() {
    showResolutionMenu = !showResolutionMenu;
    showFPSMenu = false;
    showOptionsMenu = false;
  }

  function handleFPSClick() {
    showFPSMenu = !showFPSMenu;
    showResolutionMenu = false;
    showOptionsMenu = false;
  }

  function handleFPSLimitSelect(limit: number) {
    currentFPSLimit = limit;
    onFpsLimitChange(limit);
  }

  function handleOptionsClick() {
    showOptionsMenu = !showOptionsMenu;
    showResolutionMenu = false;
    showFPSMenu = false;
  }

  function handleRecordingClick() {
    showResolutionMenu = false;
    showFPSMenu = false;
    showOptionsMenu = false;
    recordingButton?.toggle();
  }

  function handleAspectRatioSelect(mode: AspectRatioMode) {
    aspectRatioStore.setMode(mode);
    onAspectRatioChange(mode);
  }

  function handleResolutionScaleSelect(scale: number) {
    resolutionStore.setScale(scale);
  }

  function handleApplyCustomResolution() {
    const wTrimmed = customWidthInput.trim();
    const hTrimmed = customHeightInput.trim();
    if (wTrimmed && hTrimmed) {
      resolutionStore.setCustomResolution(wTrimmed, hTrimmed);
    }
  }

  function handleClearCustomResolution() {
    customWidthInput = "";
    customHeightInput = "";
    resolutionStore.clearCustomResolution();
  }

  function handleToggleSaveToConfig() {
    // No-op: save-to-config not yet wired up
  }

  function handleResetResolution() {
    customWidthInput = "";
    customHeightInput = "";
    resolutionStore.reset();
    aspectRatioStore.setMode("auto");
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

  function handleVolumeSlider(event: Event) {
    const target = event.target as HTMLInputElement;
    onVolumeChange(parseFloat(target.value));
  }




  // Track where mousedown started so we don't close menus when a drag
  // (e.g. text selection in an input) ends outside the menu.
  let mouseDownTarget: HTMLElement | null = null;

  function handleWindowMouseDown(event: MouseEvent) {
    mouseDownTarget = event.target as HTMLElement;
  }

  function handleClickOutside(event: MouseEvent) {
    const clickTarget = event.target as HTMLElement;

    // Only close if BOTH mousedown and mouseup were outside the container
    if (showResolutionMenu
      && !clickTarget.closest(".resolution-menu-container")
      && !mouseDownTarget?.closest(".resolution-menu-container")) {
      showResolutionMenu = false;
    }

    if (showFPSMenu
      && !clickTarget.closest(".fps-menu-container")
      && !mouseDownTarget?.closest(".fps-menu-container")) {
      showFPSMenu = false;
    }

    if (showOptionsMenu
      && !clickTarget.closest(".options-menu-container")
      && !mouseDownTarget?.closest(".options-menu-container")) {
      showOptionsMenu = false;
    }

    mouseDownTarget = null;
  }

</script>

<svelte:window on:mousedown={handleWindowMouseDown} on:click={handleClickOutside} />

<div class="menu-bar">
  <div class="left-group">
    <button on:click={onReset} aria-label="Reset shader" disabled={!hasShader}>
      <i class="codicon codicon-debug-restart"></i>
    </button>
    <div class="pause-button-container">
      <button
        on:click={onTogglePause}
        aria-label="Toggle pause"
        class:error={hasErrors}
        disabled={!hasShader}
      >
        {#if isPaused}
          <i class="codicon codicon-play"></i>
        {:else}
          <i class="codicon codicon-debug-pause"></i>
        {/if}
      </button>
      {#if hasErrors}
        <div class="error-tooltip">{errorMessage}</div>
      {/if}
    </div>
    <TimeControls {timeManager} {currentTime} disabled={!hasShader} />
    <div class="fps-menu-container">
      <button
        class="menu-title fps-button"
        on:click={handleFPSClick}
        aria-label="Change FPS limit"
        disabled={!hasShader}
      >
        {currentFPS.toFixed(1)} FPS
      </button>
      {#if showFPSMenu}
        <div class="fps-menu">
          <div class="resolution-section">
            <h4>Frame Rate Limit</h4>
            <button
              class="resolution-option menu-title"
              class:active={currentFPSLimit === 30}
              on:click={() => handleFPSLimitSelect(30)}
            >
              30 FPS
            </button>
            <button
              class="resolution-option menu-title"
              class:active={currentFPSLimit === 60}
              on:click={() => handleFPSLimitSelect(60)}
            >
              60 FPS
            </button>
            <button
              class="resolution-option menu-title"
              class:active={currentFPSLimit === 0}
              on:click={() => handleFPSLimitSelect(0)}
            >
              Unlimited
            </button>
          </div>
          <div class="resolution-separator"></div>
          <button
            class="resolution-option menu-title"
            class:active={isPerformancePanelVisible}
            on:click={() => { onTogglePerformancePanel(); showFPSMenu = false; }}
          >
            <i class="codicon codicon-graph-line"></i> Frame Times
          </button>
        </div>
      {/if}
    </div>
    <div class="resolution-menu-container">
      <button
        class="menu-title resolution-button"
        on:click={handleResolutionClick}
        aria-label="Change resolution settings"
        disabled={!hasShader}
      >
        {canvasWidth} × {canvasHeight}
      </button>
      {#if showResolutionMenu}
        {@const hasCustom = currentResolution.customWidth !== undefined && currentResolution.customHeight !== undefined}
        <div class="resolution-menu">
          <div class="resolution-section">
            <h4>Resolution Scale</h4>
            <div class="scale-buttons">
              {#each [0.25, 0.5, 1, 2, 4] as scale}
                <button
                  class="resolution-option menu-title"
                  class:active={!hasCustom && currentResolution.scale === scale}
                  disabled={hasCustom}
                  on:click={() => handleResolutionScaleSelect(scale)}
                >
                  {scale}x
                </button>
              {/each}
            </div>
          </div>

          <div class="resolution-section">
            <h4>Custom Resolution</h4>
            <div class="custom-resolution-row">
              <input
                type="text"
                class="custom-res-input"
                placeholder="px or %"
                bind:value={customWidthInput}
              />
              <span class="custom-res-separator">&times;</span>
              <input
                type="text"
                class="custom-res-input"
                placeholder="px or %"
                bind:value={customHeightInput}
              />
              <button
                class="custom-res-btn"
                on:click={handleApplyCustomResolution}
                disabled={!customWidthInput || !customHeightInput}
              >
                Apply
              </button>
              {#if hasCustom}
                <button
                  class="custom-res-btn clear-btn"
                  on:click={handleClearCustomResolution}
                >
                  Clear
                </button>
              {/if}
            </div>
          </div>

          <div class="resolution-section">
            <h4>Aspect Ratio</h4>
            <div class="scale-buttons">
              <button class="resolution-option menu-title" class:active={currentAspectRatio === "16:9"} disabled={hasCustom} on:click={() => handleAspectRatioSelect("16:9")}>16:9</button>
              <button class="resolution-option menu-title" class:active={currentAspectRatio === "4:3"} disabled={hasCustom} on:click={() => handleAspectRatioSelect("4:3")}>4:3</button>
              <button class="resolution-option menu-title" class:active={currentAspectRatio === "1:1"} disabled={hasCustom} on:click={() => handleAspectRatioSelect("1:1")}>1:1</button>
              <button class="resolution-option menu-title" class:active={currentAspectRatio === "fill"} disabled={hasCustom} on:click={() => handleAspectRatioSelect("fill")}>Fill</button>
              <button class="resolution-option menu-title" class:active={currentAspectRatio === "auto"} disabled={hasCustom} on:click={() => handleAspectRatioSelect("auto")}>Auto</button>
            </div>
          </div>

          <div class="resolution-section save-to-config-section">
            <label class="save-to-config-label">
              <input
                type="checkbox"
                checked={currentResolution.savedToConfig}
                on:change={handleToggleSaveToConfig}
              />
              Save to shader config
            </label>
            <button class="reset-resolution-btn" on:click={handleResetResolution}>
              Reset
            </button>
          </div>

          <div class="resolution-separator"></div>

          <div class="resolution-section">
            <div class="zoom-header">
              <h4>Zoom</h4>
              <button class="reset-resolution-btn" on:click={() => { zoomLevel = 1.0; onZoomChange(1.0); }}>
                Reset
              </button>
            </div>
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
      disabled={!hasShader}
      title={debugState?.isActive
        ? `Debugging line ${(debugState.currentLine ?? 0) + 1}`
        : "Enable debug mode"}
    >
      <i class="codicon codicon-bug"></i>
    </button>
    <button
      class="collapse-editor"
      on:click={onToggleEditorOverlay}
      aria-label="Toggle editor overlay"
      class:active={isEditorOverlayVisible}
      disabled={!hasShader}
      title="Toggle editor overlay"
    >
      <i class="codicon codicon-code"></i>
    </button>
    <button
      class="collapse-fork"
      on:click={() => { onFork(); }}
      aria-label="Fork shader"
      disabled={!hasShader}
      title="Fork shader to a new file"
    >
      <i class="codicon codicon-repo-forked"></i>
    </button>
    <button
      class="collapse-config"
      on:click={onToggleConfigPanel}
      aria-label="Toggle config panel"
      class:active={isConfigPanelVisible}
      disabled={!hasShader}
      title="Toggle shader configuration panel"
    >
      <i class="codicon codicon-gear"></i>
    </button>
    <RecordingButton
      bind:this={recordingButton}
      bind:showMenu={recordingMenuOpen}
      {canvasWidth}
      {canvasHeight}
      {currentTime}
      {hasShader}
      {isRecording}
      {onScreenshot}
      {onRecord}
      {onCancel}
    />
    <button class="collapse-lock" on:click={handleToggleLock} aria-label="Toggle lock" class:active={isLocked} disabled={!hasShader}>
      {#if isLocked}
        <i class="codicon codicon-lock"></i>
      {:else}
        <i class="codicon codicon-unlock"></i>
      {/if}
    </button>
    <div class="options-menu-container">
      <button
        on:click={handleOptionsClick}
        aria-label="Open options menu"
        class="options-menu-button"
      >
        <i class="codicon codicon-menu"></i>
      </button>
      {#if showOptionsMenu}
        <div class="options-menu">
          {#if !previewVisible}
            <button
              class="options-menu-item"
              on:click={() => { onShowPreview(); showOptionsMenu = false; }}
              aria-label="Show preview"
            >
              <i class="codicon codicon-play"></i>
              <span>Show Preview</span>
            </button>
          {/if}
          <button
            class="options-menu-item show-debug"
            on:click={() => { onToggleDebugEnabled(); showOptionsMenu = false; }}
            aria-label="Toggle debug mode"
            class:active={isDebugEnabled}
            disabled={!hasShader}
          >
            <i class="codicon codicon-bug"></i>
            <span>Debug</span>
          </button>
          <button
            class="options-menu-item show-editor"
            on:click={() => { onToggleEditorOverlay(); showOptionsMenu = false; }}
            aria-label="Toggle editor overlay"
            class:active={isEditorOverlayVisible}
            disabled={!hasShader}
          >
            <i class="codicon codicon-code"></i>
            <span>Editor</span>
          </button>
          {#if isEditorOverlayVisible}
            <button
              class="options-menu-item options-submenu-item"
              on:click={() => { onToggleVimMode(); }}
              aria-label="Toggle vim mode"
              class:active={isVimModeEnabled}
            >
              <span>Vim Mode</span>
            </button>
          {/if}
          <button
            class="options-menu-item show-fork"
            on:click={() => { onFork(); showOptionsMenu = false; }}
            aria-label="Fork shader"
            disabled={!hasShader}
          >
            <i class="codicon codicon-repo-forked"></i>
            <span>Fork</span>
          </button>
          <button
            class="options-menu-item show-record"
            on:click={() => { showOptionsMenu = false; handleRecordingClick(); }}
            aria-label="Export recording"
            class:active={recordingMenuOpen}
            disabled={!hasShader}
          >
            {@html recordingButton?.getIcon() ?? ''}
            <span>Export</span>
          </button>
          <button
            class="options-menu-item show-config"
            on:click={() => { onToggleConfigPanel(); showOptionsMenu = false; }}
            aria-label="Toggle config panel"
            class:active={isConfigPanelVisible}
            disabled={!hasShader}
          >
            <i class="codicon codicon-gear"></i>
            <span>Config</span>
          </button>
          <button
            class="options-menu-item show-lock"
            on:click={() => { handleToggleLock(); showOptionsMenu = false; }}
            aria-label="Toggle lock"
            class:active={isLocked}
            disabled={!hasShader}
          >
            {#if isLocked}
              <i class="codicon codicon-lock"></i>
            {:else}
              <i class="codicon codicon-unlock"></i>
            {/if}
            <span>{isLocked ? 'Unlock' : 'Lock'}</span>
          </button>
          <button
            class="options-menu-item"
            on:click={() => { onResetLayout(); showOptionsMenu = false; }}
            aria-label="Reset layout"
            disabled={!hasShader}
          >
            <i class="codicon codicon-debug-restart"></i>
            <span>Reset Layout</span>
          </button>
          <button
            class="options-menu-item"
            on:click={handleRefresh}
            aria-label="Refresh shader"
            disabled={!hasShader}
          >
            <i class="codicon codicon-refresh"></i>
            <span>Refresh</span>
          </button>
          <div class="options-menu-divider"></div>
          <div class="volume-slider-container">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={audioVolume}
              on:input={handleVolumeSlider}
              class="volume-slider"
              aria-label="Volume"
              class:muted-slider={audioMuted}
            />
            <span class="volume-label">{Math.round(audioVolume * 100)}%</span>
            <button
              class="mute-icon-btn"
              on:click|stopPropagation={() => { onToggleMute(); }}
              aria-label="Toggle mute"
              class:muted={audioMuted}
            >
              {#if audioMuted}
                <i class="codicon codicon-mute"></i>
              {:else}
                <i class="codicon codicon-unmute"></i>
              {/if}
            </button>
          </div>
          <div class="options-menu-divider"></div>
          {#if showThemeButton}
            <button
              class="options-menu-item"
              on:click={handleThemeToggle}
              aria-label="Toggle theme"
            >
              {#if theme === "light"}
                <i class="codicon codicon-color-mode"></i>
                <span>Dark Mode</span>
              {:else}
                <i class="codicon codicon-color-mode"></i>
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
              <i class="codicon codicon-screen-full"></i>
              <span>Fullscreen</span>
            </button>
          {/if}
          <div class="options-menu-separator"></div>
          <button
            class="options-menu-item"
            on:click={() => { onExtensionCommand('newShader'); showOptionsMenu = false; }}
            aria-label="New shader"
          >
            <i class="codicon codicon-new-file"></i>
            <span>New Shader</span>
          </button>
          <button
            class="options-menu-item"
            on:click={() => { onExtensionCommand('openShaderExplorer'); showOptionsMenu = false; }}
            aria-label="Shader explorer"
          >
            <i class="codicon codicon-book"></i>
            <span>Shader Explorer</span>
          </button>
          <button
            class="options-menu-item"
            on:click={() => { onExtensionCommand('openSnippetLibrary'); showOptionsMenu = false; }}
            aria-label="Snippet library"
          >
            <i class="codicon codicon-library"></i>
            <span>Snippet Library</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .options-menu-divider {
    height: 1px;
    background: var(--border-color, rgba(128, 128, 128, 0.3));
    margin: 4px 0;
  }

  .volume-slider-container {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
  }

  .volume-slider {
    flex: 1;
    height: 4px;
    cursor: pointer;
    accent-color: var(--accent-color, #007acc);
  }

  .volume-slider.muted-slider {
    opacity: 0.4;
  }

  .volume-label {
    font-size: 11px;
    min-width: 32px;
    text-align: right;
    opacity: 0.7;
  }

  .mute-icon-btn {
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: inherit;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .mute-icon-btn.muted {
    color: #e55;
  }
</style>
