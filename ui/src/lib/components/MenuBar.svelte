<svelte:options runes={true} />
<script lang="ts">
  import { onMount, onDestroy, getContext } from "svelte";
  import { currentTheme, toggleTheme } from "../stores/themeStore";
  import { aspectRatioStore } from "../stores/aspectRatioStore";
  import { resolutionStore } from "../stores/resolutionStore";
  import { isVSCodeEnvironment } from "../transport/TransportFactory";
  import ErrorTooltip from "./ErrorTooltip.svelte";
  import TimeControls from "./TimeControls.svelte";
  import type { ShaderDebugState } from "../types/ShaderDebugState";
  import RecordingButton from "./recording/RecordingButton.svelte";
  import type { CompileMode } from "../stores/compileModeStore";
  import type { ResolutionSessionController } from "../resolution/ResolutionSessionController.svelte";

  interface TimeManagerLike {
    getCurrentTime: (now: number) => number;
    isPaused: () => boolean;
    getSpeed?: () => number;
    setSpeed?: (speed: number) => void;
    isLoopEnabled?: () => boolean;
    setLoopEnabled?: (enabled: boolean) => void;
    getLoopDuration?: () => number;
    setLoopDuration?: (duration: number) => void;
    setTime?: (time: number) => void;
  }






  import type { AudioVideoController } from "../AudioVideoController";
  import { MenuOverlay } from './menu/MenuOverlay.svelte';
  import MenuOptions from './menu/MenuOptions.svelte';
  import DisplayControls from './menu/DisplayControls.svelte';

  interface Props {
    timeManager: TimeManagerLike | null;
    currentFPS: number;
    canvasWidth?: number;
    canvasHeight?: number;
    isLocked?: boolean;
    canvasElement?: HTMLCanvasElement | null;
    errors?: string[];
    warnings?: string[];
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
    isDebugSupported?: boolean;
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
    warnings = [],
    onReset = () => {},
    onRefresh = () => {},
    onTogglePause = () => {},
    onToggleLock: onToggleLockProp = () => {},
    onZoomChange = () => {},
    onFpsLimitChange = () => {},
    onConfig = () => {},
    isDebugEnabled = false,
    isDebugSupported = true,
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
  const hasWarnings = $derived(warnings.length > 0);
  const statusMessages = $derived(hasErrors ? errors : warnings);
  let pauseTooltipAnchorEl = $state<HTMLDivElement | null>(null);

  let currentTime = $state(0.0);
  let timeUpdateHandle: number | null = null;
  let isPaused = $state(false);
  let theme = $state<"light" | "dark">("light");
  let showThemeButton = $state(false);
  let showFullscreenButton = $state(false);
  const currentAspectRatio = $derived($aspectRatioStore.mode);
  const currentResolution = $derived($resolutionStore);
  const resolutionMenu = new MenuOverlay('below-left');
  const fpsMenu = new MenuOverlay('below-left');
  const optionsMenu = new MenuOverlay('below-right');
  const layoutMenu = new MenuOverlay('left-of');
  const editorMenu = new MenuOverlay('left-of');
  let menuBarEl = $state<HTMLElement | null>(null);
  let menuBarWidth = $state(Infinity);
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

  // The editor compiles on Cmd+Enter on macOS and Ctrl+Enter elsewhere.
  const manualCompileShortcut =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? "")
      ? "Cmd+Enter"
      : "Ctrl+Enter";

  const isPauseTooltipVisible = $derived(
    isPauseTooltipTriggerHovered || (isPauseTooltipHoverArmed && isPauseTooltipHovered)
  );

  // Breakpoints matching the @container collapse rules — items shown in options menu when toolbar button is hidden
  const showDebugInOptions = $derived(menuBarWidth <= 430);
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

    return () => {
      if (timeUpdateHandle !== null) {
        cancelAnimationFrame(timeUpdateHandle);
      }
      unsubscribeTheme();
    };
  });

  onDestroy(() => {
    if (timeUpdateHandle !== null) {
      cancelAnimationFrame(timeUpdateHandle);
    }
    resolutionMenu.dispose();
    fpsMenu.dispose();
    optionsMenu.dispose();
    layoutMenu.dispose();
    editorMenu.dispose();
  });

  function handleThemeToggle(event: MouseEvent) {
    event.stopPropagation();
    toggleTheme();
  }

  function handleRefresh(event: MouseEvent) {
    event.stopPropagation();
    optionsMenu.open = false;
    onRefresh();
  }

  function handleConfig(event: MouseEvent) {
    event.stopPropagation();
    optionsMenu.open = false;
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
    resolutionMenu.open = !resolutionMenu.open;
    fpsMenu.open = false;
    optionsMenu.open = false;
    layoutMenu.open = false;
  }

  function handleFPSClick() {
    fpsMenu.open = !fpsMenu.open;
    resolutionMenu.open = false;
    optionsMenu.open = false;
    layoutMenu.open = false;
  }

  function handleFPSLimitSelect(limit: number) {
    currentFPSLimit = limit;
    onFpsLimitChange(limit);
  }

  function handleOptionsClick() {
    optionsMenu.open = !optionsMenu.open;
    resolutionMenu.open = false;
    fpsMenu.open = false;
    layoutMenu.open = false;
    editorMenu.open = false;
  }

  function handleRecordingClick() {
    resolutionMenu.open = false;
    fpsMenu.open = false;
    optionsMenu.open = false;
    layoutMenu.open = false;
    onToggleRecordingPanel();
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

  function includesMenuTarget(menu: MenuOverlay, target: HTMLElement) {
    return menu.element?.contains(target) || menu.element?.contains(mouseDownTarget);
  }

  function includesMenuContainer(className: string, target: HTMLElement) {
    return target.closest(className) || mouseDownTarget?.closest(className);
  }

  function closeWhenOutside(menu: MenuOverlay, isInside: unknown) {
    if (menu.open && !isInside) {
      menu.close();
    }
  }

  function handleClickOutside(event: MouseEvent) {
    const clickTarget = event.target as HTMLElement;

    // Only close if BOTH mousedown and mouseup were outside the container
    const inRes = includesMenuContainer(".resolution-menu-container", clickTarget) || includesMenuTarget(resolutionMenu, clickTarget);
    closeWhenOutside(resolutionMenu, inRes);

    const inFps = includesMenuContainer(".fps-menu-container", clickTarget) || includesMenuTarget(fpsMenu, clickTarget);
    closeWhenOutside(fpsMenu, inFps);

    const inOptionsContainer = includesMenuContainer(".options-menu-container", clickTarget);
    const inOptionsPortal = includesMenuTarget(optionsMenu, clickTarget);
    const inLayoutSubmenu = includesMenuTarget(layoutMenu, clickTarget);
    const inEditorSubmenu = includesMenuTarget(editorMenu, clickTarget);
    const inOptionsMenu = inOptionsContainer || inOptionsPortal;

    closeWhenOutside(layoutMenu, inOptionsMenu || inLayoutSubmenu);
    closeWhenOutside(editorMenu, inOptionsMenu || inEditorSubmenu);
    closeWhenOutside(optionsMenu, inOptionsMenu || inLayoutSubmenu || inEditorSubmenu);

    mouseDownTarget = null;
  }

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
        title={`Compile shader (${manualCompileShortcut})`}
      >
        <i class="codicon codicon-run-all"></i>
      </button>
    {/if}
    <button class="toolbar-icon-button" onclick={onReset} aria-label="Reset shader" disabled={!hasShader}>
      <i class="codicon codicon-debug-restart"></i>
    </button>
    <div class="pause-button-container" bind:this={pauseTooltipAnchorEl}>
      <button
        class="toolbar-icon-button"
        onclick={onTogglePause}
        aria-label="Toggle pause"
        class:error={hasErrors}
        class:warning={!hasErrors && hasWarnings}
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
      {#if hasErrors || hasWarnings}
        <ErrorTooltip
          messages={statusMessages}
          visible={isPauseTooltipVisible}
          anchor={pauseTooltipAnchorEl}
          variant={!hasErrors && hasWarnings ? 'warning' : 'error'}
          onmouseenter={handlePauseTooltipEnter}
          onmouseleave={handlePauseTooltipLeave}
        />
      {/if}
    </div>
    <TimeControls timeManager={timeManager ?? undefined} {currentTime} disabled={!hasShader} />
    <div class="fps-menu-container">
      <button
        bind:this={fpsMenu.trigger}
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
        bind:this={resolutionMenu.trigger}
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
      <i class="codicon codicon-gear"></i>
    </button>
    <button
      class="collapse-debug toolbar-icon-button"
      onclick={onToggleDebugEnabled}
      aria-label="Toggle debug mode"
      class:active={isDebugEnabled}
      disabled={!hasShader || !isDebugSupported}
      title={debugState?.isActive
        ? `Debugging line ${(debugState.currentLine ?? 0) + 1}`
        : "Enable debug mode"}
    >
      <i class="codicon codicon-bug"></i>
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
        bind:this={optionsMenu.trigger}
        onclick={handleOptionsClick}
        aria-label="Open options menu"
        class="options-menu-button"
      >
        <i class="codicon codicon-menu"></i>
      </button>
    </div>
  </div>
</div>

<DisplayControls
  {fpsMenu} {resolutionMenu} {currentFPS} {currentFPSLimit} {isPerformancePanelVisible}
  {currentResolution} {currentAspectRatio} {resCtrl}
  onFpsLimitSelect={handleFPSLimitSelect} {onTogglePerformancePanel} {onZoomChange}
/>

<MenuOptions
  {optionsMenu} {layoutMenu} {editorMenu}
  {hasShader} {previewVisible} {showLockInOptions} {showRecordInOptions} {showConfigInOptions} {showDebugInOptions}
  {isLocked} {isRecordingPanelVisible} {isConfigPanelVisible} {isDebugEnabled} {isDebugSupported} {isEditorOverlayVisible} {isVimModeEnabled}
  {showThemeButton} {theme} {showFullscreenButton} {compileMode} {compileModeIcons} {compileModeLabels} {audioVolume} {audioMuted}
  onShowPreview={onShowPreview} onConfig={handleConfig} onToggleLock={handleToggleLock} onToggleRecording={handleRecordingClick}
  {onToggleConfigPanel} {onToggleDebugEnabled} {onToggleEditorOverlay} {onToggleVimMode}
  onRefresh={handleRefresh} onToggleTheme={handleThemeToggle} onToggleFullscreen={handleFullscreenToggle}
  {onFork} {onExtensionCommand} {onSetCompileMode} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} {onResetLayout}
/>

<style>
  .compile-now-button { min-width: 32px; }
</style>
