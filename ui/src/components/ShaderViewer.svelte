<script lang="ts">
  import { onMount } from 'svelte';
  import { piCreateFPSCounter } from '../lib/pilibs/src/piWebUtils';
  import { AppInitializer, type ManagerInstances } from '../managers/AppInitializer';
  import { RenderController } from '../managers/RenderController';
  import ShaderCanvas from './ShaderCanvas.svelte';
  import MenuBar from './MenuBar.svelte';
  import ErrorDisplay from './ErrorDisplay.svelte';

  // Callback props instead of event dispatcher
  export let onInitialized: (data: { managers: ManagerInstances, renderController: RenderController }) => void = () => {};
  
  // --- Core State ---
  let glCanvas: HTMLCanvasElement;
  let initialized = false;
  let isLocked = false;
  let errors: string[] = [];
  let showErrors = false;
  let currentFPS = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;

  // --- Managers and Controllers ---
  let managers: ManagerInstances | null = null;
  let renderController: RenderController | null = null;
  
  const vscode = acquireVsCodeApi();
  const fpsCounter = piCreateFPSCounter();
  const appInitializer = new AppInitializer(vscode, fpsCounter);

  // --- Event Handlers ---
  async function handleCanvasReady(canvas: HTMLCanvasElement) {
    glCanvas = canvas;
    await initializeApp();
  }

  function handleCanvasResize(data: { width: number, height: number }) {
    if (!renderController || !initialized) return;
    const { width, height } = data;
    canvasWidth = Math.round(width);
    canvasHeight = Math.round(height);
    renderController.handleCanvasResize(width, height);
  }

  function handleReset() {
    if (!renderController || !initialized) return;
    renderController.handleReset(() => {
      if (managers?.shaderManager) {
        const lastEvent = managers.shaderManager.getLastEvent();
        if (lastEvent) {
          handleShaderMessage(lastEvent);
        }
      }
    });
  }

  function handleTogglePause() {
    if (!renderController || !initialized) return;
    renderController.handleTogglePause();
  }

  function handleToggleLock() {
    if (!renderController || !initialized) return;
    renderController.handleToggleLock();
  }

  function handleErrorDismiss() {
    showErrors = false;
    errors = [];
  }

  // --- Initialization ---
  async function initializeApp() {
    try {
      managers = await appInitializer.initializeManagers(glCanvas);
      if (!managers) {
        addError('Failed to initialize managers');
        return;
      }

      renderController = new RenderController(managers, vscode, glCanvas);
      
      // Set up message listener
      window.addEventListener('message', handleShaderMessage);
      
      // Set up FPS update interval (less frequent than render loop)
      let fpsUpdateCounter = 0;
      const fpsUpdateInterval = setInterval(() => {
        if (managers?.renderLoopManager) {
          currentFPS = managers.renderLoopManager.getCurrentFPS();
        }
        fpsUpdateCounter++;
        // Stop updating FPS if not initialized after some time
        if (fpsUpdateCounter > 600 && !initialized) { // 60 seconds
          clearInterval(fpsUpdateInterval);
        }
      }, 100); // Update FPS 10 times per second instead of every frame
      
      initialized = true;
      onInitialized({ managers, renderController });

    } catch (err) {
      addError(`Initialization failed: ${err}`);
    }
  }

  async function handleShaderMessage(event: MessageEvent) {
    if (!renderController || !initialized) return;
    
    try {
      await renderController.handleShaderMessage(event, (locked) => {
        isLocked = locked;
      });
    } catch (err) {
      addError(`Shader message handling failed: ${err}`);
    }
  }

  function addError(message: string) {
    errors = [...errors, message];
    showErrors = true;
    vscode.postMessage({ type: 'error', payload: [message] });
  }

  // Reactive values for managers
  $: timeManager = managers?.timeManager;
  $: inputManager = managers?.inputManager;
</script>

<div class="main-container">
  <ShaderCanvas 
    {inputManager}
    onCanvasReady={handleCanvasReady}
    onCanvasResize={handleCanvasResize}
  />
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
  <ErrorDisplay 
    {errors}
    isVisible={showErrors}
    onDismiss={handleErrorDismiss}
  />
</div>
