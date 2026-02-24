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
  import ResizeHandle from "./ResizeHandle.svelte";
  import { ShaderLocker } from "../ShaderLocker";
  import { RenderingEngine } from "../../../../rendering/src/RenderingEngine";
  import { PixelInspectorManager } from "../PixelInspectorManager";
  import type { PixelInspectorState } from "../types/PixelInspectorState";
  import { ShaderDebugManager } from "../ShaderDebugManager";
  import type { ShaderDebugState } from "../types/ShaderDebugState";
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
  let transport: Transport;
  let timeManager: any = null;
  let pixelInspectorManager: PixelInspectorManager | undefined;
  let debugInspectorEnabled = true; // remember inspector preference across debug sessions
  let shaderDebugManager: ShaderDebugManager | undefined;
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
  };

  // Config panel state
  let configPanelVisible = false;
  let splitRatio = 0.6;
  let currentConfig: ShaderConfig | null = null;
  let pathMap: Record<string, string> = {};
  let bufferPathMap: Record<string, string> = {};
  let shaderPath: string = "";

  // Debug panel state
  let debugPanelVisible = true;
  let debugSplitRatio = 0.7;

  $: showDebugPanel = debugState.isEnabled && debugPanelVisible;
  $: hasSidePanel = configPanelVisible || showDebugPanel;
  $: canvasFlex = hasSidePanel ? (showDebugPanel ? debugSplitRatio : splitRatio) : 1;

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
      if (currentConfig.passes.common) names.push("common");
      for (const name of ["BufferA", "BufferB", "BufferC", "BufferD"]) {
        if (currentConfig.passes[name as keyof typeof currentConfig.passes]) {
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
      splitRatio = state.splitRatio;
    });
    const unsubDebug = debugPanelStore.subscribe((state) => {
      debugPanelVisible = state.isVisible;
      debugSplitRatio = state.splitRatio;
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
    shaderStudio!.handleCanvasResize(width, height);
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
    shaderStudio.handleTogglePause();
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
    if (!shaderDebugManager || !initialized) return;
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
    configPanelStore.toggle();
  }

  function handleToggleEditorOverlay() {
    editorOverlayStore.toggle();
  }

  function handleToggleVimMode() {
    editorOverlayStore.toggleVimMode();
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
      const renderingEngine = shaderStudio.getRenderingEngine();
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

  function handleSplitResize(ratio: number) {
    configPanelStore.setSplitRatio(ratio);
  }

  function handleDebugSplitResize(ratio: number) {
    debugPanelStore.setSplitRatio(ratio);
  }

  function handleParameterChange(index: number, value: string) {
    if (!shaderDebugManager) return;
    shaderDebugManager.setCustomParameter(index, value);
    shaderStudio.triggerDebugRecompile();
  }

  function handleLoopMaxIterChange(loopIndex: number, maxIter: number | null) {
    if (!shaderDebugManager) return;
    shaderDebugManager.setLoopMaxIterations(loopIndex, maxIter);
    shaderStudio.triggerDebugRecompile();
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

  function getUniforms() {
    if (!initialized || !shaderStudio) return null;
    return shaderStudio.getUniforms();
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
      transport = createTransport();
      const shadderLocker = new ShaderLocker();
      const renderingEngine = new RenderingEngine();

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

      timeManager = shaderStudio.getTimeManager();

      // Initialize pixel inspector manager
      pixelInspectorManager = new PixelInspectorManager((state) => {
        inspectorState = state;
      });
      pixelInspectorManager.initialize(
        shaderStudio.getRenderingEngine(),
        timeManager,
        glCanvas
      );

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
          currentConfig = event.data.config || null;
          pathMap = event.data.pathMap || {};
          bufferPathMap = event.data.bufferPathMap || {};
          shaderPath = event.data.path || "";
          currentShaderCode = event.data.code || "";
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
        currentFPS = shaderStudio.getCurrentFPS();
      }
    }, 100);

    return () => clearInterval(fpsInterval);
  });

  onDestroy(() => {
    if (pixelInspectorManager) {
      pixelInspectorManager.dispose();
    }
    if (shaderStudio) {
      shaderStudio.dispose();
    }
    if (transport) {
      transport.dispose();
    }
  });
</script>

<div class="main-container" role="application" on:mousemove={handleCanvasMouseMove}>
  <div class="canvas-section" style="flex: {canvasFlex}">
    <ShaderCanvas
      {zoomLevel}
      isInspectorActive={inspectorState.isActive}
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
  </div>
  {#if initialized}
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
    />
  {/if}
  {#if showDebugPanel}
    <ResizeHandle onResize={handleDebugSplitResize} />
    <div class="debug-section" style="flex: {1 - debugSplitRatio}">
      <DebugPanel
        {debugState}
        {getUniforms}
        isInspectorEnabled={inspectorState.isEnabled}
        onParameterChange={handleParameterChange}
        onLoopMaxIterChange={handleLoopMaxIterChange}
        onToggleLineLock={handleToggleLineLock}
        onToggleInspectorEnabled={handleToggleInspectorEnabled}
        onToggleInlineRendering={handleToggleInlineRendering}
        onCycleNormalize={handleCycleNormalize}
        onToggleStep={handleToggleStep}
        onSetStepEdge={handleSetStepEdge}
      />
    </div>
  {/if}
  {#if configPanelVisible}
    <ResizeHandle onResize={handleSplitResize} />
    <div class="config-section" style="flex: {1 - splitRatio}">
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
    </div>
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
