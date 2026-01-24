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

  async function handleShaderMessage(event: MessageEvent) {
    if (!initialized) return;

    try {
      await shaderStudio.handleShaderMessage(event);
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

<div class="main-container">
  <ShaderCanvas
    {zoomLevel}
    onCanvasReady={handleCanvasReady}
    onCanvasResize={handleCanvasResize}
  />
  {#if initialized}
    <MenuBar
      {timeManager}
      {currentFPS}
      {canvasWidth}
      {canvasHeight}
      {isLocked}
      canvasElement={glCanvas}
      onReset={handleReset}
      onRefresh={handleRefresh}
      onTogglePause={handleTogglePause}
      onToggleLock={handleToggleLock}
      onAspectRatioChange={handleAspectRatioChange}
      onQualityChange={handleQualityChange}
      onZoomChange={handleZoomChange}
      onConfig={handleConfig}
    />
  {/if}
  <ErrorDisplay
    {errors}
    isVisible={showErrors}
    onDismiss={handleErrorDismiss}
  />
</div>
