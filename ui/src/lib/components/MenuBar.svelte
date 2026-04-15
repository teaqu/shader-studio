<svelte:options runes={true} />
<script lang="ts">
  import { onMount, onDestroy, getContext } from "svelte";
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
  import type { CompileMode } from "../stores/compileModeStore";
  import type { ResolutionSessionController } from "../resolution/ResolutionSessionController.svelte";

  type BufferResolutionMenuState = {
    mode: "none" | "fixed" | "scale";
    width: string;
    height: string;
    scale: number;
  }






  import type { AudioVideoController } from "../AudioVideoController";

  type MenuBarProps = {
    timeManager: any;
    currentFPS: number;
    canvasWidth?: number;
    canvasHeight?: number;
    isLocked?: boolean;
    canvasElement?: HTMLCanvasElement | null;
    errors?: string[];
    onReset?: () => void;
    onRefresh?: () => void;
    onTogglePause?: () => void;
    onToggleLock?: () => void;
    onZoomChange?: (zoom: number) => void;
    onFpsLimitChange?: (limit: number) => void;
    onConfig?: () => void;
    isDebugEnabled?: boolean;
    onToggleDebugEnabled?: () => void;
    debugState?: ShaderDebugState | null;
    isConfigPanelVisible?: boolean;
    onToggleConfigPanel?: () => void;
    isEditorOverlayVisible?: boolean;
    onToggleEditorOverlay?: () => void;
    isVimModeEnabled?: boolean;
    onToggleVimMode?: () => void;
    onFork?: () => void;
    onExtensionCommand?: (command: string) => void;
    audioVolume?: number;
    audioMuted?: boolean;
    audioVideoController?: AudioVideoController | undefined;
    isPerformancePanelVisible?: boolean;
    onTogglePerformancePanel?: () => void;
    compileMode?: CompileMode;
    onSetCompileMode?: (mode: CompileMode) => void;
    onManualCompile?: () => void;
    hasShader?: boolean;
    onResetLayout?: () => void;
    previewVisible?: boolean;
    onShowPreview?: () => void;
    onScreenshot?: OnScreenshot;
    onRecord?: OnRecord;
    onCancel?: () => void;
    isRecording?: boolean;
  };

  let {
    timeManager,
    currentFPS,
    canvasWidth = 0,
    canvasHeight = 0,
    isLocked = false,
    canvasElement = null,
    errors = [],
    onReset = () => {},
    onRefresh = () => {},
    onTogglePause = () => {},
    onToggleLock: onToggleLockProp = () => {},
    onZoomChange = () => {},
    onFpsLimitChange = () => {},
    onConfig = () => {},
    isDebugEnabled = false,
    onToggleDebugEnabled = () => {},
    debugState = null,
    isConfigPanelVisible = false,
    onToggleConfigPanel = () => {},
    isEditorOverlayVisible = false,
    onToggleEditorOverlay = () => {},
    isVimModeEnabled = false,
    onToggleVimMode = () => {},
    onFork = () => {},
    onExtensionCommand = () => {},
    audioVolume = 1.0,
    audioMuted = true,
    audioVideoController = undefined,
    isPerformancePanelVisible = false,
    onTogglePerformancePanel = () => {},
    compileMode = 'hot' as CompileMode,
    onSetCompileMode = () => {},
    onManualCompile = () => {},
    hasShader = false,
    onResetLayout = () => {},
    previewVisible = true,
    onShowPreview = () => {},
    onScreenshot = () => {},
    onRecord = () => {},
    onCancel = () => {},
    isRecording = false,
  }: MenuBarProps = $props();

  // Resolution state from context
  const resCtrl = getContext<ResolutionSessionController>('resolution');

  function onVolumeChange(volume: number) {
    audioVideoController?.setVolume(volume);
  }

  function onToggleMute() {
    audioVideoController?.toggleMute();
  }






  const hasErrors = $derived(errors.length > 0);
  const errorMessage = $derived(hasErrors ? errors.join('\n') : '');

  let currentTime = $state(0.0);
  let timeUpdateHandle: number | null = null;
  let isPaused = $state(false);
  let theme = $state<"light" | "dark">("light");
  let showThemeButton = $state(false);
  let showFullscreenButton = $state(false);
  let currentAspectRatio = $state<AspectRatioMode>("16:9");
  let currentResolution = $state<ResolutionState>({ scale: 1, forceBlackBackground: false, source: 'session' });
  let showResolutionMenu = $state(false);
  let customWidthInput = $state<number | null>(null);
  let customHeightInput = $state<number | null>(null);
  let showFPSMenu = $state(false);
  let showOptionsMenu = $state(false);
  let recordingButton = $state<RecordingButton>(undefined as any);
  let recordingMenuOpen = $state(false);
  let zoomLevel = $state(1.0);
  let currentFPSLimit = $state(0);
  let isPauseTooltipTriggerHovered = $state(false);
  let isPauseTooltipHovered = $state(false);
  let isPauseTooltipHoverArmed = $state(false);

  const compileModeIcons: Record<CompileMode, string> = {
    hot: "flame",
    save: "save",
    manual: "clock",
  };

  const compileModeLabels: Record<CompileMode, string> = {
    hot: "Hot compile mode",
    save: "Compile on save mode",
    manual: "Manual compile mode",
  };

  const isPauseTooltipVisible = $derived(
    isPauseTooltipTriggerHovered || (isPauseTooltipHoverArmed && isPauseTooltipHovered)
  );

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
        customWidthInput = Number(state.customWidth) || null;
        customHeightInput = Number(state.customHeight) || null;
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
    resCtrl.setAspectRatio(mode);
  }

  function handleResolutionScaleSelect(scale: number) {
    if (resCtrl.menuVM.targetKind === 'image') {
      resCtrl.setImageScale(scale);
    } else {
      resCtrl.setBufferScale(scale);
    }
  }

  function handleCustomResolutionInput() {
    if (customWidthInput && customHeightInput) {
      resCtrl.setImageCustomResolution(String(customWidthInput), String(customHeightInput));
    }
  }

  function handleClearCustomResolution(event: MouseEvent) {
    event.stopPropagation();
    customWidthInput = null;
    customHeightInput = null;
    resCtrl.setImageCustomResolution(undefined, undefined);
  }

  function handleResetResolution() {
    customWidthInput = null;
    customHeightInput = null;
    resCtrl.resetCurrentTarget();
  }

  function handleZoomChange(event: Event) {
    const target = event.target as HTMLInputElement;
    zoomLevel = parseFloat(target.value);
    onZoomChange(zoomLevel);
  }

  function handleForceBlackBackgroundChange(event: Event) {
    const target = event.target as HTMLInputElement;
    resolutionStore.setForceBlackBackground(target.checked);
  }

  function handleSyncWithConfigChange(event: Event) {
    const target = event.target as HTMLInputElement;
    resCtrl.setSyncWithConfig(target.checked);
  }

  function handleBufferWidthInput(event: Event) {
    const width = (event.target as HTMLInputElement).value;
    resCtrl.setBufferFixedResolution(width, resCtrl.menuVM.bufferResolutionState.height);
  }

  function handleBufferHeightInput(event: Event) {
    const height = (event.target as HTMLInputElement).value;
    resCtrl.setBufferFixedResolution(resCtrl.menuVM.bufferResolutionState.width, height);
  }

  function handleToggleLock() {
    // Check if we're currently locked (before toggling)
    const wasLocked = isLocked;
    onToggleLockProp();
    // If we were locked and now unlocking, refresh
    if (wasLocked) {
      onRefresh();
    }
  }

  function handleVolumeSlider(event: Event) {
    const target = event.target as HTMLInputElement;
    onVolumeChange(parseFloat(target.value));
  }

  function handlePauseTooltipTriggerEnter() {
    isPauseTooltipHoverArmed = true;
    isPauseTooltipTriggerHovered = true;
  }

  function handlePauseTooltipTriggerLeave(event: MouseEvent) {
    isPauseTooltipTriggerHovered = false;
    const nextTarget = event.relatedTarget as Node | null;
    const enteredTooltip =
      nextTarget instanceof Node &&
        (nextTarget as HTMLElement).closest?.('.error-tooltip');
    if (!isPauseTooltipHovered && !enteredTooltip) {
      isPauseTooltipHoverArmed = false;
    }
  }

  function handlePauseTooltipEnter() {
    isPauseTooltipHovered = true;
  }

  function handlePauseTooltipLeave(event: MouseEvent) {
    isPauseTooltipHovered = false;
    const nextTarget = event.relatedTarget as Node | null;
    const returnedToTrigger =
      nextTarget instanceof Node &&
        (nextTarget as HTMLElement).closest?.('.pause-button-container button');
    if (!returnedToTrigger) {
      isPauseTooltipHoverArmed = false;
    }
  }




  // Track where mousedown started so we don't close menus when a drag
  // (e.g. text selection in an input) ends outside the menu.
  let mouseDownTarget: HTMLElement | null = $state(null);

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
    {#if compileMode === "manual"}
      <button
        class="compile-now-button toolbar-icon-button"
        on:click={onManualCompile}
        aria-label="Compile shader"
        disabled={!hasShader}
        title="Compile shader"
      >
        <i class="codicon codicon-run-all"></i>
      </button>
    {/if}
    <button class="toolbar-icon-button" on:click={onReset} aria-label="Reset shader" disabled={!hasShader}>
      <i class="codicon codicon-debug-restart"></i>
    </button>
    <div class="pause-button-container">
      <button
        class="toolbar-icon-button"
        on:click={onTogglePause}
        aria-label="Toggle pause"
        class:error={hasErrors}
        disabled={!hasShader}
        on:mouseenter={handlePauseTooltipTriggerEnter}
        on:mouseleave={handlePauseTooltipTriggerLeave}
      >
        {#if isPaused}
          <i class="codicon codicon-play"></i>
        {:else}
          <i class="codicon codicon-debug-pause"></i>
        {/if}
      </button>
      {#if hasErrors}
        <div
          class="error-tooltip"
          class:visible={isPauseTooltipVisible}
          role="presentation"
          on:mouseenter={handlePauseTooltipEnter}
          on:mouseleave={handlePauseTooltipLeave}
        >{errorMessage}</div>
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
            on:click={() => {
              onTogglePerformancePanel(); showFPSMenu = false; 
            }}
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
          <div class="resolution-section save-to-config-section">
            <label class="save-to-config-label">
              <input
                type="checkbox"
                aria-label="Sync With Config"
                checked={resCtrl.menuVM.syncWithConfig}
                on:change={handleSyncWithConfigChange}
              />
              Sync With Config
            </label>
            {#if !resCtrl.menuVM.syncWithConfig}
              <div class="save-to-config-hint">Local Override</div>
            {/if}
            <div class="save-to-config-target">Target: {resCtrl.menuVM.targetLabel}</div>
          </div>

          {#if resCtrl.menuVM.targetKind === "image"}
            <div class="resolution-section">
              <div class="resolution-section-header">
                <h4>Resolution Scale</h4>
                <button class="reset-resolution-btn" on:click={handleResetResolution}>Reset</button>
              </div>
              <div class="scale-buttons">
                {#each [0.25, 0.5, 1, 2, 4] as scale}
                  <button
                    class="resolution-option menu-title"
                    class:active={currentResolution.scale === scale}
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
                  type="number"
                  class="custom-res-input"
                  placeholder="W"
                  min="1"
                  step="1"
                  bind:value={customWidthInput}
                  on:input={handleCustomResolutionInput}
                />
                <span class="custom-res-separator">&times;</span>
                <input
                  type="number"
                  class="custom-res-input"
                  placeholder="H"
                  min="1"
                  step="1"
                  bind:value={customHeightInput}
                  on:input={handleCustomResolutionInput}
                />
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
          {:else}
            <div class="resolution-section">
              <div class="resolution-section-header">
                <h4>Buffer Resolution</h4>
                <button class="reset-resolution-btn" on:click={handleResetResolution}>Reset</button>
              </div>
              <div class="scale-buttons">
                <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "none"} on:click={() => resCtrl.setBufferResolutionMode("none")}>Inherit</button>
                <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "fixed"} on:click={() => resCtrl.setBufferResolutionMode("fixed")}>Fixed px</button>
                <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "scale"} on:click={() => resCtrl.setBufferResolutionMode("scale")}>Scale</button>
              </div>
            </div>

            {#if resCtrl.menuVM.bufferResolutionState.mode === "fixed"}
              <div class="resolution-section">
                <h4>Fixed Size</h4>
                <div class="custom-resolution-row">
                  <input
                    type="number"
                    class="custom-res-input"
                    placeholder="Width"
                    min="1"
                    step="1"
                    value={resCtrl.menuVM.bufferResolutionState.width}
                    on:input={handleBufferWidthInput}
                  />
                  <span class="custom-res-separator">&times;</span>
                  <input
                    type="number"
                    class="custom-res-input"
                    placeholder="Height"
                    min="1"
                    step="1"
                    value={resCtrl.menuVM.bufferResolutionState.height}
                    on:input={handleBufferHeightInput}
                  />
                </div>
              </div>
            {/if}

            {#if resCtrl.menuVM.bufferResolutionState.mode === "scale"}
              <div class="resolution-section">
                <h4>Resolution Scale</h4>
                <div class="scale-buttons">
                  {#each [0.25, 0.5, 1, 2, 4] as scale}
                    <button
                      class="resolution-option menu-title"
                      class:active={resCtrl.menuVM.bufferResolutionState.scale === scale}
                      on:click={() => resCtrl.setBufferScale(scale)}
                    >
                      {scale}x
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          {/if}

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

          <div class="resolution-section save-to-config-section">
            <label class="save-to-config-label">
              <input
                type="checkbox"
                checked={currentResolution.forceBlackBackground}
                on:change={handleForceBlackBackgroundChange}
              />
              Black canvas background
            </label>
          </div>
        </div>
      {/if}
    </div>
  </div>
  <div class="right-group">
    <button
      class="collapse-debug toolbar-icon-button"
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
      class="collapse-editor toolbar-icon-button"
      on:click={onToggleEditorOverlay}
      aria-label="Toggle editor overlay"
      class:active={isEditorOverlayVisible}
      disabled={!hasShader}
      title="Toggle editor overlay"
    >
      <i class="codicon codicon-code"></i>
    </button>
    <button
      class="collapse-config toolbar-icon-button"
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
    <button class="collapse-lock toolbar-icon-button" on:click={handleToggleLock} aria-label="Toggle lock" class:active={isLocked} disabled={!hasShader}>
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
              on:click={() => {
                onShowPreview(); showOptionsMenu = false; 
              }}
              aria-label="Show preview"
            >
              <i class="codicon codicon-play"></i>
              <span>Show Preview</span>
            </button>
          {/if}
          <button
            class="options-menu-item show-lock"
            on:click={() => {
              handleToggleLock(); showOptionsMenu = false; 
            }}
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
            class="options-menu-item show-record"
            on:click={() => {
              showOptionsMenu = false; handleRecordingClick(); 
            }}
            aria-label="Export recording"
            class:active={recordingMenuOpen}
            disabled={!hasShader}
          >
            {@html recordingButton?.getIcon() ?? ''}
            <span>Export</span>
          </button>
          <button
            class="options-menu-item show-config"
            on:click={() => {
              onToggleConfigPanel(); showOptionsMenu = false; 
            }}
            aria-label="Toggle config panel"
            class:active={isConfigPanelVisible}
            disabled={!hasShader}
          >
            <i class="codicon codicon-gear"></i>
            <span>Config</span>
          </button>
          <button
            class="options-menu-item show-editor"
            on:click={() => {
              onToggleEditorOverlay(); showOptionsMenu = false; 
            }}
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
              on:click={() => {
                onToggleVimMode(); 
              }}
              aria-label="Toggle vim mode"
              class:active={isVimModeEnabled}
            >
              <span>Vim Mode</span>
            </button>
          {/if}
          <button
            class="options-menu-item show-debug"
            on:click={() => {
              onToggleDebugEnabled(); showOptionsMenu = false; 
            }}
            aria-label="Toggle debug mode"
            class:active={isDebugEnabled}
            disabled={!hasShader}
          >
            <i class="codicon codicon-bug"></i>
            <span>Debug</span>
          </button>
          <button
            class="options-menu-item"
            on:click={() => {
              onResetLayout(); showOptionsMenu = false; 
            }}
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
          <button
            class="options-menu-item"
            on:click={() => {
              onFork(); showOptionsMenu = false; 
            }}
            aria-label="Fork shader"
            disabled={!hasShader}
          >
            <i class="codicon codicon-repo-forked"></i>
            <span>Fork</span>
          </button>
          <button
            class="options-menu-item"
            on:click={() => {
              onExtensionCommand('newShader'); showOptionsMenu = false; 
            }}
            aria-label="New shader"
          >
            <i class="codicon codicon-new-file"></i>
            <span>New Shader</span>
          </button>
          <button
            class="options-menu-item"
            on:click={() => {
              onExtensionCommand('openShaderExplorer'); showOptionsMenu = false; 
            }}
            aria-label="Shader explorer"
          >
            <i class="codicon codicon-book"></i>
            <span>Shader Explorer</span>
          </button>
          <button
            class="options-menu-item"
            on:click={() => {
              onExtensionCommand('openSnippetLibrary'); showOptionsMenu = false; 
            }}
            aria-label="Snippet library"
          >
            <i class="codicon codicon-library"></i>
            <span>Snippet Library</span>
          </button>
          <div class="options-menu-divider"></div>
          <div class="options-menu-item compile-mode-menu-item">
            <span>Mode</span>
            <div class="compile-mode-selector" role="group" aria-label="Compile mode">
              <button
                class="compile-mode-button"
                class:active={compileMode === "hot"}
                on:click={() => onSetCompileMode("hot")}
                aria-label="Set hot compile mode"
                disabled={!hasShader}
                title={compileModeLabels.hot}
              >
                <i class={`codicon codicon-${compileModeIcons.hot}`}></i>
              </button>
              <button
                class="compile-mode-button"
                class:active={compileMode === "save"}
                on:click={() => onSetCompileMode("save")}
                aria-label="Set save compile mode"
                disabled={!hasShader}
                title={compileModeLabels.save}
              >
                <i class={`codicon codicon-${compileModeIcons.save}`}></i>
              </button>
              <button
                class="compile-mode-button"
                class:active={compileMode === "manual"}
                on:click={() => onSetCompileMode("manual")}
                aria-label="Set manual compile mode"
                disabled={!hasShader}
                title={compileModeLabels.manual}
              >
                <i class={`codicon codicon-${compileModeIcons.manual}`}></i>
              </button>
            </div>
          </div>
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
              on:click|stopPropagation={() => {
                onToggleMute(); 
              }}
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
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .compile-mode-selector {
    display: flex;
    gap: 2px;
  }

  .compile-mode-menu-item {
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .compile-mode-button {
    min-width: 32px;
  }

  .compile-now-button {
    min-width: 32px;
  }

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
