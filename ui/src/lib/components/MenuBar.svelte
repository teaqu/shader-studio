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
  import type { CompileMode } from "../stores/compileModeStore";
  import type { ResolutionSessionController } from "../resolution/ResolutionSessionController.svelte";

  type BufferResolutionMenuState = {
    mode: "none" | "fixed" | "scale";
    width: string;
    height: string;
    scale: number;
  }






  import type { AudioVideoController } from "../AudioVideoController";
  import { getActiveProfile, getProfileList, switchTo, saveProfile } from '../state/profileStore.svelte';
  import ProfileModal from './ProfileModal.svelte';
  import { portal } from '../actions/portal';
  import { computeMenuPos } from '../utils/menuPos';

  interface Props {
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
    isRecording?: boolean;
    isRecordingPanelVisible?: boolean;
    onToggleRecordingPanel?: () => void;
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
    isRecording = false,
    isRecordingPanelVisible = false,
    onToggleRecordingPanel = () => {},
  }: Props = $props();

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
  let widthInput = $state<number | null>(null);
  let heightInput = $state<number | null>(null);
  let showFPSMenu = $state(false);
  let showOptionsMenu = $state(false);
  let showLayoutMenu = $state(false);
  let confirmingSave = $state(false);
  let showProfileModal = $state(false);
  let fpsTriggerEl = $state<HTMLElement | null>(null);
  let fpsMenuEl = $state<HTMLElement | null>(null);
  let fpsMenuPos = $state({ top: 0, left: 0 });
  let fpsMenuVisible = $state(false);
  let resTriggerEl = $state<HTMLElement | null>(null);
  let resMenuEl = $state<HTMLElement | null>(null);
  let resMenuPos = $state({ top: 0, left: 0 });
  let resMenuVisible = $state(false);
  let optionsMenuTriggerEl = $state<HTMLElement | null>(null);
  let optionsMenuEl = $state<HTMLElement | null>(null);
  let optionsMenuPos = $state({ top: 0, left: 0 });
  let optionsMenuVisible = $state(false);
  let layoutMenuTriggerEl = $state<HTMLElement | null>(null);
  let layoutSubmenuEl = $state<HTMLElement | null>(null);
  let submenuPos = $state({ top: 0, left: 0 });
  let submenuVisible = $state(false);
  let menuBarEl = $state<HTMLElement | null>(null);
  let menuBarWidth = $state(Infinity);
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

  // Breakpoints matching the @container collapse rules — items shown in options menu when toolbar button is hidden
  const showDebugInOptions = $derived(menuBarWidth <= 430);
  const showEditorInOptions = $derived(menuBarWidth <= 410);
  const showConfigInOptions = $derived(menuBarWidth <= 390);
  const showRecordInOptions = $derived(menuBarWidth <= 370);
  const showLockInOptions = $derived(menuBarWidth <= 340);

  $effect(() => {
    if (!menuBarEl) {
      return;
    }
    const ro = new ResizeObserver(entries => {
      menuBarWidth = entries[0]?.contentRect.width ?? Infinity;
    });
    ro.observe(menuBarEl);
    return () => ro.disconnect();
  });

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
      if (state.width !== undefined && state.height !== undefined) {
        widthInput = Number(state.width) || null;
        heightInput = Number(state.height) || null;
      } else {
        widthInput = null;
        heightInput = null;
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
    showLayoutMenu = false;
  }

  function handleFPSClick() {
    showFPSMenu = !showFPSMenu;
    showResolutionMenu = false;
    showOptionsMenu = false;
    showLayoutMenu = false;
  }

  function handleFPSLimitSelect(limit: number) {
    currentFPSLimit = limit;
    onFpsLimitChange(limit);
  }

  function handleOptionsClick() {
    showOptionsMenu = !showOptionsMenu;
    showResolutionMenu = false;
    showFPSMenu = false;
    showLayoutMenu = false;
  }

  function handleRecordingClick() {
    showResolutionMenu = false;
    showFPSMenu = false;
    showOptionsMenu = false;
    showLayoutMenu = false;
    onToggleRecordingPanel();
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
    if (widthInput && heightInput) {
      resCtrl.setImageCustomResolution(String(widthInput), String(heightInput));
    }
  }

  function handleClearCustomResolution(event: MouseEvent) {
    event.stopPropagation();
    widthInput = null;
    heightInput = null;
    resCtrl.setImageCustomResolution(undefined, undefined);
  }

  function handleResetResolution() {
    widthInput = null;
    heightInput = null;
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
    const inRes = clickTarget.closest(".resolution-menu-container") || mouseDownTarget?.closest(".resolution-menu-container")
      || resMenuEl?.contains(clickTarget as Node) || resMenuEl?.contains(mouseDownTarget as Node);
    if (showResolutionMenu && !inRes) {
      showResolutionMenu = false;
    }

    const inFps = clickTarget.closest(".fps-menu-container") || mouseDownTarget?.closest(".fps-menu-container")
      || fpsMenuEl?.contains(clickTarget as Node) || fpsMenuEl?.contains(mouseDownTarget as Node);
    if (showFPSMenu && !inFps) {
      showFPSMenu = false;
    }

    const inOptionsContainer = clickTarget.closest(".options-menu-container") || mouseDownTarget?.closest(".options-menu-container");
    const inOptionsPortal = optionsMenuEl && (optionsMenuEl.contains(clickTarget as Node) || optionsMenuEl.contains(mouseDownTarget as Node));
    const inLayoutSubmenu = layoutSubmenuEl && (layoutSubmenuEl.contains(clickTarget as Node) || layoutSubmenuEl.contains(mouseDownTarget as Node));
    const inOptionsMenu = inOptionsContainer || inOptionsPortal;

    if (showLayoutMenu && !inOptionsMenu && !inLayoutSubmenu) {
      showLayoutMenu = false;
    }

    if (showOptionsMenu && !inOptionsMenu && !inLayoutSubmenu) {
      showOptionsMenu = false;
    }

    mouseDownTarget = null;
  }

  $effect(() => {
    if (!showFPSMenu) {
      fpsMenuVisible = false;
    }
  });
  $effect(() => {
    if (showFPSMenu && fpsMenuEl && fpsTriggerEl) {
      fpsMenuPos = computeMenuPos(fpsTriggerEl, fpsMenuEl, 'below-left');
      fpsMenuVisible = true;
    }
  });

  $effect(() => {
    if (!showResolutionMenu) {
      resMenuVisible = false;
    }
  });
  $effect(() => {
    if (showResolutionMenu && resMenuEl && resTriggerEl) {
      resMenuPos = computeMenuPos(resTriggerEl, resMenuEl, 'below-left');
      resMenuVisible = true;
    }
  });

  $effect(() => {
    if (!showOptionsMenu) {
      optionsMenuVisible = false;
    }
  });
  $effect(() => {
    if (showOptionsMenu && optionsMenuEl && optionsMenuTriggerEl) {
      optionsMenuPos = computeMenuPos(optionsMenuTriggerEl, optionsMenuEl, 'below-right');
      optionsMenuVisible = true;
    }
  });

  $effect(() => {
    if (!showLayoutMenu) {
      confirmingSave = false;
      submenuVisible = false;
    }
  });
  $effect(() => {
    if (showLayoutMenu && layoutSubmenuEl && layoutMenuTriggerEl) {
      submenuPos = computeMenuPos(layoutMenuTriggerEl, layoutSubmenuEl, 'left-of');
      submenuVisible = true;
    }
  });

