<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ShaderFile } from '../types/ShaderFile';
  import { RenderingEngine } from '@shader-studio/rendering';
  import { renderQueue } from '../stores/shaderStore';

  let { shader, width = 320, height = 180, vscodeApi, forceFresh = false, onCompilationFailed }: {
    shader: ShaderFile;
    width?: number;
    height?: number;
    vscodeApi: any;
    forceFresh?: boolean; 
    onCompilationFailed?: () => void;  
  } = $props();

  let canvas: HTMLCanvasElement = $state()!;
  let renderingEngine: RenderingEngine | null = null;
  let capturedImage: string = $state('');
  let compilationFailed: boolean = $state(false);
  let shaderCode: string = '';
  let shaderConfig: any = null;
  let shaderBuffers: Record<string, string> = {};
  let queueId: string = '';
  let useCache: boolean = $state(true); // Flag to control whether to use cached thumbnail
  
  // Hover rendering state
  let isHovering: boolean = $state(false);
  let hoverCanvas: HTMLCanvasElement | null = null;
  let hoverRenderingEngine: RenderingEngine | null = null;
  let hoverCanvasWrapper: HTMLDivElement | null = null;

  onMount(async () => {
    queueId = `${shader.path}-${Date.now()}`;
    
    // Use cached thumbnail if available and we're not forcing a refresh
    if (shader.cachedThumbnail && useCache && !forceFresh) {
      capturedImage = shader.cachedThumbnail;
      compilationFailed = false;
    } else {
      await loadShaderCode();
    }
  });

  async function loadShaderCode() {
    if (!vscodeApi || shaderCode) return;

    try {
      // Return a promise that resolves when shader code is loaded
      await new Promise<void>((resolve, reject) => {
        vscodeApi.postMessage({
          type: 'requestShaderCode',
          path: shader.path
        });

        const handleMessage = async (event: MessageEvent) => {
          const message = event.data;
          if (message.type === 'shaderCode' && message.path === shader.path) {
            window.removeEventListener('message', handleMessage);
            
            shaderCode = message.code;
            shaderConfig = message.config || null;
            shaderBuffers = message.buffers || {};
            
            resolve();
          }
        };

        window.addEventListener('message', handleMessage);
        
        // Timeout after 5 seconds
        setTimeout(() => {
          window.removeEventListener('message', handleMessage);
          reject(new Error('Timeout loading shader code'));
        }, 5000);
      });
      
      // Queue the rendering to avoid too many concurrent WebGL contexts
      // Only if we're not just loading for hover (check if canvas exists)
      if (canvas) {
        await renderQueue.enqueue(queueId, async () => {
          await initializeRendering();
        });
      }
    } catch (err) {
      console.error('Failed to load shader code:', err);
    }
  }

  async function createShaderRenderer(targetCanvas: HTMLCanvasElement, renderSingleFrame: boolean) {
    const engine = new RenderingEngine();
    engine.initialize(targetCanvas, true); // Always preserve drawing buffer for capture
    
    const result = await engine.compileShaderPipeline(
      shaderCode,
      shaderConfig,
      shader.path,
      shaderBuffers
    );
    
    if (result?.success) {
      if (renderSingleFrame) {
        engine.render();
      } else {
        engine.startRenderLoop();
      }
    }
    
    return { engine, result };
  }

  function cleanupRenderer(engine: RenderingEngine | null, targetCanvas: HTMLCanvasElement | null) {
    if (engine) {
      engine.stopRenderLoop();
      engine.dispose();
    }
    
    if (targetCanvas) {
      // Force WebGL context to be lost to free resources
      const gl = targetCanvas.getContext('webgl2');
      if (gl) {
        const loseContext = gl.getExtension('WEBGL_lose_context');
        if (loseContext) {
          loseContext.loseContext();
        }
      }
    }
  }

  async function initializeRendering() {
    if (!shaderCode || !canvas) return;

    // Clean up existing rendering engine if any
    if (renderingEngine) {
      cleanupRenderer(renderingEngine, canvas);
      renderingEngine = null;
    }

    try {
      const { engine, result } = await createShaderRenderer(canvas, true);
      renderingEngine = engine;

      if (result?.success) {
        // Let next frame render to ensure it's fully initialized
        await new Promise((resolve) => setTimeout(resolve, 16));
        
        // Capture the rendered frame as an image
        try {
          capturedImage = canvas.toDataURL('image/png');
          compilationFailed = false;
          console.log('Captured image for shader:', shader.name, 'Image length:', capturedImage.length);
          
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
        }
        
        // Clean up rendering resources
        cleanupRenderer(renderingEngine, canvas);
        renderingEngine = null;
        
        // Keep shader code and buffers for hover rendering - don't clear them
      } else {
        console.error('Failed to compile shader:', shader.name, result?.errors);
        compilationFailed = true;
        onCompilationFailed?.();
        // Still clean up on failure
        cleanupRenderer(renderingEngine, canvas);
        renderingEngine = null;
      }
    } catch (err) {
      console.error('Failed to initialize rendering:', err);
      compilationFailed = true;
      onCompilationFailed?.();
    }
  }

  async function handleMouseEnter() {
    if (isHovering || !hoverCanvasWrapper) return;
    
    // Load shader code if not already loaded (e.g., when using cached thumbnail)
    if (!shaderCode) {
      await loadShaderCode();
      // Wait for shader code to be loaded
      if (!shaderCode) {
        console.error('Failed to load shader code for hover');
        return;
      }
    }
    
    isHovering = true;
    
    // Create a completely new canvas for hover rendering
    hoverCanvas = document.createElement('canvas');
    hoverCanvas.width = width;
    hoverCanvas.height = height;
    hoverCanvas.className = 'shader-preview hover-canvas';
    
    // Append the canvas to the wrapper
    hoverCanvasWrapper.appendChild(hoverCanvas);
    
    try {
      // Create a completely new rendering engine and pipeline, start the render loop
      const { engine, result } = await createShaderRenderer(hoverCanvas, false);
      hoverRenderingEngine = engine;
      
      if (result?.success) {
        // Start the render loop for interactive preview
        engine.startRenderLoop();
      } else {
        console.error('Failed to compile shader on hover:', shader.name, result?.errors);
        cleanupHoverRendering();
      }
    } catch (err) {
      console.error('Failed to initialize hover rendering:', err);
      cleanupHoverRendering();
    }
  }
  
  function handleMouseLeave() {
    if (!isHovering) return;
    
    cleanupHoverRendering();
  }
  
  function cleanupHoverRendering() {
    isHovering = false;
    
    cleanupRenderer(hoverRenderingEngine, hoverCanvas);
    hoverRenderingEngine = null;
    
    if (hoverCanvas) {
      // Remove canvas from DOM
      if (hoverCanvas.parentNode) {
        hoverCanvas.parentNode.removeChild(hoverCanvas);
      }
      hoverCanvas = null;
    }
  }

  onDestroy(() => {
    // Remove from queue if still waiting
    if (queueId) {
      renderQueue.remove(queueId);
    }
    
    cleanupRenderer(renderingEngine, canvas);
    cleanupHoverRendering();
  });
</script>

<div 
  class="shader-preview-container"
  role="presentation"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <!-- Hover canvas wrapper - always present but only visible when hovering -->
  <div 
    bind:this={hoverCanvasWrapper} 
    class="hover-canvas-wrapper"
    class:visible={isHovering}
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
    <canvas
      bind:this={canvas}
      {width}
      {height}
      class="shader-preview"
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
