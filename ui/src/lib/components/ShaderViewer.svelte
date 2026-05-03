<svelte:options runes={true} />
<script lang="ts">
  import { onMount, onDestroy, tick, setContext } from "svelte";
  import { get } from "svelte/store";
  import { ShaderPipeline } from "../ShaderPipeline";
  import { ShaderLocker } from "../ShaderLocker";
  import { createTransport } from "../transport/TransportFactory";
  import type { Transport } from "../transport/MessageTransport";
  import ShaderCanvas from "./ShaderCanvas.svelte";
  import MenuBar from "./MenuBar.svelte";
  import PixelInspector from "./PixelInspector.svelte";
  import InspectorCrosshair from "./InspectorCrosshair.svelte";
  import EditorOverlay from "./EditorOverlay.svelte";
  import ConfigPanel from "./config/ConfigPanel.svelte";
  import DebugPanel from "./debug/DebugPanel.svelte";
  import DockviewLayout from "./DockviewLayout.svelte";
  import { RecordingManager } from "../RecordingManager";
  import { RenderingEngine } from "../../../../rendering/src/RenderingEngine";
  import { PixelInspectorManager } from "../PixelInspectorManager";
  import type { PixelInspectorState } from "../types/PixelInspectorState";
  import { ShaderDebugManager } from "../ShaderDebugManager";
  import type { ShaderDebugState } from "../types/ShaderDebugState";
  import { VariableCaptureManager } from "../VariableCaptureManager";
  import { AudioVideoController } from "../AudioVideoController";
  import type { CompilationResult } from "../ShaderProcessor";
  import { EditorOverlayManager, type EditorOverlayCallbacks } from "../EditorOverlayManager.svelte";
  import { configPanelStore } from "../stores/configPanelStore";
  import { debugPanelStore } from "../stores/debugPanelStore";
  import { performancePanelStore } from "../stores/performancePanelStore";
  import {
    getEditorOverlayVisible,
    getOverlayActiveFile,
    getVimMode,
    setEditorOverlayVisible,
    setOverlayActiveFile,
    toggleEditorOverlay,
    setLayoutSlot as setEditorOverlayLayoutSlot,
    restoreFromStorage as restoreEditorOverlayFromStorage,
  } from "../state/editorOverlayState.svelte";
  import {
    getVariablePreview,
    resetVariablePreview,
  } from "../state/variablePreviewState.svelte";
  import { audioStore, linearToPerceptualVolume } from "../stores/audioStore";
  import { compileModeStore, type CompileMode } from "../stores/compileModeStore";
  import FrameTimesPanel from "./performance/FrameTimesPanel.svelte";
  import type { AspectRatioMode, ShaderConfig } from "@shader-studio/types";
  import { allocateWebLayoutSlot, getInjectedLayoutSlot, releaseWebLayoutSlot } from "../util/layoutSlot";
  import { resolutionStore } from "../stores/resolutionStore";
  import { aspectRatioStore } from "../stores/aspectRatioStore";
  import { ResolutionSessionController } from "../resolution/ResolutionSessionController.svelte";

  let { onInitialized = () => {} }: { onInitialized?: () => void } = $props();

  // Core state
  let glCanvas = $state<HTMLCanvasElement>(undefined!);
  let initialized = $state(false);
  let isLocked = $state(false);
  let hasShader = $state(false);
  let errors = $state<string[]>([]);
  let currentFPS = $state(0);
  let canvasWidth = $state(0);
  let canvasHeight = $state(0);
  let zoomLevel = $state(1.0);
  let sessionResolutionRefreshScheduled = false;
  let inspectorState = $state<PixelInspectorState>({
    isEnabled: false,
    isActive: false,
    isLocked: false,
    mouseX: 0,
    mouseY: 0,
    pixelRGB: null,
    fragCoord: null,
    canvasPosition: null,
  });

  // Managers and controllers
  let pipeline: ShaderPipeline;
  let shaderLocker: ShaderLocker;
  let renderingEngine = $state<RenderingEngine>(undefined!);
  let transport: Transport = createTransport();
  let layoutSlot = transport.getType() === 'vscode'
    ? (getInjectedLayoutSlot() ?? 'vscode:1')
    : allocateWebLayoutSlot();
  let timeManager: any = null;
  let pixelInspectorManager: PixelInspectorManager | undefined;
  let shaderDebugManager = $state<ShaderDebugManager | undefined>(undefined);
  let variableCaptureManager = $state<VariableCaptureManager | undefined>(undefined);
  let audioVideoController = $state<AudioVideoController | undefined>(undefined);
  let lastAppliedVariablePreviewToken = 0;
  let pendingMessages: MessageEvent[] = [];
  let routerInitialized = false;
  let editorOverlayManager: EditorOverlayManager | undefined;

  let debugState = $state<ShaderDebugState>({
    isEnabled: false,
    currentLine: null,
    lineContent: null,
    filePath: null,
    isActive: false,
    functionContext: null,
    isLineLocked: false,
    isInlineRenderingEnabled: true,
    normalizeMode: 'off' as const,
    isStepEnabled: false,
    stepEdge: 0.5,
    debugError: null,
    isVariableInspectorEnabled: false,
    capturedVariables: [],
    activeBufferName: 'Image',
  });

  // Audio state (mirrored from AudioVideoController for Svelte reactivity)
  let audioVolume = $state(1.0);
  let audioMuted = $state(true);

  // Recording
  let isRecording = $state(false);
  let recordingManager: RecordingManager;

  // Config panel state
  let currentConfig = $state<ShaderConfig | null>(null);
  let pathMap = $state<Record<string, string>>({});
  let bufferPathMap = $state<Record<string, string>>({});
  let shaderPath = $state('');

  // Script info for config panel
  let scriptInfo = $state<{ filename: string; uniforms: { name: string; type: string }[]; fileExists?: boolean } | null>(null);
  let customUniformValues = $state<Record<string, number | number[] | boolean>>({});
  let actualPollFps = $state(0);
  let pollTimestamps: number[] = [];
  let uniformTimestamps = $state<Record<string, number[]>>({});
  let uniformActualFps = $state<Record<string, number>>({});

  // Editor overlay state
  let editorOverlayVisible = $derived(hasShader && getEditorOverlayVisible());
  let editorVimMode = $derived(getVimMode());
  let currentShaderCode = $state('');
  let editorBufferName = $state('Image');
  let editorFilePath = $state('');
  let editorFileCode = $state('');
  let editorBufferNames = $state<string[]>(['Image']);
  let configSelectedBuffer = $state('Image');

  // Resolution controller — created at component level so setContext works synchronously
  const resolutionController = new ResolutionSessionController({
    get currentConfig() {
      return currentConfig; 
    },
    get debugState() {
      return debugState; 
    },
    setCurrentConfig: (config) => {
      currentConfig = config;
    },
    resolutionStore,
    aspectRatioStore,
    getShaderPath: () => shaderPath,
    getBufferPathMap: () => bufferPathMap,
    getCurrentAspectRatioMode: () => get(aspectRatioStore).mode,
    isInitialized: () => initialized,
    hasShader: () => hasShader,
    updatePipelineConfig: (config) => pipeline?.updateCurrentConfig(config),
    recompileCurrentShader: () => {
      pipeline?.recompileCurrentShader?.();
    },
    setShaderContext: (config, sp, bpm) => shaderDebugManager?.setShaderContext(config, sp, bpm),
    setEditorConfig: (config) => editorOverlayManager?.setConfig(config),
    transport,
  });

  setContext('resolution', resolutionController);

  // Performance panel state
  let lastSentCompileMode = $state<CompileMode | null>(null);
  let lastSentDebugEnabled = $state<boolean | null>(null);

  $effect(() => {
    if (initialized && $compileModeStore.mode !== lastSentCompileMode) {
      transport.postMessage({
        type: 'setCompileMode',
        payload: { mode: $compileModeStore.mode },
      });
      lastSentCompileMode = $compileModeStore.mode;
    }
  });

  // Extract specific debug state fields so that capturedVariables changes
  // don't re-trigger the capture loop (Svelte tracks the whole object reference).
  const varInspectorEnabled = $derived(debugState.isVariableInspectorEnabled);

  // Extract inspectorState fields as stable primitives.
  const inspectorEnabled = $derived(inspectorState.isEnabled);
  const inspectorActive = $derived(inspectorState.isActive);
  const inspectorLocked = $derived(inspectorState.isLocked);
  const inspectorCanvasX = $derived(inspectorState.canvasPosition?.x ?? null);
  const inspectorCanvasY = $derived(inspectorState.canvasPosition?.y ?? null);

  // Derive whether we're currently in pixel capture mode
  const hasPixelCapture = $derived((inspectorActive || inspectorLocked) && (inspectorCanvasX !== null));

  // Stable pixel coordinates for the capture reactive block
  const capturePixelX = $derived(hasPixelCapture ? inspectorCanvasX : null);
  const capturePixelY = $derived(hasPixelCapture ? inspectorCanvasY : null);

  // Reactive: notify variable capture manager when relevant state changes.
  $effect(() => {
    if (initialized && variableCaptureManager && shaderDebugManager && varInspectorEnabled && debugState.isEnabled) {
      notifyVariableCaptureManager();
    } else if (initialized && variableCaptureManager && (!varInspectorEnabled || !debugState.isEnabled)) {
      variableCaptureManager.stop();
    }
  });

  // Shared MenuBar props — two instances exist in different DOM positions for dockview layout
  const menuBarProps = $derived.by(() => ({
    timeManager,
    currentFPS,
    canvasWidth,
    canvasHeight,
    isLocked,
    errors,
    canvasElement: glCanvas,
    onReset: handleReset,
    onRefresh: handleRefresh,
    onTogglePause: handleTogglePause,
    onToggleLock: handleToggleLock,
    onZoomChange: handleZoomChange,
    onFpsLimitChange: handleFpsLimitChange,
    onConfig: handleConfig,
    isDebugEnabled: debugState.isEnabled,
    onToggleDebugEnabled: handleToggleDebugEnabled,
    debugState,
    isConfigPanelVisible: $configPanelStore.isVisible,
    onToggleConfigPanel: handleToggleConfigPanel,
    isPerformancePanelVisible: $performancePanelStore.isVisible,
    onTogglePerformancePanel: handleTogglePerformancePanel,
    isEditorOverlayVisible: editorOverlayVisible,
    onToggleEditorOverlay: () => editorOverlayManager?.toggle(),
    isVimModeEnabled: editorVimMode,
    onToggleVimMode: () => editorOverlayManager?.toggleVimMode(),
    onFork: handleFork,
    onExtensionCommand: handleExtensionCommand,
    hasShader,
    onResetLayout: handleResetLayout,
    previewVisible,
    onShowPreview: handleShowPreview,
    audioVolume,
    audioMuted,
    audioVideoController,
    onScreenshot: handleScreenshot,
    onRecord: handleRecord,
    onCancel: handleCancelRecording,
    isRecording,
    compileMode: $compileModeStore.mode,
    onSetCompileMode: handleSetCompileMode,
    onManualCompile: handleManualCompile,
  }));

  // Subscribe to config/debug panel stores
  onMount(() => {
    configPanelStore.setLayoutSlot(layoutSlot);
    debugPanelStore.setLayoutSlot(layoutSlot);
    performancePanelStore.setLayoutSlot(layoutSlot);
    setEditorOverlayLayoutSlot(layoutSlot);

    const unsubConfig = configPanelStore.subscribe((state) => {
      void state;
    });
    const unsubPerf = performancePanelStore.subscribe((state) => {
      void state;
    });
    return () => {
      unsubConfig();
      unsubPerf();
    };
  });

  onMount(() => {
    let seenResolutionState = false;
    let seenAspectRatioState = false;

    const unsubscribeResolution = resolutionStore.subscribe(() => {
      if (!seenResolutionState) {
        seenResolutionState = true;
        return;
      }
      scheduleDebugRefresh();
    });

    const unsubscribeAspectRatio = aspectRatioStore.subscribe(() => {
      if (!seenAspectRatioState) {
        seenAspectRatioState = true;
        return;
      }
      scheduleDebugRefresh();
    });

    return () => {
      unsubscribeResolution();
      unsubscribeAspectRatio();
    };
  });

  // FPS polling
  onMount(() => {
    const fpsInterval = setInterval(() => {
      if (initialized) {
        currentFPS = renderingEngine.getCurrentFPS();
      }
      // Evict stale poll timestamps so actualPollFps decays to 0 when messages stop
      const now = performance.now();
      const cutoff = now - 1000;
      while (pollTimestamps.length > 0 && pollTimestamps[0] < cutoff) {
        pollTimestamps.shift();
      }
      actualPollFps = pollTimestamps.length;
      // Evict stale per-uniform timestamps
      for (const name of Object.keys(uniformTimestamps)) {
        const ts = uniformTimestamps[name];
        while (ts.length > 0 && ts[0] < cutoff) {
          ts.shift();
        }
        uniformActualFps[name] = ts.length;
      }
      uniformActualFps = { ...uniformActualFps };
    }, 100);
    return () => clearInterval(fpsInterval);
  });

  async function handleCanvasReady(canvas: HTMLCanvasElement) {
    resetVariablePreview();
    lastAppliedVariablePreviewToken = 0;
    glCanvas = canvas;
    await initializeApp();
  }

  function handleCanvasResize(data: { width: number; height: number }) {
    canvasWidth = Math.round(data.width);
    canvasHeight = Math.round(data.height);
    if (!initialized) {
      return;
    }
    renderingEngine.handleCanvasResize(data.width, data.height);
  }

  function handleCanvasClick() {
    pixelInspectorManager?.handleCanvasClick();
  }

  function handleCanvasMouseMove(event: MouseEvent) {
    if (!pixelInspectorManager || !initialized) {
      return;
    }
    pixelInspectorManager.handleMouseMove(event);
  }

  async function handleReset() {
    if (!initialized) {
      return;
    }
    audioStore.setMuted(false);
    // Reset script time origin so custom uniform iTime matches shader iTime
    transport.postMessage({ type: 'resetScriptTime' });
    await pipeline.reset(async () => {
      const lastEvent = pipeline.getLastEvent();
      if (lastEvent) {
        await handleMessage(lastEvent);
      }
      await renderingEngine.resumeAudioContext();
      renderingEngine.resumeAllAudio();
      renderingEngine.setGlobalVolume(linearToPerceptualVolume(audioVideoController!.volume), false);
    });
  }

  function handleRefresh() {
    if (!initialized) {
      return;
    }
    if (shaderLocker.isLocked()) {
      pipeline.refresh(shaderLocker.getLockedShaderPath() || undefined);
    } else {
      pipeline.refresh();
    }
  }

  function handleConfig() {
    if (!initialized) {
      return;
    }
    const lastEvent = pipeline.getLastEvent();
    const path = lastEvent?.data?.path;
    if (!path) {
      transport.postMessage({ type: 'generateConfig', payload: {} });
      return;
    }
    transport.postMessage({
      type: 'showConfig',
      payload: { shaderPath: path.replace(/\.glsl$/, '.sha.json') }
    });
  }

  function handleTogglePause() {
    if (!initialized) {
      return;
    }
    renderingEngine.togglePause();
  }

  function handleToggleLock() {
    if (!initialized) {
      return;
    }
    const currentShaderPath = pipeline.getLastEvent()?.data?.path;
    shaderLocker.toggleLock(currentShaderPath);
    isLocked = shaderLocker.isLocked();
  }

  function handleOverlayBufferSelect(name: string) {
    configSelectedBuffer = name;
  }

  function handleOverlayBufferSwitch(name: string) {
    configSelectedBuffer = name;
    setOverlayActiveFile(name);
  }

  function handleZoomChange(zoom: number) {
    zoomLevel = zoom;
  }

  function handleFpsLimitChange(limit: number) {
    if (!initialized) {
      return;
    }
    renderingEngine.setFPSLimit(limit);
  }

  function handleToggleDebugEnabled() {
    if (!initialized || !hasShader) {
      return;
    }
    debugPanelStore.toggle();
  }

  function handleToggleConfigPanel() {
    if (!hasShader) {
      return;
    }
    configPanelStore.toggle();
  }

  function handleTogglePerformancePanel() {
    performancePanelStore.toggle();
  }

  function handlePerformanceClosed() {
    performancePanelStore.setVisible(false);
  }

  $effect(() => {
    if (initialized && renderingEngine) {
      renderingEngine.setInputEnabled(!editorOverlayVisible);
    }
  });

  $effect(() => {
    if (initialized && shaderDebugManager && pixelInspectorManager && hasShader) {
      const currentEnabled = shaderDebugManager.getState().isEnabled;
      if (currentEnabled !== $debugPanelStore.isVisible) {
        shaderDebugManager.toggleEnabled();
        transport.postMessage({
          type: 'debugModeState',
          payload: { enabled: $debugPanelStore.isVisible }
        });
        lastSentDebugEnabled = $debugPanelStore.isVisible;

        if ($debugPanelStore.isVisible) {
          pixelInspectorManager.setEnabled($debugPanelStore.isPixelInspectorEnabled);
        } else {
          pixelInspectorManager.setEnabled(false);
        }

        pipeline.triggerDebugRecompile();
      } else if (lastSentDebugEnabled !== $debugPanelStore.isVisible) {
        transport.postMessage({
          type: 'debugModeState',
          payload: { enabled: $debugPanelStore.isVisible }
        });
        lastSentDebugEnabled = $debugPanelStore.isVisible;
      }
    }
  });

  $effect(() => {
    if (pixelInspectorManager) {
      const desiredInspectorEnabled = $debugPanelStore.isPixelInspectorEnabled && $debugPanelStore.isVisible;
      const currentInspectorEnabled = pixelInspectorManager.getState().isEnabled;
      if (currentInspectorEnabled !== desiredInspectorEnabled) {
        pixelInspectorManager.setEnabled(desiredInspectorEnabled);
      }
    }
  });

  function handleFork() {
    if (!initialized) {
      return;
    }
    transport.postMessage({ type: 'forkShader', payload: { shaderPath } });
  }

  function handleScreenshot(config: { format: "png" | "jpeg"; time?: number; width: number; height: number }) {
    if (!initialized) {
      return;
    }
    recordingManager.screenshot(config);
  }

  function handleRecord(config: any) {
    if (!initialized) {
      return;
    }
    recordingManager.record(config);
  }

  function handleCancelRecording() {
    recordingManager.cancel();
  }

  function handleExtensionCommand(command: string) {
    if (!initialized) {
      return;
    }
    transport.postMessage({ type: 'extensionCommand', payload: { command } });
  }

  function handleSetCompileMode(mode: CompileMode) {
    compileModeStore.setMode(mode);
  }

  async function handleManualCompile() {
    if (!initialized || $compileModeStore.mode !== 'manual') {
      return;
    }
    handleExtensionCommand('manualCompile');
  }

  function handleExpandVarHistogram(varName: string) {
    if (!variableCaptureManager) {
      return;
    }
    const vars = debugState.capturedVariables;
    const v = vars.find(c => c.varName === varName);
    const isExpanded = v?.histogram !== null || v?.channelHistograms !== null || v?.colorFrequencies !== null;
    variableCaptureManager.setHistogramExpanded(varName, !isExpanded);
    notifyVariableCaptureManager();
  }

  function handleVarClick(_varName: string, declarationLine: number) {
    if (!debugState.filePath) {
      return;
    }
    transport.postMessage({
      type: 'goToLine',
      payload: { line: declarationLine, filePath: debugState.filePath },
    });
  }

  function scheduleDebugRefresh() {
    if (sessionResolutionRefreshScheduled || !initialized || !hasShader || !debugState.isEnabled) {
      return;
    }

    sessionResolutionRefreshScheduled = true;
    void (async () => {
      await tick();
      sessionResolutionRefreshScheduled = false;

      if (!initialized || !hasShader || !debugState.isEnabled) {
        return;
      }

      pipeline?.triggerDebugRecompile();
      if (debugState.isVariableInspectorEnabled) {
        notifyVariableCaptureManager();
      }
    })();
  }

  function notifyVariableCaptureManager() {
    if (!variableCaptureManager || !shaderDebugManager) {
      return;
    }
    const state = shaderDebugManager.getState();
    if (!state.isEnabled || !state.isVariableInspectorEnabled) {
      return;
    }
    const engineCanvas = renderingEngine?.getCanvas?.();
    const effectiveCanvasWidth = engineCanvas?.width ?? canvasWidth;
    const effectiveCanvasHeight = engineCanvas?.height ?? canvasHeight;
    const debugTarget = shaderDebugManager.getDebugTarget(currentShaderCode, currentConfig);
    variableCaptureManager.notifyStateChange({
      code: debugTarget.code,
      inputConfig: debugTarget.inputConfig,
      debugLine: state.currentLine,
      activeBufferName: debugTarget.passName,
      filePath: state.filePath,
      pixelX: capturePixelX,
      pixelY: capturePixelY,
      canvasWidth: effectiveCanvasWidth,
      canvasHeight: effectiveCanvasHeight,
      loopMaxIters: shaderDebugManager.getLoopMaxIterations(),
      customParams: shaderDebugManager.getCustomParameters(),
      sampleSize: variableCaptureManager.sampleSize,
      refreshMode: variableCaptureManager.getActiveRefreshMode(hasPixelCapture),
      pollingMs: variableCaptureManager.getActivePollingMs(hasPixelCapture),
    });
  }

  function getUniforms() {
    if (!initialized) {
      return null;
    }
    return renderingEngine.getUniforms();
  }

  function handleShaderSource(event: MessageEvent) {
    const locked = shaderLocker.isLocked();
    const lockedPath = shaderLocker.getLockedShaderPath();
    if (!locked || lockedPath === event.data.path) {
      const isFirstShader = !hasShader && event.data.path;
      if (isFirstShader) {
        configPanelStore.restoreFromStorage();
        debugPanelStore.restoreFromStorage();
        performancePanelStore.restoreFromStorage();
        restoreEditorOverlayFromStorage();
      }
      const prevShaderPath = shaderPath;
      const nextShaderPath = event.data.path || "";
      const isSameShader = nextShaderPath !== "" && nextShaderPath === prevShaderPath;
      currentConfig = event.data.config || null;
      pathMap = event.data.pathMap || {};
      bufferPathMap = event.data.bufferPathMap || {};
      shaderPath = nextShaderPath;
      hasShader = Boolean(shaderPath);
      currentShaderCode = event.data.code || "";
      if (!hasShader) {
        setEditorOverlayVisible(false);
      }
      if (isFirstShader && renderingEngine.getTimeManager().isPaused()) {
        renderingEngine.togglePause();
      }
      customUniformValues = {};
      uniformTimestamps = {};
      uniformActualFps = {};
      if (shaderPath !== prevShaderPath) {
        configSelectedBuffer = 'Image';
      }
      scriptInfo = currentConfig?.script
        ? {
          filename: currentConfig.script,
          uniforms: [],
          fileExists: !event.data.scriptBundleError?.includes('not found'),
        }
        : null;
      editorOverlayManager?.setShaderSource(currentShaderCode, shaderPath);
      editorOverlayManager?.setConfig(currentConfig);
      resolutionController.handleShaderLoaded(currentConfig, isSameShader);
    }
  }

  async function handleMessage(event: MessageEvent): Promise<void> {
    const { type } = event.data;

    if (type === 'error') {
      const payload = event.data.payload;
      errors = Array.isArray(payload) ? payload : [payload];
      return;
    }

    if (type === 'fileContents') {
      editorOverlayManager?.handleFileContents(event.data.payload.path || '', event.data.payload.code || '');
      return;
    }

    if (type === 'customUniformValues') {
      const values: { name: string; type: string; value: number | number[] | boolean }[] = event.data.payload.values;
      if (renderingEngine) {
        renderingEngine.updateCustomUniformValues(values);
      }
      const now = performance.now();
      for (const v of values) {
        customUniformValues[v.name] = v.value;
        const ts = uniformTimestamps[v.name] ?? [];
        ts.push(now);
        uniformTimestamps[v.name] = ts;
      }
      customUniformValues = { ...customUniformValues };
      pollTimestamps.push(now);
      const cutoff = now - 1000;
      while (pollTimestamps.length > 0 && pollTimestamps[0] < cutoff) {
        pollTimestamps.shift();
      }
      actualPollFps = pollTimestamps.length;
      return;
    }

    if (type === 'shaderSource') {
      handleShaderSource(event);
      try {
        const result: CompilationResult | undefined = await pipeline?.handleShaderMessage(event);
        if (result?.success === false) {
          resolutionController.handleShaderLoadFailed();
        } else {
          resolutionController.handleShaderLoadSucceeded();
        }
        if (result) {
          errors = result.success ? [] : (result.errors && result.errors.length > 0 ? result.errors : []);
          if (result.success && scriptInfo) {
            scriptInfo = { ...scriptInfo, uniforms: renderingEngine.getCustomUniformInfo() };
          }
        }
        isLocked = shaderLocker.isLocked();
      } catch (err) {
        resolutionController.handleShaderLoadFailed();
        addError(`Shader message handling failed: ${err}`);
      }
      return;
    }

    if (type === 'cursorPosition') {
      pipeline?.handleCursorPositionMessage(event.data);
      return;
    }

    if (type === 'toggleEditorOverlay') {
      if (hasShader) {
        toggleEditorOverlay();
      }
      return;
    }

    if (type === 'resetLayout') {
      handleResetLayout();
      return;
    }

    if (type === 'manualCompile') {
      void handleManualCompile();
      return;
    }
  }

  async function initializeApp() {
    try {
      transport.onMessage(async (event: MessageEvent) => {
        if (routerInitialized) {
          await handleMessage(event);
        } else {
          pendingMessages.push(event);
        }
      });

      shaderLocker = new ShaderLocker();
      renderingEngine = new RenderingEngine();

      shaderDebugManager = new ShaderDebugManager();
      shaderDebugManager.setStateCallback((s) => {
        debugState = s;
      });

      try {
        renderingEngine.initialize(glCanvas, true);
      } catch (err) {
        transport.postMessage({ type: 'error', payload: ['❌ Renderer initialization failed:', String(err)] });
        addError("Failed to initialize renderer");
        return;
      }

      pipeline = new ShaderPipeline(transport, renderingEngine, shaderLocker, shaderDebugManager);
      transport.postMessage({ type: 'debug', payload: ['Svelte with piLibs initialized'] });
      transport.postMessage({ type: 'refresh' });

      editorOverlayManager = new EditorOverlayManager(
        transport, () => renderingEngine, editorOverlayCallbacks,
      );

      timeManager = renderingEngine.getTimeManager();

      // AudioVideoController must be created after the engine is initialized
      // because it subscribes to audioStore which fires immediately,
      // triggering applyGlobalAudioState() which needs a fully initialized engine.
      audioVideoController = new AudioVideoController(
        () => renderingEngine,
        (vol, mut) => {
          audioVolume = vol; audioMuted = mut; 
        },
      );

      recordingManager = new RecordingManager(
        () => {
          const lastEvent = pipeline.getLastEvent();
          return {
            code: currentShaderCode,
            config: currentConfig,
            path: shaderPath,
            buffers: lastEvent?.data?.buffers ?? {},
          };
        },
        (blob, defaultName, filters) => {
          blob.arrayBuffer().then((buf) => {
            const base64 = btoa(new Uint8Array(buf).reduce((d, b) => d + String.fromCharCode(b), ""));
            transport.postMessage({ type: "saveFile", payload: { data: base64, defaultName, filters } });
          });
        },
        (rec) => {
          isRecording = rec; 
        },
      );

      pixelInspectorManager = new PixelInspectorManager((s) => {
        inspectorState = s; 
      });
      pixelInspectorManager.initialize(renderingEngine, timeManager, glCanvas);
      pixelInspectorManager.setEnabled($debugPanelStore.isPixelInspectorEnabled && debugState.isEnabled);

      variableCaptureManager = new VariableCaptureManager(renderingEngine, (vars) => {
        shaderDebugManager?.setCapturedVariables(vars);
      });

      shaderDebugManager.setRecompileCallback(() => pipeline.triggerDebugRecompile());
      shaderDebugManager.setCaptureStateCallback(() => notifyVariableCaptureManager());
      shaderDebugManager.setStateCallback((s) => {
        debugState = s;
      });

      renderingEngine.togglePause();

      initialized = true;
      routerInitialized = true;
      for (const msg of pendingMessages) {
        await handleMessage(msg);
      }
      pendingMessages = [];

      onInitialized();
    } catch (err) {
      addError(`Initialization failed: ${err}`);
    }
  }

  const editorOverlayCallbacks: EditorOverlayCallbacks = {
    onStateChanged: (state) => {
      editorFilePath = state.filePath;
      editorFileCode = state.fileCode;
      editorBufferName = state.bufferName;
      editorBufferNames = state.bufferNames;
      if (isLocked) {
        configSelectedBuffer = state.bufferName;
      }
    },
    onShaderCodeChanged: (code) => {
      currentShaderCode = code; 
    },
    onErrors: (errs) => {
      errors = errs; 
    },
    onClearErrors: () => {
      errors = []; 
    },
    onStartRenderLoop: () => {
      renderingEngine.startRenderLoop(); 
    },
    getLastShaderEvent: () => pipeline.getLastEvent(),
    handleShaderMessage: (event) => {
      void handleMessage(event);
    },
  };

  $effect(() => {
    if (editorOverlayVisible && editorOverlayManager) {
      editorOverlayManager.handleConfigFileSelect(getOverlayActiveFile(), shaderPath);
    }
  });

  function addError(message: string) {
    errors = [...errors, message];
    if (transport) {
      transport.postMessage({ type: "error", payload: [message] });
    }
  }

  $effect(() => {
    if (!initialized || !hasShader) {
      return;
    }
    // Access these to track them:
    debugState.isEnabled;
    debugState.isActive;
    debugState.isInlineRenderingEnabled;
    (debugState as any).activeBufferName;
    currentConfig;
    resolutionController.handleDebugStateChanged();
  });

  $effect(() => {
    const preview = getVariablePreview();
    const { token, varName, varType, debugLine, activeBufferName, filePath } = preview;

    if (!shaderDebugManager || !pipeline) {
      return;
    }

    const canPreview = initialized
      && debugState.isEnabled
      && !debugState.isLineLocked;

    if (!canPreview) {
      lastAppliedVariablePreviewToken = -1;
      if (shaderDebugManager.clearVariablePreview()) {
        pipeline.triggerDebugRecompile();
      }
      return;
    }

    if (token === lastAppliedVariablePreviewToken) {
      return;
    }
    lastAppliedVariablePreviewToken = token;

    if (varName !== null && varType !== null && debugLine !== null && activeBufferName !== null) {
      if (shaderDebugManager.setVariablePreview({
        varName,
        varType,
        debugLine,
        activeBufferName,
        filePath,
      })) {
        pipeline.triggerDebugRecompile();
      }
      return;
    }

    if (shaderDebugManager.clearVariablePreview()) {
      pipeline.triggerDebugRecompile();
    }
  });

  // Dockview functions
  let resetLayoutFn: (() => void) | null = null;
  let showPreviewFn: (() => void) | null = null;
  let previewVisible = $state(true);
  let previewAlone = $state(true);

  function handleResetLayout() {
    if (resetLayoutFn) {
      resetLayoutFn();
    }
  }

  function handleShowPreview() {
    if (showPreviewFn) {
      showPreviewFn();
    }
  }

  function handleDockviewReady(event: CustomEvent<{ resetLayout: () => void; showPreview: () => void }>) {
    resetLayoutFn = event.detail.resetLayout;
    showPreviewFn = event.detail.showPreview;
  }

  function handlePreviewVisibleChange(event: CustomEvent<boolean>) {
    previewVisible = event.detail;
  }

  function handlePreviewAloneChange(event: CustomEvent<boolean>) {
    previewAlone = event.detail;
  }

  function handleDebugClosed() {
    debugPanelStore.setVisible(false);
  }

  function handleConfigClosed() {
    configPanelStore.setVisible(false);
  }

  async function handleConfigPanelConfigChange(updatedConfig: ShaderConfig) {
    resolutionController.handleConfigUpdated(updatedConfig);
    await tick();
  }

  // DOM teleport refs
  let previewEl: HTMLElement;
  let debugEl: HTMLElement;
  let configEl: HTMLElement;
  let performanceEl: HTMLElement;

  function createMountFn(getEl: () => HTMLElement): (container: HTMLElement) => () => void {
    return (container) => {
      const el = getEl();
      if (el) {
        container.appendChild(el);
      }
      return () => {
        if (el?.parentNode === container) {
          container.removeChild(el);
        } 
      };
    };
  }

  const mountPreview = createMountFn(() => previewEl);
  const mountDebug = createMountFn(() => debugEl);
  const mountConfig = createMountFn(() => configEl);
  const mountPerformance = createMountFn(() => performanceEl);

  onDestroy(() => {
    resetVariablePreview();
    if (transport?.getType() === 'websocket') {
      releaseWebLayoutSlot();
    }
    if (recordingManager) {
      recordingManager.dispose();
    }
    if (audioVideoController) {
      audioVideoController.dispose();
    }
    if (editorOverlayManager) {
      editorOverlayManager.dispose();
    }
    if (variableCaptureManager) {
      variableCaptureManager.dispose();
    }
    if (pixelInspectorManager) {
      pixelInspectorManager.dispose();
    }
    if (renderingEngine) {
      renderingEngine.dispose();
    }
    if (transport) {
      transport.dispose();
    }
  });