</script>

<svelte:window onmousedown={handleWindowMouseDown} onclick={handleClickOutside} />

<div class="menu-bar" bind:this={menuBarEl}>
  <div class="left-group">
    {#if compileMode === "manual"}
      <button
        class="compile-now-button toolbar-icon-button"
        onclick={onManualCompile}
        aria-label="Compile shader"
        disabled={!hasShader}
        title="Compile shader"
      >
        <i class="codicon codicon-run-all"></i>
      </button>
    {/if}
    <button class="toolbar-icon-button" onclick={onReset} aria-label="Reset shader" disabled={!hasShader}>
      <i class="codicon codicon-debug-restart"></i>
    </button>
    <div class="pause-button-container">
      <button
        class="toolbar-icon-button"
        onclick={onTogglePause}
        aria-label="Toggle pause"
        class:error={hasErrors}
        disabled={!hasShader}
        onmouseenter={handlePauseTooltipTriggerEnter}
        onmouseleave={handlePauseTooltipTriggerLeave}
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
          onmouseenter={handlePauseTooltipEnter}
          onmouseleave={handlePauseTooltipLeave}
        >{errorMessage}</div>
      {/if}
    </div>
    <TimeControls {timeManager} {currentTime} disabled={!hasShader} />
    <div class="fps-menu-container">
      <button
        bind:this={fpsTriggerEl}
        class="menu-title fps-button"
        onclick={handleFPSClick}
        aria-label="Change FPS limit"
        disabled={!hasShader}
      >
        {currentFPS.toFixed(1)} FPS
      </button>
    </div>
    <div class="resolution-menu-container">
      <button
        bind:this={resTriggerEl}
        class="menu-title resolution-button"
        onclick={handleResolutionClick}
        aria-label="Change resolution settings"
        disabled={!hasShader}
      >
        {canvasWidth} × {canvasHeight}
      </button>
    </div>
  </div>
  <div class="right-group">
    <button
      class="collapse-config toolbar-icon-button"
      onclick={onToggleConfigPanel}
      aria-label="Toggle config panel"
      class:active={isConfigPanelVisible}
      disabled={!hasShader}
      title="Toggle shader configuration panel"
    >
      <i class="codicon codicon-layers"></i>
    </button>
    <button
      class="collapse-debug toolbar-icon-button"
      onclick={onToggleDebugEnabled}
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
      onclick={onToggleEditorOverlay}
      aria-label="Toggle editor overlay"
      class:active={isEditorOverlayVisible}
      disabled={!hasShader}
      title="Toggle editor overlay"
    >
      <i class="codicon codicon-code"></i>
    </button>
    <RecordingButton
      {hasShader}
      {isRecording}
      isActive={isRecordingPanelVisible}
      onToggle={handleRecordingClick}
    />
    <button class="collapse-lock toolbar-icon-button" onclick={handleToggleLock} aria-label="Toggle lock" class:active={isLocked} disabled={!hasShader}>
      {#if isLocked}
        <i class="codicon codicon-lock"></i>
      {:else}
        <i class="codicon codicon-unlock"></i>
      {/if}
    </button>
    <div class="options-menu-container">
      <button
        bind:this={optionsMenuTriggerEl}
        onclick={handleOptionsClick}
        aria-label="Open options menu"
        class="options-menu-button"
      >
        <i class="codicon codicon-menu"></i>
      </button>
    </div>
  </div>
</div>

{#if showProfileModal}
  <div use:portal>
    <ProfileModal onclose={() => {
      showProfileModal = false;
    }} />
  </div>
{/if}

{#if showFPSMenu}
  <div
    use:portal
    bind:this={fpsMenuEl}
    class="fps-menu"
    style="top: {fpsMenuPos.top}px; left: {fpsMenuPos.left}px; visibility: {fpsMenuVisible ? 'visible' : 'hidden'};"
  >
    <div class="resolution-section">
      <h4>Frame Rate Limit</h4>
      <button class="resolution-option menu-title" class:active={currentFPSLimit === 30} onclick={() => handleFPSLimitSelect(30)}>30 FPS</button>
      <button class="resolution-option menu-title" class:active={currentFPSLimit === 60} onclick={() => handleFPSLimitSelect(60)}>60 FPS</button>
      <button class="resolution-option menu-title" class:active={currentFPSLimit === 0} onclick={() => handleFPSLimitSelect(0)}>Unlimited</button>
    </div>
    <div class="resolution-separator"></div>
    <button
      class="resolution-option menu-title"
      class:active={isPerformancePanelVisible}
      onclick={() => {
        onTogglePerformancePanel(); showFPSMenu = false;
      }}
    >
      <i class="codicon codicon-graph-line"></i> Frame Times
    </button>
  </div>
{/if}

{#if showResolutionMenu}
  {@const hasCustom = currentResolution.width !== undefined && currentResolution.height !== undefined}
  <div
    use:portal
    bind:this={resMenuEl}
    class="resolution-menu"
    style="top: {resMenuPos.top}px; left: {resMenuPos.left}px; visibility: {resMenuVisible ? 'visible' : 'hidden'};"
  >
    <div class="resolution-section save-to-config-section">
      <label class="save-to-config-label">
        <input type="checkbox" aria-label="Sync With Config" checked={resCtrl.menuVM.syncWithConfig} onchange={handleSyncWithConfigChange} />
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
          <button class="reset-resolution-btn" onclick={handleResetResolution}>Reset</button>
        </div>
        <div class="scale-buttons">
          {#each [0.25, 0.5, 1, 2, 4] as scale}
            <button class="resolution-option menu-title" class:active={currentResolution.scale === scale} onclick={() => handleResolutionScaleSelect(scale)}>{scale}x</button>
          {/each}
        </div>
      </div>
      <div class="resolution-section">
        <h4>Fixed Size</h4>
        <div class="custom-resolution-row">
          <input type="number" class="custom-res-input" placeholder="W" min="1" step="1" bind:value={widthInput} oninput={handleCustomResolutionInput} />
          <span class="custom-res-separator">&times;</span>
          <input type="number" class="custom-res-input" placeholder="H" min="1" step="1" bind:value={heightInput} oninput={handleCustomResolutionInput} />
          {#if hasCustom}
            <button class="custom-res-btn clear-btn" onclick={handleClearCustomResolution}>Clear</button>
          {/if}
        </div>
      </div>
      <div class="resolution-section">
        <h4>Aspect Ratio</h4>
        <div class="scale-buttons">
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "16:9"} disabled={hasCustom} onclick={() => handleAspectRatioSelect("16:9")}>16:9</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "4:3"} disabled={hasCustom} onclick={() => handleAspectRatioSelect("4:3")}>4:3</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "1:1"} disabled={hasCustom} onclick={() => handleAspectRatioSelect("1:1")}>1:1</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "fill"} disabled={hasCustom} onclick={() => handleAspectRatioSelect("fill")}>Fill</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "auto"} disabled={hasCustom} onclick={() => handleAspectRatioSelect("auto")}>Auto</button>
        </div>
      </div>
    {:else}
      <div class="resolution-section">
        <div class="resolution-section-header">
          <h4>Buffer Resolution</h4>
          <button class="reset-resolution-btn" onclick={handleResetResolution}>Reset</button>
        </div>
        <div class="scale-buttons">
          <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "none"} onclick={() => resCtrl.setBufferResolutionMode("none")}>Inherit</button>
          <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "fixed"} onclick={() => resCtrl.setBufferResolutionMode("fixed")}>Fixed px</button>
          <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "scale"} onclick={() => resCtrl.setBufferResolutionMode("scale")}>Scale</button>
        </div>
      </div>
      {#if resCtrl.menuVM.bufferResolutionState.mode === "fixed"}
        <div class="resolution-section">
          <h4>Fixed Size</h4>
          <div class="custom-resolution-row">
            <input type="number" class="custom-res-input" placeholder="Width" min="1" step="1" value={resCtrl.menuVM.bufferResolutionState.width} oninput={handleBufferWidthInput} />
            <span class="custom-res-separator">&times;</span>
            <input type="number" class="custom-res-input" placeholder="Height" min="1" step="1" value={resCtrl.menuVM.bufferResolutionState.height} oninput={handleBufferHeightInput} />
          </div>
        </div>
      {/if}
      {#if resCtrl.menuVM.bufferResolutionState.mode === "scale"}
        <div class="resolution-section">
          <h4>Resolution Scale</h4>
          <div class="scale-buttons">
            {#each [0.25, 0.5, 1, 2, 4] as scale}
              <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.scale === scale} onclick={() => resCtrl.setBufferScale(scale)}>{scale}x</button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}

    <div class="resolution-section">
      <h4>Zoom</h4>
      <div class="zoom-control">
        <label for="zoom-slider">Zoom: {zoomLevel.toFixed(1)}x</label>
        <input id="zoom-slider" type="range" min="0.1" max="3.0" step="0.1" bind:value={zoomLevel} oninput={handleZoomChange} class="zoom-slider" />
      </div>
    </div>
    <div class="resolution-section save-to-config-section">
      <label class="save-to-config-label">
        <input type="checkbox" checked={currentResolution.forceBlackBackground} onchange={handleForceBlackBackgroundChange} />
        Black canvas background
      </label>
    </div>
  </div>
{/if}

{#if showOptionsMenu}
  <div
    use:portal
    bind:this={optionsMenuEl}
    class="options-menu-portal"
    style="top: {optionsMenuPos.top}px; left: {optionsMenuPos.left}px; visibility: {optionsMenuVisible ? 'visible' : 'hidden'};"
  >
    {#if !previewVisible}
      <button
        class="options-menu-item"
        onclick={() => {
          onShowPreview(); showOptionsMenu = false;
        }}
        aria-label="Show preview"
      >
        <i class="codicon codicon-play"></i>
        <span>Show Preview</span>
      </button>
    {/if}
    {#if showLockInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
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
    {/if}
    {#if showRecordInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          showOptionsMenu = false; handleRecordingClick();
        }}
        aria-label="Toggle export panel"
        class:active={isRecordingPanelVisible}
        disabled={!hasShader}
      >
        <i class="codicon codicon-device-camera"></i>
        <span>Export</span>
      </button>
    {/if}
    {#if showConfigInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          onToggleConfigPanel(); showOptionsMenu = false;
        }}
        aria-label="Toggle config panel"
        class:active={isConfigPanelVisible}
        disabled={!hasShader}
      >
        <i class="codicon codicon-layers"></i>
        <span>Config</span>
      </button>
    {/if}
    <button
      bind:this={layoutMenuTriggerEl}
      class="options-menu-item"
      onclick={() => {
        showLayoutMenu = !showLayoutMenu;
      }}
      aria-label="Switch layout profile"
      style="width:100%;justify-content:space-between"
    >
      <div style="display:flex;align-items:center;gap:8px">
        <i class="codicon codicon-layout"></i>
        <span>Layout: {getProfileList().find(p => p.id === getActiveProfile())?.name ?? getActiveProfile()}</span>
      </div>
      <i class="codicon codicon-chevron-right"></i>
    </button>
    {#if showDebugInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          onToggleDebugEnabled(); showOptionsMenu = false;
        }}
        aria-label="Toggle debug mode"
        class:active={isDebugEnabled}
        disabled={!hasShader}
      >
        <i class="codicon codicon-bug"></i>
        <span>Debug</span>
      </button>
    {/if}
    {#if showEditorInOptions}
      <button
        class="options-menu-item"
        onclick={() => {
          onToggleEditorOverlay(); showOptionsMenu = false;
        }}
        aria-label="Toggle editor overlay"
        class:active={isEditorOverlayVisible}
        disabled={!hasShader}
      >
        <i class="codicon codicon-code"></i>
        <span>Editor</span>
      </button>
    {/if}
    {#if isEditorOverlayVisible}
      <button
        class="options-menu-item options-submenu-item"
        onclick={() => {
          onToggleVimMode();
        }}
        aria-label="Toggle vim mode"
        class:active={isVimModeEnabled}
      >
        <span>Vim Mode</span>
      </button>
    {/if}
    <button
      class="options-menu-item"
      onclick={handleRefresh}
      aria-label="Refresh shader"
      disabled={!hasShader}
    >
      <i class="codicon codicon-refresh"></i>
      <span>Refresh</span>
    </button>
    {#if showThemeButton}
      <button
        class="options-menu-item"
        onclick={handleThemeToggle}
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
        onclick={handleFullscreenToggle}
        aria-label="Toggle fullscreen"
      >
        <i class="codicon codicon-screen-full"></i>
        <span>Fullscreen</span>
      </button>
    {/if}
    <button
      class="options-menu-item"
      onclick={() => {
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
      onclick={() => {
        onExtensionCommand('newShader'); showOptionsMenu = false;
      }}
      aria-label="New shader"
    >
      <i class="codicon codicon-new-file"></i>
      <span>New Shader</span>
    </button>
    <button
      class="options-menu-item"
      onclick={() => {
        onExtensionCommand('openShaderExplorer'); showOptionsMenu = false;
      }}
      aria-label="Shader explorer"
    >
      <i class="codicon codicon-book"></i>
      <span>Shader Explorer</span>
    </button>
    <button
      class="options-menu-item"
      onclick={() => {
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
          onclick={() => onSetCompileMode("hot")}
          aria-label="Set hot compile mode"
          disabled={!hasShader}
          title={compileModeLabels.hot}
        >
          <i class={`codicon codicon-${compileModeIcons.hot}`}></i>
        </button>
        <button
          class="compile-mode-button"
          class:active={compileMode === "save"}
          onclick={() => onSetCompileMode("save")}
          aria-label="Set save compile mode"
          disabled={!hasShader}
          title={compileModeLabels.save}
        >
          <i class={`codicon codicon-${compileModeIcons.save}`}></i>
        </button>
        <button
          class="compile-mode-button"
          class:active={compileMode === "manual"}
          onclick={() => onSetCompileMode("manual")}
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
        oninput={handleVolumeSlider}
        class="volume-slider"
        aria-label="Volume"
        class:muted-slider={audioMuted}
      />
      <span class="volume-label">{Math.round(audioVolume * 100)}%</span>
      <button
        class="mute-icon-btn"
        onclick={(e) => {
          e.stopPropagation(); onToggleMute();
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

{#if showLayoutMenu}
  <div
    use:portal
    bind:this={layoutSubmenuEl}
    class="layout-submenu-portal"
    style="top: {submenuPos.top}px; left: {submenuPos.left}px; visibility: {submenuVisible ? 'visible' : 'hidden'};"
  >
    {#each getProfileList() as profile}
      <button
        class="layout-submenu-item"
        class:active={profile.id === getActiveProfile()}
        onclick={() => {
          switchTo(profile.id); showLayoutMenu = false; showOptionsMenu = false;
        }}
      >
        {#if profile.id === getActiveProfile()}
          <i class="codicon codicon-check"></i>
        {:else}
          <span class="check-placeholder"></span>
        {/if}
        {profile.name}
      </button>
    {/each}
    <div class="options-menu-divider"></div>
    {#if confirmingSave}
      <div class="layout-submenu-confirm">
        <span>Save to "{getProfileList().find(p => p.id === getActiveProfile())?.name ?? getActiveProfile()}"? Are you sure?</span>
        <div class="layout-submenu-confirm-btns">
          <button class="confirm-btn confirm-yes" onclick={async (e) => {
            e.stopPropagation();
            await saveProfile(); confirmingSave = false; showLayoutMenu = false; showOptionsMenu = false;
          }}>Yes</button>
          <button class="confirm-btn confirm-no" onclick={(e) => {
            e.stopPropagation();
            confirmingSave = false;
          }}>Cancel</button>
        </div>
      </div>
    {:else}
      <button
        class="layout-submenu-item"
        onclick={(e) => {
          e.stopPropagation();
          confirmingSave = true;
        }}
      >
        <i class="codicon codicon-save"></i>
        Save current layout
      </button>
    {/if}
    <button
      class="layout-submenu-item"
      onclick={() => {
        onResetLayout(); showLayoutMenu = false; showOptionsMenu = false;
      }}
      aria-label="Reset layout"
      disabled={!hasShader}
    >
      <i class="codicon codicon-debug-restart"></i>
      Reset Layout
    </button>
    <button
      class="layout-submenu-item"
      onclick={() => {
        showProfileModal = true; showLayoutMenu = false; showOptionsMenu = false;
      }}
    >
      <i class="codicon codicon-settings"></i>
      Manage profiles…
    </button>
  </div>
{/if}

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

  :global(.layout-submenu-portal) {
    position: fixed;
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
    border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border));
    border-radius: 4px;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    z-index: 9999;
    padding: 4px 0;
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
  }

  :global(.layout-submenu-portal .layout-submenu-item) {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 12px;
    background: none;
    border: none;
    color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
    cursor: pointer;
    font-size: 12px;
    text-align: left;
    box-sizing: border-box;
  }

  :global(.layout-submenu-portal .layout-submenu-item:hover),
  :global(.layout-submenu-portal .layout-submenu-item.active) {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
  }

  :global(.layout-submenu-portal .layout-submenu-item:disabled) {
    cursor: default;
    opacity: 0.45;
  }

  :global(.layout-submenu-portal .layout-submenu-item:disabled:hover) {
    background: none;
  }

  :global(.layout-submenu-portal .check-placeholder) {
    width: 16px;
    display: inline-block;
  }

  :global(.layout-submenu-portal .options-menu-divider) {
    height: 1px;
    background: var(--vscode-panel-border, rgba(128, 128, 128, 0.3));
    margin: 4px 0;
  }

  :global(.layout-submenu-portal .layout-submenu-confirm) {
    padding: 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  :global(.layout-submenu-portal .layout-submenu-confirm span) {
    font-size: 11px;
    color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
    opacity: 0.85;
  }

  :global(.layout-submenu-portal .layout-submenu-confirm-btns) {
    display: flex;
    gap: 6px;
  }

  :global(.layout-submenu-portal .confirm-btn) {
    flex: 1;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 2px;
    border: none;
    cursor: pointer;
  }

  :global(.layout-submenu-portal .confirm-yes) {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  :global(.layout-submenu-portal .confirm-yes:hover) {
    background: var(--vscode-button-hoverBackground);
  }

  :global(.layout-submenu-portal .confirm-no) {
    background: var(--vscode-button-secondaryBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
  }

  :global(.layout-submenu-portal .confirm-no:hover) {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-activeSelectionBackground));
  }
</style>
