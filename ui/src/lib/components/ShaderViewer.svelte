<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { ShaderView } from "../ShaderView";
  import { createTransport } from "../transport/TransportFactory";
  import type { Transport } from "../transport/MessageTransport";
  import type { AspectRatioMode } from "../stores/aspectRatioStore";
  import type { QualityMode } from "../stores/qualityStore";
  import ShaderCanvas from "./ShaderCanvas.svelte";
  import MenuBar from "./MenuBar.svelte";
  import ErrorDisplay from "./ErrorDisplay.svelte";

  export let onInitialized: (data: {
    shaderView: ShaderView;
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

  let shaderView: ShaderView;
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
    shaderView!.handleCanvasResize(width, height);
  }

  function handleReset() {
    if (!initialized) return;
    shaderView.handleReset(() => {
      const lastEvent = shaderView!.getLastShaderEvent();
      if (lastEvent) {
        handleShaderMessage(lastEvent);
      }
    });
  }

  function handleTogglePause() {
    if (!initialized) return;
    shaderView.handleTogglePause();
  }

  function handleToggleLock() {
    if (!initialized) return;
    shaderView.handleToggleLock();
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

      shaderView = new ShaderView(transport);

      const success = await shaderView.initialize(glCanvas);
      if (!success) {
        addError("Failed to initialize shader view");
        return;
      }

      transport.onMessage(handleShaderMessage);

      timeManager = shaderView.getTimeManager();
      keyboardManager = shaderView.getKeyboardManager();
      mouseManager = shaderView.getMouseManager();

      initialized = true;

      onInitialized({ shaderView });
    } catch (err) {
      addError(`Initialization failed: ${err}`);
    }
  }

  async function handleShaderMessage(event: MessageEvent) {
    if (!initialized) return;

    try {
      await shaderView.handleShaderMessage(event, (locked) => {
        isLocked = locked;
      });
    } catch (err) {
      const errorMsg = `Shader message handling failed: ${err}`;
      console.error("ShaderViewer: Error in handleShaderMessage:", err);
      console.error(
        "ShaderViewer: Error stack:",
        err instanceof Error ? err.stack : "No stack",
      );
      console.error("ShaderViewer: Event data:", event.data);
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
      if (initialized && shaderView) {
        currentFPS = shaderView.getCurrentFPS();
      }
    }, 100);

    return () => clearInterval(fpsInterval);
  });

  onDestroy(() => {
    if (shaderView) {
      shaderView.dispose();
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
