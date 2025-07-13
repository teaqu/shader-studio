<script lang="ts">
  import { onMount } from "svelte";
  import { ShaderView } from "../core/ShaderView";
  import ShaderCanvas from "./ShaderCanvas.svelte";
  import MenuBar from "./MenuBar.svelte";
  import ErrorDisplay from "./ErrorDisplay.svelte";

  // Callback props instead of event dispatcher
  export let onInitialized: (data: {
    shaderView: ShaderView;
  }) => void = () => {};

  // --- Core State ---
  let glCanvas: HTMLCanvasElement;
  let initialized = false;
  let isLocked = false;
  let errors: string[] = [];
  let showErrors = false;
  let currentFPS = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;

  // --- Main Controller ---
  let shaderView: ShaderView;
  let timeManager: any = null;
  let inputManager: any = null;

  const vscode = acquireVsCodeApi();

  // --- Event Handlers ---
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

  function handleErrorDismiss() {
    showErrors = false;
    errors = [];
  }

  // --- Initialization ---
  async function initializeApp() {
    try {
      shaderView = new ShaderView(vscode);

      const success = await shaderView.initialize(glCanvas);
      if (!success) {
        addError("Failed to initialize shader view");
        return;
      }

      // Set up message listener
      window.addEventListener("message", handleShaderMessage);

      timeManager = shaderView.getTimeManager();
      inputManager = shaderView.getInputManager();

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
      addError(`Shader message handling failed: ${err}`);
    }
  }

  function addError(message: string) {
    errors = [...errors, message];
    showErrors = true;
    vscode.postMessage({ type: "error", payload: [message] });
  }

  // Reactive FPS update using onMount interval
  onMount(() => {
    const fpsInterval = setInterval(() => {
      if (initialized && shaderView) {
        currentFPS = shaderView.getCurrentFPS();
      }
    }, 100);

    return () => clearInterval(fpsInterval);
  });
</script>

<div class="main-container">
  <ShaderCanvas
    {inputManager}
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
      onReset={handleReset}
      onTogglePause={handleTogglePause}
      onToggleLock={handleToggleLock}
    />
  {/if}
  <ErrorDisplay
    {errors}
    isVisible={showErrors}
    onDismiss={handleErrorDismiss}
  />
</div>
