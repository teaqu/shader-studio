<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ShaderFile } from '../types/ShaderFile';
  import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
  import { renderQueue } from '../stores/shaderStore';
  import { requestShaderCode, type ShaderLanguage } from '../shaderCodeRequest';
  import { observeNearViewport } from '../shaderPreviewVisibility';
  import { createEngineForLanguage } from '../engineFactory';

  interface RendererOwnership {
    engine: RenderingEngine;
    targetCanvas: HTMLCanvasElement;
    dispose: () => void;
    isDisposed: () => boolean;
  }

  let { shader, width = 320, height = 180, vscodeApi, forceFresh = false, onCompilationFailed }: {
    shader: ShaderFile;
    width?: number;
    height?: number;
    vscodeApi: any;
    forceFresh?: boolean; 
    onCompilationFailed?: () => void;  
  } = $props();

  let canvas: HTMLCanvasElement = $state()!;
  let renderingOwnership: RendererOwnership | null = null;
  let capturedImage: string = $state('');
  let compilationFailed: boolean = $state(false);
  let shaderCode: string = '';
  let shaderConfig: any = null;
  let shaderBuffers: Record<string, string> = {};
  let shaderLanguage: ShaderLanguage = 'glsl';
  let queueId: string = '';
  let useCache: boolean = $state(true); // Flag to control whether to use cached thumbnail
  let prevWidth: number = 0;
  let prevHeight: number = 0;
  let resizeTimeout: number | null = null;
  let previewContainer: HTMLDivElement;
  let hasStartedLoading = false;
  let stopVisibilityObserver: (() => void) | null = null;
  let destroyed = false;
  let thumbnailGeneration = 0;
  let hoverGeneration = 0;

  const getRenderingOwnership = () => renderingOwnership;
  const getHoverOwnership = () => hoverOwnership;

  // Re-render when dimensions change (card size slider)
  $effect(() => {
    const w = width;
    const h = height;

    if (prevWidth === 0) {
      // First run, just record initial size
      prevWidth = w;
      prevHeight = h;
      return;
    }

    if (w !== prevWidth || h !== prevHeight) {
      prevWidth = w;
      prevHeight = h;

      if (!shaderCode) return;

      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
      }

      resizeTimeout = window.setTimeout(async () => {
        // Clear captured image so canvas reappears in DOM
        capturedImage = '';
        compilationFailed = false;
        // Wait a tick for Svelte to render the canvas element
        await new Promise(r => requestAnimationFrame(r));
        if (canvas && shaderCode) {
          await renderQueue.enqueue(`${queueId}-resize`, async () => {
            await initializeRendering();
          });
        }
      }, 500);
    }

    return () => {
      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
      }
    };
  });

  // Hover rendering state
  let isHovering: boolean = $state(false);
  let hoverVisible: boolean = $state(false); // only true after first render frame
  let hoverCanvas: HTMLCanvasElement | null = null;
  let hoverOwnership: RendererOwnership | null = null;
  let hoverCanvasWrapper: HTMLDivElement | null = null;

  onMount(async () => {
    queueId = `${shader.path}-${Date.now()}`;
    
    // Use cached thumbnail if available and we're not forcing a refresh
    if (shader.cachedThumbnail && useCache && !forceFresh) {
      capturedImage = shader.cachedThumbnail;
      compilationFailed = false;
    } else {
      if (previewContainer) {
        stopVisibilityObserver = observeNearViewport(previewContainer, () => {
          void startLoading();
        });
      } else {
        await startLoading();
      }
    }
  });

  async function startLoading() {
    if (hasStartedLoading || destroyed) {
      return;
    }

    hasStartedLoading = true;
    await loadShaderCode();
  }

  async function loadShaderCode({
    renderThumbnail = true,
    isCurrent = () => !destroyed,
  }: {
    renderThumbnail?: boolean;
    isCurrent?: () => boolean;
  } = {}) {
    if (!vscodeApi || !isCurrent()) return;

    if (renderThumbnail && canvas) {
      await renderQueue.enqueue(queueId, async () => {
        await fetchShaderCode(isCurrent);
        if (!isCurrent()) return;
        await initializeRendering();
      });
      return;
    }

    await fetchShaderCode(isCurrent);
  }

  async function fetchShaderCode(isCurrent: () => boolean = () => !destroyed) {
    if (!vscodeApi || shaderCode || !isCurrent()) return;

    try {
      const response = await requestShaderCode({
        vscodeApi,
        path: shader.path,
        target: window,
      });

      if (!isCurrent()) return;

      shaderCode = response.code;
      shaderConfig = response.config || null;
      shaderBuffers = response.buffers;
      shaderLanguage = response.language;
    } catch (err) {
      if (isCurrent()) {
        console.error('Failed to load shader code:', err);
      }
    }
  }

  async function createShaderRenderer(
    targetCanvas: HTMLCanvasElement,
    renderSingleFrame: boolean,
    isCurrent: () => boolean,
    publishOwnership: (ownership: RendererOwnership) => void,
  ) {
    const engine = createEngineForLanguage(shaderLanguage);
    let disposed = false;
    const ownership: RendererOwnership = {
      engine,
      targetCanvas,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        cleanupRenderer(engine, targetCanvas);
      },
      isDisposed: () => disposed,
    };
    publishOwnership(ownership);

    try {
      if (!isCurrent() || ownership.isDisposed()) {
        ownership.dispose();
        return null;
      }

      engine.initialize(targetCanvas, true); // Always preserve drawing buffer for capture

      const result = await engine.compileShaderPipeline(
        shaderCode,
        shaderConfig,
        shader.path,
        shaderBuffers
      );

      if (!isCurrent() || ownership.isDisposed()) {
        ownership.dispose();
        return null;
      }

      if (result?.success) {
        if (!renderSingleFrame) {
          engine.startRenderLoop();
        }
      }

      return { ownership, result };
    } catch (err) {
      ownership.dispose();
      throw err;
    }
  }

  function cleanupRenderer(engine: RenderingEngine | null, targetCanvas: HTMLCanvasElement | null) {
    if (!engine) return;

    let language: ShaderLanguage | null = null;
    try {
      language = engine.getShaderLanguage();
    } catch (err) {
      console.error('Failed to identify renderer during cleanup:', err);
    }

    try {
      engine.stopRenderLoop();
    } catch (err) {
      console.error('Failed to stop renderer during cleanup:', err);
    }

    try {
      engine.dispose();
    } catch (err) {
      console.error('Failed to dispose renderer:', err);
    }

    if (language !== 'glsl' || !targetCanvas) return;

    try {
      // Force WebGL context to be lost to free resources
      const gl = targetCanvas.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (err) {
      console.error('Failed to release WebGL context:', err);
    }
  }

  async function initializeRendering() {
    if (!shaderCode || !canvas || destroyed) return;

    const targetCanvas = canvas;
    const generation = ++thumbnailGeneration;
    const isCurrent = () => (
      !destroyed
      && generation === thumbnailGeneration
      && canvas === targetCanvas
    );

    // Clean up existing rendering engine if any
    if (renderingOwnership) {
      renderingOwnership.dispose();
      renderingOwnership = null;
    }

    const ownershipSlot: { current: RendererOwnership | null } = { current: null };
    try {
      const renderer = await createShaderRenderer(
        targetCanvas,
        true,
        isCurrent,
        (ownership) => {
          ownershipSlot.current = ownership;
          if (isCurrent()) {
            renderingOwnership = ownership;
          } else {
            ownership.dispose();
          }
        },
      );
      if (!renderer || !isCurrent()) {
        if (getRenderingOwnership() === ownershipSlot.current) renderingOwnership = null;
        return;
      }

      const { ownership, result } = renderer;
      const { engine } = ownership;

      if (result?.success) {
        // Let next frame render to ensure it's fully initialized
        await new Promise((resolve) => setTimeout(resolve, 16));
        if (!isCurrent() || getRenderingOwnership() !== ownership || ownership.isDisposed()) return;
        
        // Capture the rendered frame as an image
        try {
          engine.renderForCapture();
          capturedImage = targetCanvas.toDataURL('image/png');
          compilationFailed = false;
          
          // Save thumbnail to cache on extension side
          if (vscodeApi && capturedImage) {
            vscodeApi.postMessage({
              type: 'saveThumbnail',
              path: shader.path,
              thumbnail: capturedImage,
              modifiedTime: shader.modifiedTime
            });
          }
        } catch (err) {
          console.error('Failed to capture image for shader:', shader.name, err);
          compilationFailed = true;
          onCompilationFailed?.();
        }
        
        // Clean up rendering resources
        ownership.dispose();
        if (getRenderingOwnership() === ownership) {
          renderingOwnership = null;
        }
        
        // Keep shader code and buffers for hover rendering - don't clear them
      } else {
        console.error('Failed to compile shader:', shader.name, result?.errors);
        compilationFailed = true;
        onCompilationFailed?.();
        // Still clean up on failure
        ownership.dispose();
        if (getRenderingOwnership() === ownership) {
          renderingOwnership = null;
        }
      }
    } catch (err) {
      ownershipSlot.current?.dispose();
      if (getRenderingOwnership() === ownershipSlot.current) {
        renderingOwnership = null;
      }
      if (!isCurrent()) return;

      console.error('Failed to initialize rendering:', err);
      compilationFailed = true;
      onCompilationFailed?.();
    }
  }

  async function handleMouseEnter() {
    if (isHovering || !hoverCanvasWrapper || destroyed) return;

    isHovering = true;
    const generation = ++hoverGeneration;
    const isCurrent = () => (
      !destroyed
      && isHovering
      && generation === hoverGeneration
    );
    
    // Load shader code if not already loaded (e.g., when using cached thumbnail)
    if (!shaderCode) {
      await loadShaderCode({ renderThumbnail: false, isCurrent });
      if (!isCurrent()) return;

      // Wait for shader code to be loaded
      if (!shaderCode) {
        console.error('Failed to load shader code for hover');
        cleanupHoverRendering();
        return;
      }
    }

    // Create a completely new canvas for hover rendering
    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = width;
    targetCanvas.height = height;
    targetCanvas.className = 'shader-preview hover-canvas';
    hoverCanvas = targetCanvas;

    // Append the canvas to the wrapper
    hoverCanvasWrapper.appendChild(targetCanvas);

    try {
      // Create a completely new rendering engine and pipeline, start the render loop
      const ownershipSlot: { current: RendererOwnership | null } = { current: null };
      const renderer = await createShaderRenderer(
        targetCanvas,
        false,
        () => isCurrent() && hoverCanvas === targetCanvas,
        (ownership) => {
          ownershipSlot.current = ownership;
          if (isCurrent() && hoverCanvas === targetCanvas) {
            hoverOwnership = ownership;
          } else {
            ownership.dispose();
          }
        },
      );
      if (!renderer || !isCurrent() || hoverCanvas !== targetCanvas) {
        if (getHoverOwnership() === ownershipSlot.current) hoverOwnership = null;
        return;
      }

      const { ownership, result } = renderer;

      if (result?.success) {
        // Wait for first rendered frame before revealing the canvas to avoid black flash
        await new Promise(r => requestAnimationFrame(r));
        if (isCurrent() && hoverCanvas === targetCanvas && getHoverOwnership() === ownership) {
          hoverVisible = true;
        }
      } else {
        console.error('Failed to compile shader on hover:', shader.name, result?.errors);
        cleanupHoverRendering();
      }
    } catch (err) {
      if (!isCurrent()) return;

      console.error('Failed to initialize hover rendering:', err);
      cleanupHoverRendering();
    }
  }
  
  function handleMouseLeave() {
    if (!isHovering) return;
    
    cleanupHoverRendering();
  }
  
  function cleanupHoverRendering() {
    hoverGeneration++;
    isHovering = false;
    hoverVisible = false;
    
    hoverOwnership?.dispose();
    hoverOwnership = null;
    
    if (hoverCanvas) {
      // Remove canvas from DOM
      if (hoverCanvas.parentNode) {
        hoverCanvas.parentNode.removeChild(hoverCanvas);
      }
      hoverCanvas = null;
    }
  }

  onDestroy(() => {
    destroyed = true;
    thumbnailGeneration++;
    stopVisibilityObserver?.();

    // Remove from queue if still waiting
    if (queueId) {
      renderQueue.remove(queueId);
    }
    
    renderingOwnership?.dispose();
    renderingOwnership = null;
    cleanupHoverRendering();
  });
</script>

<div 
  bind:this={previewContainer}
  class="shader-preview-container"
  role="presentation"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <!-- Hover canvas wrapper - only visible after first hover render completes -->
  <div
    bind:this={hoverCanvasWrapper}
    class="hover-canvas-wrapper"
    class:visible={hoverVisible}
  ></div>

  {#if capturedImage}
    <img
      src={capturedImage}
      alt={shader.name}
      {width}
      {height}
      class="shader-preview"
    />
  {:else if compilationFailed}
    <div class="shader-error">
      <div class="error-icon">⚠️</div>
      <div class="error-message">Compilation Failed</div>
    </div>
  {:else}
    <div class="loading-placeholder"></div>
    <canvas
      bind:this={canvas}
      {width}
      {height}
      class="shader-preview loading-canvas"
    ></canvas>
  {/if}
</div>

<style>
  .shader-preview-container {
    width: 100%;
    height: 100%;
    display: block;
    position: relative;
    background: #000;
  }
  
  .shader-preview {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
  
  .loading-placeholder {
    width: 100%;
    height: 100%;
    background: var(--vscode-editor-background, #1e1e1e);
    position: absolute;
    top: 0;
    left: 0;
  }

  .loading-canvas {
    opacity: 0;
  }

  .shader-error {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #000;
    color: #fff;
  }
  
  .error-icon {
    font-size: 48px;
    margin-bottom: 8px;
    opacity: 0.6;
    filter: grayscale(100%);
  }
  
  .error-message {
    font-size: 12px;
    opacity: 0.7;
  }
  
  .hover-canvas-wrapper {
    width: 100%;
    height: 100%;
    display: none;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    background: #000;
  }
  
  .hover-canvas-wrapper.visible {
    display: block;
  }
  
  .hover-canvas-wrapper :global(canvas) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
