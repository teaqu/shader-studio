<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Shadera } from "../shadera";
  import { createTransport } from "../transport/TransportFactory";
  import type { Transport } from "../transport/MessageTransport";
  import type { AspectRatioMode } from "../stores/aspectRatioStore";
  import type { QualityMode } from "../stores/qualityStore";
  import ShaderCanvas from "./ShaderCanvas.svelte";
  import MenuBar from "./MenuBar.svelte";
  import ErrorDisplay from "./ErrorDisplay.svelte";

  export let onInitialized: (data: {
    shadera: Shadera;
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

 let shadera: Shadera;
  let transport: Transport;
  let timeManager: any = null;
  let keyboardManager: any = null;
  let mouseManager: any = null;

  async function handleCanvasReady(canvas: HTMLCanvasElement) {
    glCanvas = canvas;
    await initializeApp();
  }

  function handleCanvasResize(data: { width: number; height: number }) {
    if (!initialized) return;
    const { width, height } = data;
    canvasWidth = Math.round(width);
    canvasHeight = Math.round(height);
    shadera!.handleCanvasResize(width, height);
  }

  function handleReset() {
    if (!initialized) return;
    shadera.handleReset(() => {
      const lastEvent = shadera!.getLastShaderEvent();
      if (lastEvent) {
        handleShaderMessage(lastEvent);
      }
    });
  }

  function handleRefresh() {
    if (!initialized) return;
    shadera.handleRefresh();
  }

  function handleTogglePause() {
    if (!initialized) return;
    shadera.handleTogglePause();
  }

  function handleToggleLock() {
    if (!initialized) return;
    shadera.handleToggleLock();
    isLocked = shadera.getIsLocked();
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

      shadera = new Shadera(transport);

      const success = await shadera.initialize(glCanvas);
      if (!success) {
        addError("Failed to initialize Shadera");
        return;
      }

      transport.onMessage(handleShaderMessage);

      timeManager = shadera.getTimeManager();
      keyboardManager = shadera.getKeyboardManager();
      mouseManager = shadera.getMouseManager();

      initialized = true;

      onInitialized({ shadera });
    } catch (err) {
      addError(`Initialization failed: ${err}`);
    }
  }

  async function handleShaderMessage(event: MessageEvent) {
    if (!initialized) return;

    try {
      await shadera.handleShaderMessage(event);
      // Update the UI lock state to reflect the current state
      isLocked = shadera.getIsLocked();
    } catch (err) {
      const errorMsg = `Shader message handling failed: ${err}`;
      console.error("Shaderaer: Error in handleShaderMessage:", err);
      console.error(
        "Shaderaer: Error stack:",
        err instanceof Error ? err.stack : "No stack",
      );
      console.error("Shaderaer: Event data:", event.data);
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
      if (initialized && Shadera) {
        currentFPS = shadera.getCurrentFPS();
      }
    }, 100);

    return () => clearInterval(fpsInterval);
  });

  onDestroy(() => {
    if (shadera) {
      shadera.dispose();
    }
    if (transport) {
      transport.dispose();
    }
  });
</script>

<div class="main-container">
  <ShaderCanvas
    {keyboardManager}
    {mouseManager}
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
    />
  {/if}
  <ErrorDisplay
    {errors}
    isVisible={showErrors}
    onDismiss={handleErrorDismiss}
  />
</div>
