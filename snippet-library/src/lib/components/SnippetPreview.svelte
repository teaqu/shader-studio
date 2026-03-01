<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { Snippet } from '../types/Snippet';
  import { RenderingEngine } from '@shader-studio/rendering';
  import { renderQueue } from '../stores/snippetStore';
  import { buildPreviewShader } from '../preview/previewTemplates';

  let { snippet, width = 320, height = 180, interactive = false }: {
    snippet: Snippet;
    width?: number;
    height?: number;
    interactive?: boolean;
  } = $props();

  let canvas: HTMLCanvasElement = $state()!;
  let capturedImage: string = $state('');
  let compilationFailed: boolean = $state(false);
  let queueId: string = '';
  let previewShader: string | null = $state(null);

  // Re-render when dimensions change (card size slider)
  let prevWidth: number = 0;
  let prevHeight: number = 0;
  let resizeTimeout: number | null = null;

  $effect(() => {
    const w = width;
    const h = height;

    if (prevWidth === 0) {
      prevWidth = w;
      prevHeight = h;
      return;
    }

    if (w !== prevWidth || h !== prevHeight) {
      prevWidth = w;
      prevHeight = h;

      if (!previewShader || interactive) return;

      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
      }

      resizeTimeout = window.setTimeout(async () => {
        capturedImage = '';
        compilationFailed = false;
        await new Promise(r => requestAnimationFrame(r));
        if (canvas && previewShader) {
          await renderQueue.enqueue(`${queueId}-resize`, async () => {
            await renderThumbnail();
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
  let hoverCanvas: HTMLCanvasElement | null = null;
  let hoverRenderingEngine: RenderingEngine | null = null;
  let hoverCanvasWrapper: HTMLDivElement | null = $state(null);

  // Interactive mode state (for detail modal)
  let interactiveCanvas: HTMLCanvasElement = $state()!;
  let interactiveEngine: RenderingEngine | null = null;

  onMount(async () => {
    previewShader = buildPreviewShader(snippet.body, snippet.call, snippet.category, snippet.example, snippet.prefix);

    if (!previewShader) {
      return;
    }

    if (interactive) {
      await tick();
      await initInteractive();
      return;
    }

    queueId = `snippet-${snippet.prefix}-${Date.now()}`;
    // Wait a frame so the canvas is fully laid out before first render
    await new Promise(r => requestAnimationFrame(r));
    await renderQueue.enqueue(queueId, async () => {
      await renderThumbnail();
    });
  });

  async function initInteractive() {
    if (!previewShader || !interactiveCanvas) return;

    const engine = new RenderingEngine();
    try {
      engine.initialize(interactiveCanvas, true);

      const result = await engine.compileShaderPipeline(
        previewShader,
        null,
        '',
        {}
      );

      if (result?.success) {
        interactiveEngine = engine;
        // Sync WebGL viewport with CSS-sized canvas display dimensions
        const rect = interactiveCanvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          interactiveCanvas.width = rect.width;
          interactiveCanvas.height = rect.height;
          engine.handleCanvasResize(rect.width, rect.height);
        }
        engine.startRenderLoop();
      }
    } catch (err) {
      console.error('Failed to initialize interactive preview:', err);
    }
  }

  async function renderThumbnail() {
    if (!previewShader || !canvas) return;

    const engine = new RenderingEngine();
    try {
      engine.initialize(canvas, true);

      const result = await engine.compileShaderPipeline(
        previewShader,
        null,
        '',
        {}
      );

      if (result?.success) {
        // Render a few frames so iTime > 0 for shaders that need it
        engine.startRenderLoop();
        await new Promise((resolve) => setTimeout(resolve, 50));
        engine.stopRenderLoop();

        try {
          capturedImage = canvas.toDataURL('image/png');
          compilationFailed = false;
        } catch (err) {
          console.error('Failed to capture snippet preview:', snippet.prefix, err);
          compilationFailed = true;
        }
      } else {
        console.error('Failed to compile snippet preview:', snippet.prefix, result?.error);
        compilationFailed = true;
      }
    } catch (err) {
      console.error('Failed to render snippet preview:', err);
      compilationFailed = true;
    } finally {
      cleanupRenderer(engine, canvas);
    }
  }

  function cleanupRenderer(engine: RenderingEngine | null, targetCanvas: HTMLCanvasElement | null) {
    if (engine) {
      engine.stopRenderLoop();
      engine.dispose();
    }

    if (targetCanvas) {
      const gl = targetCanvas.getContext('webgl2');
      if (gl) {
        const loseContext = gl.getExtension('WEBGL_lose_context');
        if (loseContext) {
          loseContext.loseContext();
        }
      }
    }
  }

  async function handleMouseEnter() {
    if (isHovering || !hoverCanvasWrapper || !previewShader || interactive) return;

    isHovering = true;

    hoverCanvas = document.createElement('canvas');
    hoverCanvas.width = width;
    hoverCanvas.height = height;
    hoverCanvas.className = 'snippet-preview hover-canvas';

    hoverCanvasWrapper.appendChild(hoverCanvas);

    try {
      const engine = new RenderingEngine();
      engine.initialize(hoverCanvas, true);

      const result = await engine.compileShaderPipeline(
        previewShader,
        null,
        '',
        {}
      );

      if (result?.success) {
        hoverRenderingEngine = engine;
        engine.startRenderLoop();
      } else {
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
      if (hoverCanvas.parentNode) {
        hoverCanvas.parentNode.removeChild(hoverCanvas);
      }
      hoverCanvas = null;
    }
  }

  onDestroy(() => {
    if (queueId) {
      renderQueue.remove(queueId);
    }
    cleanupHoverRendering();
    if (interactiveEngine) {
      cleanupRenderer(interactiveEngine, interactiveCanvas);
      interactiveEngine = null;
    }
  });
</script>

{#if interactive}
  <div class="snippet-preview-container interactive">
    {#if !previewShader}
      <div class="no-preview">
        <svg class="placeholder-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="8" y="10" width="32" height="28" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.4" />
          <path d="M16 22l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3" />
          <path d="M32 22l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3" />
          <path d="M26 20l-4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3" />
        </svg>
      </div>
    {:else}
      <canvas
        bind:this={interactiveCanvas}
        {width}
        {height}
        class="snippet-preview"
      ></canvas>
    {/if}
  </div>
{:else}
  <div
    class="snippet-preview-container"
    role="presentation"
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
  >
    <div
      bind:this={hoverCanvasWrapper}
      class="hover-canvas-wrapper"
      class:visible={isHovering}
    ></div>

    {#if !previewShader || compilationFailed}
      <div class="no-preview">
        <svg class="placeholder-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="8" y="10" width="32" height="28" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.4" />
          <path d="M16 22l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3" />
          <path d="M32 22l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3" />
          <path d="M26 20l-4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3" />
        </svg>
      </div>
    {:else if capturedImage}
      <img
        src={capturedImage}
        alt={snippet.name}
        {width}
        {height}
        class="snippet-preview"
      />
    {:else}
      <canvas
        bind:this={canvas}
        {width}
        {height}
        class="snippet-preview"
      ></canvas>
    {/if}
  </div>
{/if}

<style>
  .snippet-preview-container {
    width: 100%;
    height: 100%;
    display: block;
    position: relative;
    background: #1e1e1e;
  }

  .snippet-preview {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  .no-preview {
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #0a1628 0%, #0f2847 40%, #163a5f 70%, #1a4a7a 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #4a7ab5;
  }

  .placeholder-icon {
    width: 40%;
    max-width: 64px;
    height: auto;
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