</script>

<div class="main-container" role="application" onmousemove={handleCanvasMouseMove}>
  <div class="dockview-panel-source" bind:this={previewEl}>
    <ShaderCanvas
      {zoomLevel}
      isInspectorActive={inspectorActive}
      onCanvasReady={handleCanvasReady}
      onCanvasResize={handleCanvasResize}
      onCanvasClick={handleCanvasClick}
    />
    {#if !hasShader}
      <div class="no-active-shader-state">No active shader</div>
    {/if}
    {#if initialized}
      {#key editorFilePath}
        <EditorOverlay
          isVisible={editorOverlayVisible}
          bottomInset={previewAlone && previewVisible ? 44 : 0}
          shaderCode={editorFileCode}
          shaderPath={editorFilePath}
          {transport}
          onCodeChange={(code) => editorOverlayManager?.handleEditorCodeChange(code)}
          compileMode={$compileModeStore.mode}
          vimMode={editorVimMode}
          bufferNames={editorBufferNames}
          activeBufferName={editorBufferName}
          onBufferSwitch={handleOverlayBufferSwitch}
          onCursorChange={(line, lineContent, bufferName) => pipeline?.handleOverlayCursor(line, lineContent, bufferName)}
          {errors}
        />
      {/key}
    {/if}
    {#if initialized && previewAlone && previewVisible}
      <MenuBar {...menuBarProps} />
    {/if}
  </div>
  <div class="dockview-panel-source" bind:this={debugEl}>
    {#if debugState.isEnabled}
      <DebugPanel
        {debugState}
        {getUniforms}
        {shaderDebugManager}
        {variableCaptureManager}
        isInspectorEnabled={inspectorEnabled}
        isInspectorActive={inspectorActive}
        isInspectorLocked={inspectorLocked}
        onExpandVarHistogram={handleExpandVarHistogram}
        onVarClick={handleVarClick}
        hasPixelSelected={hasPixelCapture}
        onCaptureSettingsChanged={notifyVariableCaptureManager}
        {customUniformValues}
      />
    {/if}
  </div>
  <div class="dockview-panel-source" bind:this={configEl}>
    {#if $configPanelStore.isVisible}
      <ConfigPanel
        config={currentConfig}
        {pathMap}
        {bufferPathMap}
        {transport}
        {shaderPath}
        isVisible={$configPanelStore.isVisible}
        onFileSelect={handleOverlayBufferSelect}
        selectedBuffer={configSelectedBuffer}
        isLocked={isLocked}
        {audioVideoController}
        globalMuted={audioMuted}
        {scriptInfo}
        {customUniformValues}
        {actualPollFps}
        {uniformActualFps}
        onConfigChange={handleConfigPanelConfigChange}
      />
    {/if}
  </div>
  <div class="dockview-panel-source" bind:this={performanceEl}>
    {#if $performancePanelStore.isVisible}
      <FrameTimesPanel {renderingEngine} active={$performancePanelStore.isVisible} />
    {/if}
  </div>

  <DockviewLayout
    {mountPreview}
    {mountDebug}
    {mountConfig}
    {mountPerformance}
    showDebugPanel={$debugPanelStore.isVisible}
    showConfigPanel={$configPanelStore.isVisible}
    showPerformancePanel={$performancePanelStore.isVisible}
    {transport}
    {layoutSlot}
    on:ready={handleDockviewReady}
    on:previewVisibleChange={handlePreviewVisibleChange}
    on:previewAloneChange={handlePreviewAloneChange}
    on:debugClosed={handleDebugClosed}
    on:configClosed={handleConfigClosed}
    on:performanceClosed={handlePerformanceClosed}
  />
  {#if initialized && !(previewAlone && previewVisible)}
    <MenuBar {...menuBarProps} />
  {/if}
  <PixelInspector
    isActive={inspectorState.isActive}
    isLocked={inspectorState.isLocked}
    mouseX={inspectorState.mouseX}
    mouseY={inspectorState.mouseY}
    rgb={inspectorState.pixelRGB}
    fragCoord={inspectorState.fragCoord}
    {canvasWidth}
    {canvasHeight}
  />
  <InspectorCrosshair
    isVisible={inspectorState.isLocked && inspectorState.canvasPosition !== null}
    canvasX={inspectorState.canvasPosition?.x ?? 0}
    canvasY={inspectorState.canvasPosition?.y ?? 0}
    canvasElement={glCanvas}
  />

</div>

<style>
  .dockview-panel-source {
    position: absolute;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .no-active-shader-state {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    color: rgba(255, 255, 255, 0.72);
    font-size: 13px;
    letter-spacing: 0.08em;
  }
</style>
