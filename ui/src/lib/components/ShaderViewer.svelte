<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ShaderStudio } from "../ShaderStudio";
  import { createTransport } from "../transport/TransportFactory";
  import type { Transport } from "../transport/MessageTransport";
  import type { AspectRatioMode } from "../stores/aspectRatioStore";
  import type { QualityMode } from "../stores/qualityStore";
  import ShaderCanvas from "./ShaderCanvas.svelte";
  import MenuBar from "./MenuBar.svelte";
  import ErrorDisplay from "./ErrorDisplay.svelte";
  import PixelInspector from "./PixelInspector.svelte";
  import InspectorCrosshair from "./InspectorCrosshair.svelte";
  import ConfigPanel from "./config/ConfigPanel.svelte";
  import DebugPanel from "./debug/DebugPanel.svelte";
  import EditorOverlay from "./EditorOverlay.svelte";
  import DockviewLayout from "./DockviewLayout.svelte";
  import { ShaderLocker } from "../ShaderLocker";
  import { RenderingEngine } from "../../../../rendering/src/RenderingEngine";
  import { PixelInspectorManager } from "../PixelInspectorManager";
  import type { PixelInspectorState } from "../types/PixelInspectorState";
  import { ShaderDebugManager } from "../ShaderDebugManager";
  import type { ShaderDebugState } from "../types/ShaderDebugState";
  import { VariableCaptureManager } from "../VariableCaptureManager";
  import type { RefreshMode } from "../VariableCaptureManager";
  import { configPanelStore } from "../stores/configPanelStore";
  import { debugPanelStore } from "../stores/debugPanelStore";
  import { editorOverlayStore } from "../stores/editorOverlayStore";
  import type { ShaderConfig } from "@shader-studio/types";

  export let onInitialized: (data: {
    shaderStudio: ShaderStudio;
  }) => void = () => {};

  let glCanvas: HTMLCanvasElement;
  let initialized = false;
  let isLocked = false;
  let isInWindow = false;
  let isWebServerRunning = false;
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

  let shaderStudio: ShaderStudio;
  let renderingEngine: RenderingEngine;
  let transport: Transport = createTransport();
  let timeManager: any = null;
  let pixelInspectorManager: PixelInspectorManager | undefined;
  let debugInspectorEnabled = true; // remember inspector preference across debug sessions
  let shaderDebugManager: ShaderDebugManager | undefined;
  let variableCaptureManager: VariableCaptureManager | undefined;
  let sampleSize = 32;
  let gridRefreshMode: RefreshMode = 'polling';
  let gridPollingMs = 500;
  let pixelRefreshMode: RefreshMode = 'polling';
  let pixelPollingMs = 500;
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

  // Config panel state
  let configPanelVisible = false;
  let currentConfig: ShaderConfig | null = null;
  let pathMap: Record<string, string> = {};
  let bufferPathMap: Record<string, string> = {};
  let shaderPath: string = "";

  // Debug panel state
  let debugPanelVisible = true;

  $: showDebugPanel = debugState.isEnabled && debugPanelVisible;

  // Extract specific debug state fields so that capturedVariables changes
  // don't re-trigger the capture loop (Svelte tracks the whole object reference).
  $: varInspectorEnabled = debugState.isVariableInspectorEnabled;
  $: debugCurrentLine = debugState.currentLine;

  // Extract inspectorState fields as stable primitives.
  // inspectorState is reassigned every frame by the pixel inspector (pixel RGB re-reads),
  // which would cascade into every component that reads it. Primitives use !== so
  // unchanged booleans/numbers won't trigger downstream re-renders.
  $: inspectorEnabled = inspectorState.isEnabled;
  $: inspectorActive = inspectorState.isActive;
  $: inspectorLocked = inspectorState.isLocked;
  $: inspectorCanvasX = inspectorState.canvasPosition?.x ?? null;
  $: inspectorCanvasY = inspectorState.canvasPosition?.y ?? null;

  // Derive whether we're currently in pixel capture mode (need actual position)
  $: hasPixelCapture = (inspectorActive || inspectorLocked) && (inspectorCanvasX !== null);
  $: activeRefreshMode = hasPixelCapture ? pixelRefreshMode : gridRefreshMode;
  $: activePollingMs = hasPixelCapture ? pixelPollingMs : gridPollingMs;

  // Stable pixel coordinates for the capture reactive block
  $: capturePixelX = hasPixelCapture ? inspectorCanvasX : null;
  $: capturePixelY = hasPixelCapture ? inspectorCanvasY : null;

  // Reactive: notify variable capture manager when relevant state changes.
  // Only depends on stable primitives — NOT on inspectorState directly.
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
      sampleSize,
      refreshMode: activeRefreshMode,
      pollingMs: activePollingMs,
    });
  }

  // Editor overlay state
  let editorOverlayVisible = false;
  let editorVimMode = false;
  let currentShaderCode: string = "";

  // Editor file tracking (which file the overlay is editing)
  let editorBufferName: string = "Image";
  let editorFilePath: string = "";
  let editorFileCode: string = "";

  // Derive available buffer names from config
  $: editorBufferNames = (() => {
    const names = ["Image"];
    if (currentConfig?.passes) {
      for (const name of Object.keys(currentConfig.passes)) {
        if (name !== "Image") {
          names.push(name);
        }
      }
    }
    return names;
  })();

  // Subscribe to stores
  onMount(() => {
    const unsubConfig = configPanelStore.subscribe((state) => {
      configPanelVisible = state.isVisible;
    });
    const unsubDebug = debugPanelStore.subscribe((state) => {
      debugPanelVisible = state.isVisible;
    });
    return () => {
      unsubConfig();
      unsubDebug();
    };
  });

  // Subscribe to editor overlay store
  onMount(() => {
    const unsubscribe = editorOverlayStore.subscribe((state) => {
      editorOverlayVisible = state.isVisible;
      editorVimMode = state.vimMode;
    });
    return unsubscribe;
  });

  async function handleCanvasReady(canvas: HTMLCanvasElement) {
    glCanvas = canvas;
    await initializeApp();
  }

  function handleCanvasResize(data: { width: number; height: number }) {
    if (!initialized) return;
    const { width, height } = data;
    canvasWidth = Math.round(width);
    canvasHeight = Math.round(height);
    renderingEngine.handleCanvasResize(width, height);
  }

  function handleReset() {
    if (!initialized) return;
    shaderStudio.handleReset(() => {
      const lastEvent = shaderStudio!.getLastShaderEvent();
      if (lastEvent) {
        handleShaderMessage(lastEvent);
      }
    });
  }

  function handleRefresh() {
    if (!initialized) return;
    shaderStudio.handleRefresh();
  }

  function handleConfig() {
    if (!initialized) return;
    
    // Get the current shader path from the last shader event
    const lastEvent = shaderStudio.getLastShaderEvent();
    const shaderPath = lastEvent?.data?.path;
    
    if (!shaderPath) {
      // If no shader path, just request config generation (will fall back to last viewed)
      transport.postMessage({ 
        type: 'generateConfig', 
        payload: {} 
      });
      return;
    }
    
    // Check if config file exists by trying to fetch it
    const configPath = shaderPath.replace(/\.glsl$/, '.sha.json');
    
    // Send a message to either show existing config or generate new one
    transport.postMessage({ 
      type: 'showConfig', 
      payload: { 
        shaderPath: configPath 
      } 
    });
  }

  function handleTogglePause() {
    if (!initialized) return;
    renderingEngine.togglePause();
    // Don't stop the render loop when paused - keep rendering so scrubbing works
    // The TimeManager handles not advancing time when paused
  }

  function handleToggleLock() {
    if (!initialized) return;
    shaderStudio.handleToggleLock();
    isLocked = shaderStudio.getIsLocked();
  }

  function handleAspectRatioChange(mode: AspectRatioMode) {
    console.log('Aspect ratio changed to:', mode);
  }

  function handleQualityChange(mode: QualityMode) {
    console.log('Quality changed to:', mode);
  }

  function handleZoomChange(zoom: number) {
    zoomLevel = zoom;
  }

  function handleToggleInspectorEnabled() {
    if (!pixelInspectorManager) return;
    // Don't allow enabling inspector when debug is off
    if (!pixelInspectorManager.getState().isEnabled && !shaderDebugManager?.getState().isEnabled) return;
    pixelInspectorManager.toggleEnabled();
    debugInspectorEnabled = pixelInspectorManager.getState().isEnabled;
  }

  function handleToggleDebugEnabled() {
    if (!shaderDebugManager || !initialized || !hasShader) return;
    shaderDebugManager.toggleEnabled();

    // Send debug mode state to extension
    const debugState = shaderDebugManager.getState();
    transport.postMessage({
      type: 'debugModeState',
      payload: {
        enabled: debugState.isEnabled
      }
    });

    // Restore inspector preference when debug turns on, save & disable when debug turns off
    if (pixelInspectorManager) {
      if (debugState.isEnabled) {
        pixelInspectorManager.setEnabled(debugInspectorEnabled);
      } else {
        debugInspectorEnabled = pixelInspectorManager.getState().isEnabled;
        pixelInspectorManager.setEnabled(false);
      }
    }

    // Trigger recompile to immediately show/hide debug visualization
    shaderStudio.triggerDebugRecompile();
  }

  function handleToggleConfigPanel() {
    if (!hasShader) return;
    configPanelStore.toggle();
  }

  function handleToggleEditorOverlay() {
    editorOverlayStore.toggle();
  }

  function handleToggleVimMode() {
    editorOverlayStore.toggleVimMode();
  }

  function handleFork() {
    if (!initialized) return;
    transport.postMessage({
      type: 'forkShader',
      payload: { shaderPath }
    });
  }

  function handleExtensionCommand(command: string) {
    if (!initialized) return;
    transport.postMessage({
      type: 'extensionCommand',
      payload: { command }
    });
    if (command === 'moveToNewWindow') {
      isInWindow = true;
    }
  }

  function handleConfigFileSelect(bufferName: string) {
    if (!initialized) return;
    editorBufferName = bufferName;

    if (bufferName === "Image") {
      // Switch back to the main shader file
      editorFilePath = shaderPath;
      editorFileCode = currentShaderCode;
    } else {
      // Request the buffer file contents from the extension
      transport.postMessage({
        type: 'requestFileContents',
        payload: {
          bufferName,
          shaderPath,
        },
      });
    }
  }

  async function handleEditorCodeChange(code: string) {
    if (!initialized) return;
    // Update editor-local state
    editorFileCode = code;

    if (editorBufferName === "Image") {
      // Main shader file: also update currentShaderCode and do direct recompile
      currentShaderCode = code;
      const lastEvent = shaderStudio.getLastShaderEvent();
      if (lastEvent) {
        const syntheticEvent = new MessageEvent('message', {
          data: {
            ...lastEvent.data,
            code,
          },
        });
        handleShaderMessage(syntheticEvent);
      }
    } else {
      // Buffer file: directly update the buffer and recompile the pipeline
      const result = await renderingEngine.updateBufferAndRecompile(editorBufferName, code);
      if (result) {
        if (result.success) {
          errors = [];
          renderingEngine.startRenderLoop();
        } else {
          errors = result.errors ? result.errors : [];
        }
      }
    }
  }

  function handleParameterChange(index: number, value: string) {
    if (!shaderDebugManager) return;
    shaderDebugManager.setCustomParameter(index, value);
    shaderStudio.triggerDebugRecompile();
    notifyVariableCaptureManager();
  }

  function handleLoopMaxIterChange(loopIndex: number, maxIter: number | null) {
    if (!shaderDebugManager) return;
    shaderDebugManager.setLoopMaxIterations(loopIndex, maxIter);
    shaderStudio.triggerDebugRecompile();
    notifyVariableCaptureManager();
  }

  function handleToggleLineLock() {
    if (!shaderDebugManager) return;
    shaderDebugManager.toggleLineLock();
  }

  function handleToggleInlineRendering() {
    if (!shaderDebugManager) return;
    shaderDebugManager.toggleInlineRendering();
    shaderStudio.triggerDebugRecompile();
  }

  function handleCycleNormalize() {
    if (!shaderDebugManager) return;
    shaderDebugManager.cycleNormalizeMode();
    shaderStudio.triggerDebugRecompile();
  }

  function handleToggleStep() {
    if (!shaderDebugManager) return;
    shaderDebugManager.toggleStep();
    shaderStudio.triggerDebugRecompile();
  }

  function handleSetStepEdge(edge: number) {
    if (!shaderDebugManager) return;
    shaderDebugManager.setStepEdge(edge);
    shaderStudio.triggerDebugRecompile();
  }

  function handleToggleVariableInspector() {
    if (!shaderDebugManager) return;
    shaderDebugManager.toggleVariableInspector();
    notifyVariableCaptureManager();
  }

  function handleExpandVarHistogram(varName: string) {
    if (!variableCaptureManager) return;
    const vars = debugState.capturedVariables;
    const v = vars.find(c => c.varName === varName);
    const isExpanded = v?.histogram !== null || v?.channelHistograms !== null || v?.colorFrequencies !== null;
    variableCaptureManager.setHistogramExpanded(varName, !isExpanded);
    notifyVariableCaptureManager();
  }

  function handleChangeSampleSize(size: number) {
    sampleSize = size;
    notifyVariableCaptureManager();
  }

  function handleChangeRefreshMode(mode: RefreshMode) {
    if (hasPixelCapture) {
      pixelRefreshMode = mode;
    } else {
      gridRefreshMode = mode;
    }
    notifyVariableCaptureManager();
  }

  function handleChangePollingMs(ms: number) {
    if (hasPixelCapture) {
      pixelPollingMs = ms;
    } else {
      gridPollingMs = ms;
    }
    notifyVariableCaptureManager();
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
      sampleSize,
      refreshMode: hasPixelCapture ? pixelRefreshMode : gridRefreshMode,
      pollingMs: hasPixelCapture ? pixelPollingMs : gridPollingMs,
    });
  }

  function getUniforms() {
    if (!initialized || !shaderStudio) return null;
    return renderingEngine.getUniforms();
  }

  function handleCanvasClick() {
    if (!pixelInspectorManager) return;
    pixelInspectorManager.handleCanvasClick();
  }

  function handleCanvasMouseMove(event: MouseEvent) {
    if (!pixelInspectorManager || !initialized) return;
    pixelInspectorManager.handleMouseMove(event);
  }

  function handleErrorDismiss() {
    errors = [];
  }

  async function initializeApp() {
    try {
      const shadderLocker = new ShaderLocker();
      renderingEngine = new RenderingEngine();

      // Initialize shader debug manager
      shaderDebugManager = new ShaderDebugManager();
      shaderDebugManager.setStateCallback((state) => {
        debugState = state;
      });

      shaderStudio = new ShaderStudio(
        transport,
        shadderLocker,
        renderingEngine,
        shaderDebugManager
      );

      const success = await shaderStudio.initialize(glCanvas);
      if (!success) {
        addError("Failed to initialize ShaderStudio");
        return;
      }

      transport.onMessage(handleShaderMessage);
      // Also handle cursor position messages
      transport.onMessage((event: MessageEvent) => {
        if (event.data.type === 'cursorPosition' && shaderStudio) {
          const messageHandler = (shaderStudio as any).messageHandler;
          if (messageHandler) {
            messageHandler.handleCursorPositionMessage(event.data);
          }
        }
      });

      timeManager = renderingEngine.getTimeManager();

      // Initialize pixel inspector manager
      pixelInspectorManager = new PixelInspectorManager((state) => {
        inspectorState = state;
      });
      pixelInspectorManager.initialize(
        renderingEngine,
        timeManager,
        glCanvas
      );

      // Initialize variable capture manager
      variableCaptureManager = new VariableCaptureManager(renderingEngine, (vars) => {
        shaderDebugManager?.setCapturedVariables(vars);
      });

      // Start paused until a shader is loaded
      renderingEngine.togglePause();

      initialized = true;

      onInitialized({ shaderStudio });
    } catch (err) {
      addError(`Initialization failed: ${err}`);
    }
  }

  async function handleShaderMessage(event: MessageEvent) {
    if (!initialized) return;

    try {
      // Handle error messages from the extension directly in the UI
      if (event.data.type === 'error') {
        const payload = event.data.payload;
        errors = Array.isArray(payload) ? payload : [payload];
        return;
      }

      // Handle file contents response for editor overlay
      if (event.data.type === 'fileContents') {
        editorFilePath = event.data.payload.path || "";
        editorFileCode = event.data.payload.code || "";
        return;
      }

      // Extract config and pathMap from shader source messages
      // When locked, only accept config from the locked shader's path
      if (event.data.type === 'shaderSource') {
        const locked = shaderStudio.getIsLocked();
        const lockedPath = shaderStudio.getLockedShaderPath();
        if (!locked || lockedPath === event.data.path) {
          // Unpause on first shader load
          const isFirstShader = !hasShader && event.data.path;
          currentConfig = event.data.config || null;
          pathMap = event.data.pathMap || {};
          bufferPathMap = event.data.bufferPathMap || {};
          shaderPath = event.data.path || "";
          currentShaderCode = event.data.code || "";
          if (shaderPath) {
            hasShader = true;
          }
          if (isFirstShader && renderingEngine.getTimeManager().isPaused()) {
            renderingEngine.togglePause();
          }
          // Sync editor overlay if it's showing the main shader
          if (editorBufferName === "Image") {
            editorFilePath = shaderPath;
            editorFileCode = currentShaderCode;
          }
        }
      }

      // Handle toggle editor overlay message from extension
      if (event.data.type === 'toggleEditorOverlay') {
        editorOverlayStore.toggle();
        return;
      }

      // Handle panel state (e.g. moved to new window)
      if (event.data.type === 'panelState') {
        if (event.data.payload?.isInWindow !== undefined) {
          isInWindow = event.data.payload.isInWindow;
        }
        return;
      }

      // Handle web server state
      if (event.data.type === 'webServerState') {
        if (event.data.payload?.isRunning !== undefined) {
          isWebServerRunning = event.data.payload.isRunning;
        }
        return;
      }

      if (event.data.type === 'resetLayout') {
        handleResetLayout();
        return;
      }

      const result = await shaderStudio.handleShaderMessage(event);

      // Update errors state based on compilation result
      if (result) {
        if (result.success) {
          errors = [];
        } else {
          errors = result.errors && result.errors.length > 0 ? result.errors : [];
        }
      }

      // Update the UI lock state to reflect the current state
      isLocked = shaderStudio.getIsLocked();
    } catch (err) {
      const errorMsg = `Shader message handling failed: ${err}`;
      console.error("ShaderStudio: Error in handleShaderMessage:", err);
      console.error(
        "ShaderStudio: Error stack:",
        err instanceof Error ? err.stack : "No stack",
      );
      console.error("ShaderStudio: Event data:", event.data);
      addError(errorMsg);
    }
  }

  function addError(message: string) {
    errors = [...errors, message];
    if (transport) {
      transport.postMessage({ type: "error", payload: [message] });
    }
  }

  onMount(() => {
    const fpsInterval = setInterval(() => {
      if (initialized && shaderStudio) {
        currentFPS = renderingEngine.getCurrentFPS();
      }
    }, 100);

    return () => clearInterval(fpsInterval);
  });

  // Dockview functions, set when DockviewLayout is ready
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
    // User closed the debug tab — disable debug mode
    if (shaderDebugManager && debugState.isEnabled) {
      handleToggleDebugEnabled();
    }
  }

  function handleConfigClosed() {
    // User closed the config tab — disable config panel
    configPanelStore.setVisible(false);
  }

  // DOM teleport refs — these elements are rendered in our template (so Svelte manages reactivity)
  // and then moved into dockview containers by the DockviewLayout component
  let previewEl: HTMLElement;
  let debugEl: HTMLElement;
  let configEl: HTMLElement;

  function mountPreview(container: HTMLElement): () => void {
    if (previewEl) {
      container.appendChild(previewEl);
    }
    return () => {
      // Move element back to avoid it being destroyed by dockview
      if (previewEl && previewEl.parentNode === container) {
        container.removeChild(previewEl);
      }
    };
  }

  function mountDebug(container: HTMLElement): () => void {
    if (debugEl) {
      container.appendChild(debugEl);
    }
    return () => {
      if (debugEl && debugEl.parentNode === container) {
        container.removeChild(debugEl);
      }
    };
  }

  function mountConfig(container: HTMLElement): () => void {
    if (configEl) {
      container.appendChild(configEl);
    }
    return () => {
      if (configEl && configEl.parentNode === container) {
        container.removeChild(configEl);
      }
    };
  }

  onDestroy(() => {
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

<div class="main-container" role="application" on:mousemove={handleCanvasMouseMove}>
  <!-- Panel content rendered declaratively for Svelte reactivity, then teleported into dockview containers -->
  <div class="dockview-panel-source" bind:this={previewEl}>
    <ShaderCanvas
      {zoomLevel}
      isInspectorActive={inspectorActive}
      onCanvasReady={handleCanvasReady}
      onCanvasResize={handleCanvasResize}
      onCanvasClick={handleCanvasClick}
    />
    {#if initialized}
      <EditorOverlay
        isVisible={editorOverlayVisible}
        shaderCode={editorFileCode}
        shaderPath={editorFilePath}
        {transport}
        onCodeChange={handleEditorCodeChange}
        vimMode={editorVimMode}
        bufferNames={editorBufferNames}
        activeBufferName={editorBufferName}
        onBufferSwitch={handleConfigFileSelect}
        {errors}
      />
    {/if}
    {#if initialized && previewAlone && previewVisible}
      <MenuBar
        {timeManager}
        {currentFPS}
        {canvasWidth}
        {canvasHeight}
        {isLocked}
        {errors}
        canvasElement={glCanvas}
        onReset={handleReset}
        onRefresh={handleRefresh}
        onTogglePause={handleTogglePause}
        onToggleLock={handleToggleLock}
        onAspectRatioChange={handleAspectRatioChange}
        onQualityChange={handleQualityChange}
        onZoomChange={handleZoomChange}
        onConfig={handleConfig}
        isDebugEnabled={debugState.isEnabled}
        onToggleDebugEnabled={handleToggleDebugEnabled}
        {debugState}
        isConfigPanelVisible={configPanelVisible}
        onToggleConfigPanel={handleToggleConfigPanel}
        isEditorOverlayVisible={editorOverlayVisible}
        onToggleEditorOverlay={handleToggleEditorOverlay}
        isVimModeEnabled={editorVimMode}
        onToggleVimMode={handleToggleVimMode}
        onFork={handleFork}
        onExtensionCommand={handleExtensionCommand}
        {isInWindow}
        {isWebServerRunning}
        {hasShader}
        onResetLayout={handleResetLayout}
        {previewVisible}
        onShowPreview={handleShowPreview}
      />
    {/if}
  </div>
  <div class="dockview-panel-source" bind:this={debugEl}>
    {#if showDebugPanel}
      <DebugPanel
        {debugState}
        {getUniforms}
        isInspectorEnabled={inspectorEnabled}
        isInspectorActive={inspectorActive}
        isInspectorLocked={inspectorLocked}
        onParameterChange={handleParameterChange}
        onLoopMaxIterChange={handleLoopMaxIterChange}
        onToggleLineLock={handleToggleLineLock}
        onToggleInspectorEnabled={handleToggleInspectorEnabled}
        onToggleInlineRendering={handleToggleInlineRendering}
        onCycleNormalize={handleCycleNormalize}
        onToggleStep={handleToggleStep}
        onSetStepEdge={handleSetStepEdge}
        onToggleVariableInspector={handleToggleVariableInspector}
        onExpandVarHistogram={handleExpandVarHistogram}
        {sampleSize}
        onChangeSampleSize={handleChangeSampleSize}
        refreshMode={activeRefreshMode}
        pollingMs={activePollingMs}
        onChangeRefreshMode={handleChangeRefreshMode}
        onChangePollingMs={handleChangePollingMs}
        hasPixelSelected={hasPixelCapture}
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
        onFileSelect={handleConfigFileSelect}
        selectedBuffer={editorBufferName}
        isLocked={isLocked}
      />
    {/if}
  </div>

  <DockviewLayout
    {mountPreview}
    {mountDebug}
    {mountConfig}
    {showDebugPanel}
    showConfigPanel={configPanelVisible}
    {transport}
    on:ready={handleDockviewReady}
    on:previewVisibleChange={handlePreviewVisibleChange}
    on:previewAloneChange={handlePreviewAloneChange}
    on:debugClosed={handleDebugClosed}
    on:configClosed={handleConfigClosed}
  />
  {#if initialized && !(previewAlone && previewVisible)}
    <MenuBar
      {timeManager}
      {currentFPS}
      {canvasWidth}
      {canvasHeight}
      {isLocked}
      {errors}
      canvasElement={glCanvas}
      onReset={handleReset}
      onRefresh={handleRefresh}
      onTogglePause={handleTogglePause}
      onToggleLock={handleToggleLock}
      onAspectRatioChange={handleAspectRatioChange}
      onQualityChange={handleQualityChange}
      onZoomChange={handleZoomChange}
      onConfig={handleConfig}
      isDebugEnabled={debugState.isEnabled}
      onToggleDebugEnabled={handleToggleDebugEnabled}
      {debugState}
      isConfigPanelVisible={configPanelVisible}
      onToggleConfigPanel={handleToggleConfigPanel}
      isEditorOverlayVisible={editorOverlayVisible}
      onToggleEditorOverlay={handleToggleEditorOverlay}
      isVimModeEnabled={editorVimMode}
      onToggleVimMode={handleToggleVimMode}
      onFork={handleFork}
      onExtensionCommand={handleExtensionCommand}
      {isInWindow}
      {isWebServerRunning}
      {hasShader}
      onResetLayout={handleResetLayout}
      {previewVisible}
      onShowPreview={handleShowPreview}
    />
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
  /* Panel source elements are hidden when not yet teleported into dockview.
     Once moved into a dockview panel container, the parent provides sizing. */
  .dockview-panel-source {
    position: absolute;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
