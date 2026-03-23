<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ShaderStudio } from "../ShaderStudio";
  import { createTransport } from "../transport/TransportFactory";
  import type { Transport } from "../transport/MessageTransport";
  import ShaderCanvas from "./ShaderCanvas.svelte";
  import MenuBar from "./MenuBar.svelte";
  import PixelInspector from "./PixelInspector.svelte";
  import InspectorCrosshair from "./InspectorCrosshair.svelte";
  import ConfigPanel from "./config/ConfigPanel.svelte";
  import DebugPanel from "./debug/DebugPanel.svelte";
  import EditorOverlay from "./EditorOverlay.svelte";
  import DockviewLayout from "./DockviewLayout.svelte";
  import { RecordingManager } from "../RecordingManager";
  import { ShaderLocker } from "../ShaderLocker";
  import { RenderingEngine } from "../../../../rendering/src/RenderingEngine";
  import { PixelInspectorManager } from "../PixelInspectorManager";
  import type { PixelInspectorState } from "../types/PixelInspectorState";
  import { ShaderDebugManager } from "../ShaderDebugManager";
  import type { ShaderDebugState } from "../types/ShaderDebugState";
  import { VariableCaptureManager } from "../VariableCaptureManager";
  import { AudioVideoController } from "../AudioVideoController";
  import { MessageRouter, type MessageRouterCallbacks } from "../MessageRouter";
  import { EditorOverlayManager, type EditorOverlayCallbacks } from "../EditorOverlayManager";
  import { configPanelStore } from "../stores/configPanelStore";
  import { debugPanelStore } from "../stores/debugPanelStore";
  import { performancePanelStore } from "../stores/performancePanelStore";
  import { editorOverlayStore } from "../stores/editorOverlayStore";
  import { audioStore, linearToPerceptualVolume } from "../stores/audioStore";
  import { compileModeStore, type CompileMode } from "../stores/compileModeStore";
  import { PerformanceMonitor } from "../PerformanceMonitor";
  import type { PerformanceData } from "../PerformanceMonitor";
  import FrameTimesPanel from "./performance/FrameTimesPanel.svelte";
  import type { ShaderConfig } from "@shader-studio/types";

  export let onInitialized: (data: {
    shaderStudio: ShaderStudio;
  }) => void = () => {};

  // Core state
  let glCanvas: HTMLCanvasElement;
  let initialized = false;
  let isLocked = false;
  let hasShader = false;
  let errors: string[] = [];
  let currentFPS = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let zoomLevel = 1.0;
  let inspectorState: PixelInspectorState = {
    isEnabled: false,
    isActive: false,
    isLocked: false,
    mouseX: 0,
    mouseY: 0,
    pixelRGB: null,
    fragCoord: null,
    canvasPosition: null,
  };

  // Managers and controllers
  let shaderStudio: ShaderStudio;
  let renderingEngine: RenderingEngine;
  let transport: Transport = createTransport();
  let timeManager: any = null;
  let pixelInspectorManager: PixelInspectorManager | undefined;
  let debugInspectorEnabled = true;
  let shaderDebugManager: ShaderDebugManager | undefined;
  let variableCaptureManager: VariableCaptureManager | undefined;
  let audioVideoController: AudioVideoController | undefined;
  let messageRouter: MessageRouter | undefined;
  let editorOverlayManager: EditorOverlayManager | undefined;

  let debugState: ShaderDebugState = {
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
  };

  // Audio state (mirrored from AudioVideoController for Svelte reactivity)
  let audioVolume = 1.0;
  let audioMuted = true;

  // Recording
  let isRecording = false;
  let recordingManager: RecordingManager;

  // Config panel state
  let configPanelVisible = false;
  let currentConfig: ShaderConfig | null = null;
  let pathMap: Record<string, string> = {};
  let bufferPathMap: Record<string, string> = {};
  let shaderPath: string = "";

  // Script info for config panel
  let scriptInfo: { filename: string; uniforms: { name: string; type: string }[]; fileExists?: boolean } | null = null;
  let customUniformValues: Record<string, number | number[] | boolean> = {};
  let actualPollFps = 0;
  let pollTimestamps: number[] = [];
  let uniformTimestamps: Record<string, number[]> = {};
  let uniformActualFps: Record<string, number> = {};

  // Debug panel state
  let debugPanelVisible = true;
  let persistedVariableInspectorEnabled = false;
  let persistedInlineRenderingEnabled = true;
  let persistedPixelInspectorEnabled = true;

  // Editor overlay state (mirrored from EditorOverlayManager for Svelte reactivity)
  let editorOverlayVisible = false;
  let editorVimMode = false;
  let currentShaderCode: string = "";
  let editorBufferName: string = "Image";
  let editorFilePath: string = "";
  let editorFileCode: string = "";
  let editorBufferNames: string[] = ["Image"];

  // Performance panel state
  let performancePanelVisible = false;
  let performanceMonitor: PerformanceMonitor | undefined;
  let performanceData: PerformanceData | null = null;
  let compileMode: CompileMode = "hot";
  let lastSentCompileMode: CompileMode | null = null;
  let debugSampleSize = 32;
  let debugRefreshMode: import('../VariableCaptureManager').RefreshMode = 'polling';
  let debugPollingMs = 500;

  $: showDebugPanel = debugState.isEnabled && debugPanelVisible;

  $: if (initialized && compileMode !== lastSentCompileMode) {
    transport.postMessage({
      type: 'setCompileMode',
      payload: { mode: compileMode },
    });
    lastSentCompileMode = compileMode;
  }

  // Extract specific debug state fields so that capturedVariables changes
  // don't re-trigger the capture loop (Svelte tracks the whole object reference).
  $: varInspectorEnabled = debugState.isVariableInspectorEnabled;
  $: debugCurrentLine = debugState.currentLine;

  // Extract inspectorState fields as stable primitives.
  $: inspectorEnabled = inspectorState.isEnabled;
  $: inspectorActive = inspectorState.isActive;
  $: inspectorLocked = inspectorState.isLocked;
  $: inspectorCanvasX = inspectorState.canvasPosition?.x ?? null;
  $: inspectorCanvasY = inspectorState.canvasPosition?.y ?? null;

  // Derive whether we're currently in pixel capture mode
  $: hasPixelCapture = (inspectorActive || inspectorLocked) && (inspectorCanvasX !== null);

  // Active refresh/polling from VariableCaptureManager
  $: activeRefreshMode = variableCaptureManager
    ? variableCaptureManager.getActiveRefreshMode(hasPixelCapture)
    : 'polling';
  $: activePollingMs = variableCaptureManager
    ? variableCaptureManager.getActivePollingMs(hasPixelCapture)
    : 500;
  $: if (variableCaptureManager) {
    hasPixelCapture;
    debugSampleSize = variableCaptureManager.sampleSize;
    debugRefreshMode = variableCaptureManager.getActiveRefreshMode(hasPixelCapture);
    debugPollingMs = variableCaptureManager.getActivePollingMs(hasPixelCapture);
  }

  // Stable pixel coordinates for the capture reactive block
  $: capturePixelX = hasPixelCapture ? inspectorCanvasX : null;
  $: capturePixelY = hasPixelCapture ? inspectorCanvasY : null;

  // Reactive: notify variable capture manager when relevant state changes.
  $: if (initialized && variableCaptureManager && shaderDebugManager && varInspectorEnabled) {
    variableCaptureManager.notifyStateChange({
      code: currentShaderCode,
      debugLine: debugCurrentLine,
      pixelX: capturePixelX,
      pixelY: capturePixelY,
      canvasWidth,
      canvasHeight,
      loopMaxIters: shaderDebugManager.getLoopMaxIterations(),
      customParams: shaderDebugManager.getCustomParameters(),
      sampleSize: variableCaptureManager.sampleSize,
      refreshMode: variableCaptureManager.getActiveRefreshMode(hasPixelCapture),
      pollingMs: variableCaptureManager.getActivePollingMs(hasPixelCapture),
    });
  }

  // Shared MenuBar props — two instances exist in different DOM positions for dockview layout
  $: menuBarProps = {
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
    isConfigPanelVisible: configPanelVisible,
    onToggleConfigPanel: handleToggleConfigPanel,
    isPerformancePanelVisible: performancePanelVisible,
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
    compileMode,
    onSetCompileMode: handleSetCompileMode,
    onManualCompile: handleManualCompile,
  };

  // Subscribe to config/debug panel stores
  onMount(() => {
    const unsubConfig = configPanelStore.subscribe((state) => {
      configPanelVisible = state.isVisible;
    });
    const unsubDebug = debugPanelStore.subscribe((state) => {
      debugPanelVisible = state.isVisible;
      persistedVariableInspectorEnabled = state.isVariableInspectorEnabled;
      persistedInlineRenderingEnabled = state.isInlineRenderingEnabled;
      persistedPixelInspectorEnabled = state.isPixelInspectorEnabled;

      shaderDebugManager?.setVariableInspectorEnabled(state.isVariableInspectorEnabled);
      shaderDebugManager?.setInlineRenderingEnabled(state.isInlineRenderingEnabled);
      pixelInspectorManager?.setEnabled(state.isPixelInspectorEnabled && (shaderDebugManager?.getState().isEnabled ?? false));
    });
    const unsubPerf = performancePanelStore.subscribe((state) => {
      performancePanelVisible = state.isVisible;
    });
    const unsubCompileMode = compileModeStore.subscribe((state) => {
      compileMode = state.mode;
    });
    return () => {
      unsubConfig();
      unsubDebug();
      unsubPerf();
      unsubCompileMode();
    };
  });

  // FPS polling
  onMount(() => {
    const fpsInterval = setInterval(() => {
      if (initialized && shaderStudio) {
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
        while (ts.length > 0 && ts[0] < cutoff) ts.shift();
        uniformActualFps[name] = ts.length;
      }
      uniformActualFps = { ...uniformActualFps };
    }, 100);
    return () => clearInterval(fpsInterval);
  });

  async function handleCanvasReady(canvas: HTMLCanvasElement) {
    glCanvas = canvas;
    await initializeApp();
  }

  function handleCanvasResize(data: { width: number; height: number }) {
    if (!initialized) return;
    canvasWidth = Math.round(data.width);
    canvasHeight = Math.round(data.height);
    renderingEngine.handleCanvasResize(data.width, data.height);
  }

  function handleCanvasClick() {
    pixelInspectorManager?.handleCanvasClick();
  }

  function handleCanvasMouseMove(event: MouseEvent) {
    if (!pixelInspectorManager || !initialized) return;
    pixelInspectorManager.handleMouseMove(event);
  }

  function handleReset() {
    if (!initialized) return;
    audioStore.setMuted(false);
    // Reset script time origin so custom uniform iTime matches shader iTime
    transport.postMessage({ type: 'resetScriptTime' });
    shaderStudio.handleReset(async () => {
      const lastEvent = shaderStudio!.getLastShaderEvent();
      if (lastEvent) {
        await messageRouter!.handleMessage(lastEvent);
      }
      const engine = shaderStudio?.getRenderingEngine();
      if (engine) {
        await engine.resumeAudioContext();
        engine.resumeAllAudio();
        engine.setGlobalVolume(linearToPerceptualVolume(audioVideoController!.volume), false);
      }
    });
  }

  function handleRefresh() {
    if (!initialized) return;
    shaderStudio.handleRefresh();
  }

  function handleConfig() {
    if (!initialized) return;
    const lastEvent = shaderStudio.getLastShaderEvent();
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

  function handleScriptPollingFpsChange(fps: number) {
    if (!currentConfig || !shaderPath) return;
    const updatedConfig = { ...currentConfig, scriptMaxPollingFps: fps };
    currentConfig = updatedConfig;
    const text = JSON.stringify(updatedConfig, null, 2);
    // Save config to disk (skip shader refresh)
    transport.postMessage({
      type: 'updateConfig',
      payload: { config: updatedConfig, text, shaderPath, skipRefresh: true },
    });
    // Update the live polling rate without restarting the shader
    transport.postMessage({
      type: 'updateScriptPollingRate',
      payload: { fps },
    });
  }

  function handleTogglePause() {
    if (!initialized) return;
    renderingEngine.togglePause();
  }

  function handleToggleLock() {
    if (!initialized) return;
    shaderStudio.handleToggleLock();
    isLocked = shaderStudio.getIsLocked();
  }

  function handleZoomChange(zoom: number) {
    zoomLevel = zoom;
  }

  function handleFpsLimitChange(limit: number) {
    if (!initialized) return;
    renderingEngine.setFPSLimit(limit);
  }

  function handleToggleInspectorEnabled() {
    if (!pixelInspectorManager) return;
    if (!pixelInspectorManager.getState().isEnabled && !shaderDebugManager?.getState().isEnabled) return;
    pixelInspectorManager.toggleEnabled();
    debugInspectorEnabled = pixelInspectorManager.getState().isEnabled;
    debugPanelStore.setPixelInspectorEnabled(debugInspectorEnabled);
  }

  function handleToggleDebugEnabled() {
    if (!shaderDebugManager || !initialized || !hasShader) return;
    shaderDebugManager.toggleEnabled();

    transport.postMessage({
      type: 'debugModeState',
      payload: { enabled: shaderDebugManager.getState().isEnabled }
    });

    if (pixelInspectorManager) {
      if (shaderDebugManager.getState().isEnabled) {
        pixelInspectorManager.setEnabled(persistedPixelInspectorEnabled);
      } else {
        debugInspectorEnabled = pixelInspectorManager.getState().isEnabled;
        pixelInspectorManager.setEnabled(false);
      }
    }

    shaderStudio.triggerDebugRecompile();
  }

  function handleToggleConfigPanel() {
    if (!hasShader) return;
    configPanelStore.toggle();
  }

  function handleTogglePerformancePanel() {
    performancePanelStore.toggle();
  }

  function handlePerformanceClosed() {
    performancePanelStore.setVisible(false);
  }

  // Start/stop performance monitor based on panel visibility
  $: if (performanceMonitor) {
    if (performancePanelVisible) {
      performanceMonitor.start();
    } else {
      performanceMonitor.stop();
    }
  }

  $: if (initialized && renderingEngine) {
    renderingEngine.setInputEnabled(!editorOverlayVisible);
  }

  function handleFork() {
    if (!initialized) return;
    transport.postMessage({ type: 'forkShader', payload: { shaderPath } });
  }

  function handleScreenshot(config: { format: "png" | "jpeg"; time?: number; width: number; height: number }) {
    if (!initialized) return;
    recordingManager.screenshot(config);
  }

  function handleRecord(config: any) {
    if (!initialized) return;
    recordingManager.record(config);
  }

  function handleCancelRecording() {
    recordingManager.cancel();
  }

  function handleExtensionCommand(command: string) {
    if (!initialized) return;
    transport.postMessage({ type: 'extensionCommand', payload: { command } });
  }

  function handleSetCompileMode(mode: CompileMode) {
    compileModeStore.setMode(mode);
  }

  async function handleManualCompile() {
    if (!initialized || compileMode !== 'manual') return;
    handleExtensionCommand('manualCompile');
  }

  function handleExpandVarHistogram(varName: string) {
    if (!variableCaptureManager) return;
    const vars = debugState.capturedVariables;
    const v = vars.find(c => c.varName === varName);
    const isExpanded = v?.histogram !== null || v?.channelHistograms !== null || v?.colorFrequencies !== null;
    variableCaptureManager.setHistogramExpanded(varName, !isExpanded);
    notifyVariableCaptureManager();
  }

  function handleVarClick(_varName: string, declarationLine: number) {
    if (!debugState.filePath) return;
    transport.postMessage({
      type: 'goToLine',
      payload: { line: declarationLine, filePath: debugState.filePath },
    });
  }

  function notifyVariableCaptureManager() {
    if (!variableCaptureManager || !shaderDebugManager) return;
    const state = shaderDebugManager.getState();
    if (!state.isVariableInspectorEnabled) return;
    variableCaptureManager.notifyStateChange({
      code: currentShaderCode,
      debugLine: state.currentLine,
      pixelX: capturePixelX,
      pixelY: capturePixelY,
      canvasWidth,
      canvasHeight,
      loopMaxIters: shaderDebugManager.getLoopMaxIterations(),
      customParams: shaderDebugManager.getCustomParameters(),
      sampleSize: variableCaptureManager.sampleSize,
      refreshMode: variableCaptureManager.getActiveRefreshMode(hasPixelCapture),
      pollingMs: variableCaptureManager.getActivePollingMs(hasPixelCapture),
    });
  }

  function getUniforms() {
    if (!initialized || !shaderStudio) return null;
    return renderingEngine.getUniforms();
  }

  function handleShaderSource(event: MessageEvent) {
    const locked = shaderStudio.getIsLocked();
    const lockedPath = shaderStudio.getLockedShaderPath();
    if (!locked || lockedPath === event.data.path) {
      const isFirstShader = !hasShader && event.data.path;
      if (isFirstShader) {
        configPanelStore.restoreFromStorage();
        debugPanelStore.restoreFromStorage();
        performancePanelStore.restoreFromStorage();
      }
      currentConfig = event.data.config || null;
      pathMap = event.data.pathMap || {};
      bufferPathMap = event.data.bufferPathMap || {};
      shaderPath = event.data.path || "";
      hasShader = Boolean(shaderPath);
      currentShaderCode = event.data.code || "";
      if (!hasShader) {
        editorOverlayStore.setVisible(false);
      }
      if (isFirstShader && renderingEngine.getTimeManager().isPaused()) {
        renderingEngine.togglePause();
      }
      customUniformValues = {};
      uniformTimestamps = {};
      uniformActualFps = {};
      scriptInfo = currentConfig?.script
        ? {
            filename: currentConfig.script,
            uniforms: [],
            fileExists: !event.data.scriptBundleError?.includes('not found'),
          }
        : null;
      editorOverlayManager?.setShaderSource(currentShaderCode, shaderPath);
      editorOverlayManager?.setConfig(currentConfig);
    }
  }

  async function initializeApp() {
    try {
      transport.onMessage(async (event: MessageEvent) => {
        if (initialized) {
          await messageRouter!.handleMessage(event);
          if (event.data.type === 'cursorPosition' && shaderStudio) {
            const handler = (shaderStudio as any).messageHandler;
            handler?.handleCursorPositionMessage(event.data);
          }
        } else {
          messageRouter?.bufferMessage(event);
        }
      });

      const shaderLocker = new ShaderLocker();
      renderingEngine = new RenderingEngine();

      shaderDebugManager = new ShaderDebugManager();
      shaderDebugManager.setStateCallback((s) => { debugState = s; });
      shaderDebugManager.setVariableInspectorEnabled(persistedVariableInspectorEnabled);
      shaderDebugManager.setInlineRenderingEnabled(persistedInlineRenderingEnabled);

      shaderStudio = new ShaderStudio(transport, shaderLocker, renderingEngine, shaderDebugManager);

      messageRouter = new MessageRouter(() => shaderStudio, messageRouterCallbacks);

      editorOverlayManager = new EditorOverlayManager(
        transport, () => renderingEngine, editorOverlayCallbacks,
      );

      const success = await shaderStudio.initialize(glCanvas);
      if (!success) {
        addError("Failed to initialize ShaderStudio");
        return;
      }

      timeManager = renderingEngine.getTimeManager();

      // AudioVideoController must be created after shaderStudio.initialize()
      // because it subscribes to audioStore which fires immediately,
      // triggering applyGlobalAudioState() which needs a fully initialized engine.
      audioVideoController = new AudioVideoController(
        () => shaderStudio,
        (vol, mut) => { audioVolume = vol; audioMuted = mut; },
      );

      recordingManager = new RecordingManager(
        () => {
          const lastEvent = shaderStudio.getLastShaderEvent();
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
        (rec) => { isRecording = rec; },
      );

      pixelInspectorManager = new PixelInspectorManager((s) => { inspectorState = s; });
      pixelInspectorManager.initialize(renderingEngine, timeManager, glCanvas);
      debugInspectorEnabled = persistedPixelInspectorEnabled;
      pixelInspectorManager.setEnabled(persistedPixelInspectorEnabled && debugState.isEnabled);

      variableCaptureManager = new VariableCaptureManager(renderingEngine, (vars) => {
        shaderDebugManager?.setCapturedVariables(vars);
      });
      variableCaptureManager.setSampleSettingsCallback(() => {
        debugSampleSize = variableCaptureManager?.sampleSize ?? 32;
        debugRefreshMode = variableCaptureManager?.getActiveRefreshMode(hasPixelCapture) ?? 'polling';
        debugPollingMs = variableCaptureManager?.getActivePollingMs(hasPixelCapture) ?? 500;
        notifyVariableCaptureManager();
      });

      shaderDebugManager.setRecompileCallback(() => shaderStudio.triggerDebugRecompile());
      shaderDebugManager.setCaptureStateCallback(() => notifyVariableCaptureManager());
      shaderDebugManager.setStateCallback((s) => {
        debugState = s;
        debugPanelStore.setVariableInspectorEnabled(s.isVariableInspectorEnabled);
        debugPanelStore.setInlineRenderingEnabled(s.isInlineRenderingEnabled);
      });

      // Initialize performance monitor
      performanceMonitor = new PerformanceMonitor(renderingEngine);
      performanceMonitor.setStateCallback((data) => {
        performanceData = data;
      });

      renderingEngine.togglePause();

      initialized = true;
      messageRouter.markInitialized();
      messageRouter.replayPendingMessages();

      onInitialized({ shaderStudio });
    } catch (err) {
      addError(`Initialization failed: ${err}`);
    }
  }

  // Callback objects for managers — defined as getters to close over Svelte state
  const messageRouterCallbacks: MessageRouterCallbacks = {
    onError: (errs) => { errors = errs; },
    onMessageError: (msg) => { addError(msg); },
    onFileContents: (path, code) => { editorOverlayManager?.handleFileContents(path, code); },
    onShaderSource: handleShaderSource,
    onToggleEditorOverlay: () => {
      if (!hasShader) return;
      editorOverlayStore.toggle();
    },
    onResetLayout: () => { handleResetLayout(); },
    onManualCompile: () => { void handleManualCompile(); },
    onCompilationResult: (result) => {
      if (result) {
        errors = result.success ? [] : (result.errors && result.errors.length > 0 ? result.errors : []);
        if (result.success && scriptInfo) {
          scriptInfo = {
            ...scriptInfo,
            uniforms: renderingEngine.getCustomUniformInfo(),
          };
        }
      }
    },
    onLockStateChanged: (locked) => { isLocked = locked; },
    onCustomUniformValues: (values) => {
      if (renderingEngine) {
        renderingEngine.updateCustomUniformValues(values);
      }
      // Merge changed values (not full replace)
      const now = performance.now();
      for (const v of values) {
        customUniformValues[v.name] = v.value;
        // Per-uniform fps tracking
        const ts = uniformTimestamps[v.name] ?? [];
        ts.push(now);
        uniformTimestamps[v.name] = ts;
      }
      customUniformValues = { ...customUniformValues };

      // Global poll rate tracking
      pollTimestamps.push(now);
      const cutoff = now - 1000;
      while (pollTimestamps.length > 0 && pollTimestamps[0] < cutoff) {
        pollTimestamps.shift();
      }
      actualPollFps = pollTimestamps.length;
    },
  };

  const editorOverlayCallbacks: EditorOverlayCallbacks = {
    onStateChanged: (state) => {
      editorOverlayVisible = hasShader && state.visible;
      editorVimMode = state.vimMode;
      editorFilePath = state.filePath;
      editorFileCode = state.fileCode;
      editorBufferName = state.bufferName;
      editorBufferNames = state.bufferNames;
    },
    onShaderCodeChanged: (code) => { currentShaderCode = code; },
    onErrors: (errs) => { errors = errs; },
    onClearErrors: () => { errors = []; },
    onStartRenderLoop: () => { renderingEngine.startRenderLoop(); },
    getLastShaderEvent: () => shaderStudio.getLastShaderEvent(),
    handleShaderMessage: (event) => { messageRouter!.handleMessage(event); },
  };

  function addError(message: string) {
    errors = [...errors, message];
    if (transport) {
      transport.postMessage({ type: "error", payload: [message] });
    }
  }

  // Dockview functions
  let resetLayoutFn: (() => void) | null = null;
  let showPreviewFn: (() => void) | null = null;
  let previewVisible = true;
  let previewAlone = true;

  function handleResetLayout() {
    if (resetLayoutFn) resetLayoutFn();
  }

  function handleShowPreview() {
    if (showPreviewFn) showPreviewFn();
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
    if (shaderDebugManager && debugState.isEnabled) {
      handleToggleDebugEnabled();
    }
  }

  function handleConfigClosed() {
    configPanelStore.setVisible(false);
  }

  // DOM teleport refs
  let previewEl: HTMLElement;
  let debugEl: HTMLElement;
  let configEl: HTMLElement;
  let performanceEl: HTMLElement;

  function createMountFn(getEl: () => HTMLElement): (container: HTMLElement) => () => void {
    return (container) => {
      const el = getEl();
      if (el) container.appendChild(el);
      return () => { if (el?.parentNode === container) container.removeChild(el); };
    };
  }

  const mountPreview = createMountFn(() => previewEl);
  const mountDebug = createMountFn(() => debugEl);
  const mountConfig = createMountFn(() => configEl);
  const mountPerformance = createMountFn(() => performanceEl);

  onDestroy(() => {
    if (recordingManager) recordingManager.dispose();
    if (performanceMonitor) performanceMonitor.dispose();
    if (audioVideoController) audioVideoController.dispose();
    if (editorOverlayManager) editorOverlayManager.dispose();
    if (variableCaptureManager) variableCaptureManager.dispose();
    if (pixelInspectorManager) pixelInspectorManager.dispose();
    if (renderingEngine) renderingEngine.dispose();
    if (transport) transport.dispose();
  });
</script>

<div class="main-container" role="application" on:mousemove={handleCanvasMouseMove}>
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
      <EditorOverlay
        isVisible={editorOverlayVisible}
        bottomInset={previewAlone && previewVisible ? 44 : 0}
        shaderCode={editorFileCode}
        shaderPath={editorFilePath}
        {transport}
        onCodeChange={(code) => editorOverlayManager?.handleEditorCodeChange(code)}
        {compileMode}
        vimMode={editorVimMode}
        bufferNames={editorBufferNames}
        activeBufferName={editorBufferName}
        onBufferSwitch={(name) => editorOverlayManager?.handleConfigFileSelect(name, shaderPath)}
        {errors}
      />
    {/if}
    {#if initialized && previewAlone && previewVisible}
      <MenuBar {...menuBarProps} />
    {/if}
  </div>
  <div class="dockview-panel-source" bind:this={debugEl}>
    {#if showDebugPanel}
      <DebugPanel
        {debugState}
        {getUniforms}
        {shaderDebugManager}
        {variableCaptureManager}
        isInspectorEnabled={inspectorEnabled}
        isInspectorActive={inspectorActive}
        isInspectorLocked={inspectorLocked}
        onToggleInspectorEnabled={handleToggleInspectorEnabled}
        onExpandVarHistogram={handleExpandVarHistogram}
        onVarClick={handleVarClick}
        sampleSize={debugSampleSize}
        refreshMode={debugRefreshMode}
        pollingMs={debugPollingMs}
        hasPixelSelected={hasPixelCapture}
        {customUniformValues}
      />
    {/if}
  </div>
  <div class="dockview-panel-source" bind:this={configEl}>
    {#if configPanelVisible}
      <ConfigPanel
        config={currentConfig}
        {pathMap}
        {bufferPathMap}
        {transport}
        {shaderPath}
        isVisible={configPanelVisible}
        onFileSelect={(name) => editorOverlayManager?.handleConfigFileSelect(name, shaderPath)}
        selectedBuffer={editorBufferName}
        isLocked={isLocked}
        {audioVideoController}
        globalMuted={audioMuted}
        {scriptInfo}
        {customUniformValues}
        {actualPollFps}
        {uniformActualFps}
        onScriptPollingFpsChange={handleScriptPollingFpsChange}
      />
    {/if}
  </div>
  <div class="dockview-panel-source" bind:this={performanceEl}>
    {#if performancePanelVisible}
      <FrameTimesPanel data={performanceData} />
    {/if}
  </div>

  <DockviewLayout
    {mountPreview}
    {mountDebug}
    {mountConfig}
    {mountPerformance}
    {showDebugPanel}
    showConfigPanel={configPanelVisible}
    showPerformancePanel={performancePanelVisible}
    {transport}
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
