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
  import { ShaderLocker } from "../ShaderLocker";
  import { RenderingEngine } from "../../../../rendering/src/RenderingEngine";

  export let onInitialized: (data: {
    shaderStudio: ShaderStudio;
  }) => void = () => {};

  let glCanvas: HTMLCanvasElement;
  let initialized = false;
  let isLocked = false;
  let errors: string[] = [];
  let showErrors = false;
  let currentFPS = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let zoomLevel = 1.0;
  let isInspectorActive = false;
  let isInspectorLocked = false;
  let mouseX = 0;
  let mouseY = 0;
  let pixelRGB: { r: number; g: number; b: number } | null = null;
  let fragCoord: { x: number; y: number } | null = null;

 let shaderStudio: ShaderStudio;
  let transport: Transport;
  let timeManager: any = null;

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

  function handleToggleInspector() {
    isInspectorActive = !isInspectorActive;
    if (isInspectorActive) {
      // Stop the render loop and pause time when inspector is activated
      if (initialized && shaderStudio) {
        shaderStudio.getRenderingEngine().stopRenderLoop();
        const timeManager = shaderStudio.getTimeManager();
        if (!timeManager.isPaused()) {
          shaderStudio.handleTogglePause();
        }
      }
    } else {
      // Resume time and restart render loop when inspector is deactivated
      if (initialized && shaderStudio) {
        const timeManager = shaderStudio.getTimeManager();
        if (timeManager.isPaused()) {
          shaderStudio.handleTogglePause();
        }
        shaderStudio.getRenderingEngine().startRenderLoop();
      }
      // Clear pixel data when inspector is deactivated
      isInspectorLocked = false;
      pixelRGB = null;
      fragCoord = null;
    }
  }

  function handleCanvasClick(event: MouseEvent) {
    if (!isInspectorActive) return;
    
    // Toggle inspector lock state
    isInspectorLocked = !isInspectorLocked;
    
    // If we just locked, update the pixel data one more time
    if (isInspectorLocked) {
      handleCanvasMouseMove(event);
    }
  }

  function handleCanvasMouseMove(event: MouseEvent) {
    if (!isInspectorActive || !initialized || !glCanvas || isInspectorLocked) {
      return;
    }

    // Get mouse position relative to the viewport
    mouseX = event.clientX;
    mouseY = event.clientY;

    // Get canvas bounding rect
    const rect = glCanvas.getBoundingClientRect();
    
    // Calculate position within canvas (accounting for canvas scaling)
    const canvasX = ((event.clientX - rect.left) / rect.width) * glCanvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * glCanvas.height;

    // Check if mouse is within canvas bounds
    if (canvasX >= 0 && canvasX < glCanvas.width && canvasY >= 0 && canvasY < glCanvas.height) {
      const renderEngine = shaderStudio.getRenderingEngine();
      
      // Force a single frame render (this sets running=true, renders, sets running=false)
      renderEngine.render();
      
      // Read pixel immediately after render
      const pixel = renderEngine.readPixel(
        Math.floor(canvasX),
        Math.floor(canvasY)
      );

      if (pixel) {
        pixelRGB = { r: pixel.r, g: pixel.g, b: pixel.b };
        fragCoord = { 
          x: canvasX, 
          y: glCanvas.height - canvasY
        };
      } else {
        pixelRGB = null;
        fragCoord = null;
      }
    } else {
      pixelRGB = null;
      fragCoord = null;
    }
  }

  function handleErrorDismiss() {
    showErrors = false;
    errors = [];
  }

  async function initializeApp() {
    try {
      transport = createTransport();
      const shadderLocker = new ShaderLocker();
      const renderingEngine = new RenderingEngine();

      shaderStudio = new ShaderStudio(transport, shadderLocker, renderingEngine);

      const success = await shaderStudio.initialize(glCanvas);
      if (!success) {
        addError("Failed to initialize ShaderStudio");
        return;
      }

      transport.onMessage(handleShaderMessage);

      timeManager = shaderStudio.getTimeManager();

      initialized = true;

      onInitialized({ shaderStudio });
    } catch (err) {
      addError(`Initialization failed: ${err}`);
    }
  }

  function handleShaderMessage(event: MessageEvent) {
    if (!initialized) return;

    try {
      shaderStudio.handleShaderMessage(event);
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
    showErrors = true;
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
    if (shaderStudio) {
      shaderStudio.dispose();
    }
    if (transport) {
      transport.dispose();
    }
  });
</script>

<div class="main-container" role="application" on:mousemove={handleCanvasMouseMove}>
  <ShaderCanvas
    {zoomLevel}
    {isInspectorActive}
    onCanvasReady={handleCanvasReady}
    onCanvasResize={handleCanvasResize}
    onCanvasClick={handleCanvasClick}
  />
  {#if initialized}
    <MenuBar
      {timeManager}
      {currentFPS}
      {canvasWidth}
      {canvasHeight}
      {isLocked}
      {isInspectorActive}
      canvasElement={glCanvas}
      onReset={handleReset}
      onRefresh={handleRefresh}
      onTogglePause={handleTogglePause}
      onToggleLock={handleToggleLock}
      onAspectRatioChange={handleAspectRatioChange}
      onQualityChange={handleQualityChange}
      onZoomChange={handleZoomChange}
      onConfig={handleConfig}
      onToggleInspector={handleToggleInspector}
    />
  {/if}
  <ErrorDisplay
    {errors}
    isVisible={showErrors}
    onDismiss={handleErrorDismiss}
  />
  <PixelInspector
    isActive={isInspectorActive}
    isLocked={isInspectorLocked}
    {mouseX}
    {mouseY}
    rgb={pixelRGB}
    {fragCoord}
    {canvasWidth}
    {canvasHeight}
  />
</div>
