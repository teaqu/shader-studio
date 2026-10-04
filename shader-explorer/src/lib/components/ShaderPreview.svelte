<script module lang="ts">
  let sharedGlslThumbnailCanvas: HTMLCanvasElement | null = null;
  let sharedGlslHoverCanvas: HTMLCanvasElement | null = null;
  let activeSharedGlslHoverCleanup: (() => void) | null = null;

  function getSharedGlslThumbnailCanvas(width: number, height: number): HTMLCanvasElement {
    if (sharedGlslThumbnailCanvas?.getContext('webgl2')?.isContextLost?.()) {
      sharedGlslThumbnailCanvas = null;
    }
    sharedGlslThumbnailCanvas ??= document.createElement('canvas');
    sharedGlslThumbnailCanvas.width = width;
    sharedGlslThumbnailCanvas.height = height;
    return sharedGlslThumbnailCanvas;
  }

  function isLostSharedGlslThumbnailCanvas(canvas: HTMLCanvasElement): boolean {
    return canvas === sharedGlslThumbnailCanvas
      && Boolean(canvas.getContext('webgl2')?.isContextLost?.());
  }

  function discardSharedGlslThumbnailCanvas(canvas: HTMLCanvasElement): void {
    if (canvas === sharedGlslThumbnailCanvas) {
      sharedGlslThumbnailCanvas = null;
    }
  }

  function getSharedGlslHoverCanvas(width: number, height: number): HTMLCanvasElement {
    if (sharedGlslHoverCanvas?.getContext('webgl2')?.isContextLost?.()) {
      sharedGlslHoverCanvas = null;
    }
    sharedGlslHoverCanvas ??= document.createElement('canvas');
    sharedGlslHoverCanvas.width = width;
    sharedGlslHoverCanvas.height = height;
    return sharedGlslHoverCanvas;
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { ShaderFile } from '../types/ShaderFile';
  import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
  import type { SlangSourceModule } from '@shader-studio/types';
  import { hoverRenderQueue, thumbnailRenderQueue } from '../stores/shaderStore';
  import { requestShaderCode, type ShaderLanguage } from '../shaderCodeRequest';
  import { observeNearViewport } from '../shaderPreviewVisibility';
  import { createEngineForLanguage } from '../engineFactory';

  /** Debounce for re-rendering after file changes, so typing does not render every keystroke. */
  const VERSION_REFRESH_DELAY_MS = 1000;
  /** How long a shader may stay broken mid-edit before its last good thumbnail gives way to the failure. */
  const EDIT_ERROR_GRACE_MS = 60_000;

  interface RendererOwnership {
    engine: RenderingEngine;
    targetCanvas: HTMLCanvasElement;
    dispose: () => void;
    isDisposed: () => boolean;
  }

  let { shader, width = 320, height = 180, vscodeApi, refreshAll = false, forceFresh = false, compact = false, onCompilationFailed }: {
    shader: ShaderFile;
    width?: number;
    height?: number;
    vscodeApi: any;
    refreshAll?: boolean;
    forceFresh?: boolean;
    compact?: boolean;
    onCompilationFailed?: () => void;
  } = $props();

  let canvas: HTMLCanvasElement = $state()!;
  let renderingOwnership: RendererOwnership | null = null;
  let capturedImage: string = $state('');
  let compilationFailed: boolean = $state(false);

  const errorIconSize = $derived(compact
    ? Math.min(Math.round(width * 0.07), 40)
    : Math.round(width * 0.2));
  const errorTextSize = $derived(compact
    ? Math.min(Math.round(width * 0.047), 28)
    : Math.round(width * 0.13));
  let shaderCode: string = '';
  let previewPath: string = shader.path;
  let shaderConfig: any = null;
  let shaderBuffers: Record<string, string> = {};
  let shaderLanguage: ShaderLanguage = 'glsl';
  let customUniformDeclarations: string | undefined;
  let customUniformInfo: { name: string; type: string }[] | undefined;
  let slangModules: SlangSourceModule[] | undefined;
  let queueId: string = '';
  let useCache: boolean = $state(true); // Flag to control whether to use cached thumbnail
  let prevWidth: number = 0;
  let prevHeight: number = 0;
  let resizeGeneration = 0;
  let resizeTimeout: number | null = null;
  let previewContainer: HTMLDivElement;
  let hasStartedLoading = false;
  let stopVisibilityObserver: (() => void) | null = null;
  let destroyed = false;
  let thumbnailGeneration = 0;
  let hoverGeneration = 0;
  const pendingShaderRequests = new Set<AbortController>();

  const getRenderingOwnership = () => renderingOwnership;
  const getHoverOwnership = () => hoverOwnership;

  // Thumbnails are rendered at their actual card resolution. Coalesce slider
  // changes and keep the existing image visible until the replacement has
  // rendered, so a resize cannot turn a transient rendering error into a
  // permanently failed card.
  $effect(() => {
    const w = width;
    const h = height;

    if (prevWidth === 0) {
      prevWidth = w;
      prevHeight = h;
      return;
    }

    if (w === prevWidth && h === prevHeight) {
      return;
    }

    prevWidth = w;
    prevHeight = h;
    const generation = ++resizeGeneration;
    if (resizeTimeout !== null) {
      window.clearTimeout(resizeTimeout);
    }

    resizeTimeout = window.setTimeout(async () => {
      resizeTimeout = null;
      if (destroyed || generation !== resizeGeneration || !shaderCode) {
        return;
      }

      await thumbnailRenderQueue.enqueue(queueId, async () => {
        if (destroyed || generation !== resizeGeneration) {
          return;
        }
        await initializeRendering({
          keepPreviousImage: Boolean(capturedImage),
          isCurrent: () => generation === resizeGeneration,
        });
      });
    }, 500);

    return () => {
      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
        resizeTimeout = null;
      }
    };
  });

  // The shader, its config or a pass source changed on disk. Re-render from
  // fresh source once edits settle, keeping the current image on screen until
  // the replacement is ready. A real compile error still replaces it.
  let knownThumbnailVersion: number | undefined;
  let thumbnailVersionInitialized = false;
  let versionRefreshTimeout: number | null = null;
  let versionGeneration = 0;
  // Outcome of the latest thumbnail attempt; null until it settles.
  let lastThumbnailRenderSucceeded: boolean | null = null;
  // While a shader is mid-edit and broken, its last good image stays up for a grace period.
  let failingSince: number | null = null;
  let editErrorGraceTimeout: number | null = null;

  function clearEditErrorGrace() {
    failingSince = null;
    if (editErrorGraceTimeout !== null) {
      window.clearTimeout(editErrorGraceTimeout);
      editErrorGraceTimeout = null;
    }
  }

  function startEditErrorGrace() {
    if (failingSince !== null) {
      return;
    }
    failingSince = Date.now();
    editErrorGraceTimeout = window.setTimeout(() => {
      editErrorGraceTimeout = null;
      failingSince = null;
      if (destroyed) {
        return;
      }
      capturedImage = '';
      compilationFailed = true;
      onCompilationFailed?.();
    }, EDIT_ERROR_GRACE_MS);
  }

  $effect(() => {
    const version = shader.thumbnailVersion;
    const cachedThumbnail = shader.cachedThumbnail;

    if (!thumbnailVersionInitialized) {
      thumbnailVersionInitialized = true;
      knownThumbnailVersion = version;
      return;
    }
    if (version === knownThumbnailVersion) {
      return;
    }

    knownThumbnailVersion = version;
    refreshForNewVersion(cachedThumbnail);
  });

  function refreshForNewVersion(cachedThumbnail: string | undefined) {
    const generation = ++versionGeneration;
    // Drop the stale source so this render and the next hover refetch it.
    shaderCode = '';
    thumbnailGeneration++;
    if (versionRefreshTimeout !== null) {
      window.clearTimeout(versionRefreshTimeout);
      versionRefreshTimeout = null;
    }

    if (cachedThumbnail) {
      // Another explorer already rendered this version.
      clearEditErrorGrace();
      capturedImage = cachedThumbnail;
      compilationFailed = false;
      return;
    }

    versionRefreshTimeout = window.setTimeout(() => {
      versionRefreshTimeout = null;
      if (destroyed || generation !== versionGeneration) {
        return;
      }

      const isCurrent = () => !destroyed && generation === versionGeneration;
      const render = () => {
        void thumbnailRenderQueue.enqueue(queueId, async () => {
          // Errors are expected while typing: keep the last good image until
          // the shader has stayed broken for the whole grace period.
          const keepPreviousImage = Boolean(capturedImage) && !compilationFailed;
          lastThumbnailRenderSucceeded = null;
          await fetchShaderCode(isCurrent, { keepPreviousImage });
          if (!isCurrent()) {
            return;
          }
          if (shaderCode) {
            await initializeRendering({ isCurrent, keepPreviousImage });
            if (!isCurrent()) {
              return;
            }
          }
          if (lastThumbnailRenderSucceeded === true) {
            clearEditErrorGrace();
          } else if (lastThumbnailRenderSucceeded === false && keepPreviousImage) {
            startEditErrorGrace();
          }
        });
      };

      // Only spend a render on cards near the viewport.
      stopVisibilityObserver?.();
      hasStartedLoading = true;
      stopVisibilityObserver = previewContainer
        ? observeNearViewport(previewContainer, render)
        : (render(), null);
    }, VERSION_REFRESH_DELAY_MS);
  }

  // Hover rendering state
  let isHovering: boolean = $state(false);
  let hoverVisible: boolean = $state(false); // only true after first render frame
  let hoverCanvas: HTMLCanvasElement | null = null;
  let hoverOwnership: RendererOwnership | null = null;
  let hoverCanvasWrapper: HTMLDivElement | null = null;
  let hoverQueueId = '';
  let sharedHoverCleanup: (() => void) | null = null;

  onMount(async () => {
    queueId = `${shader.path}-${Date.now()}`;

    // Always show cached thumbnail as fallback — even during refreshAll
    // or forceFresh. If the fresh render fails, the old thumbnail stays visible.
    if (shader.cachedThumbnail && useCache) {
      capturedImage = shader.cachedThumbnail;
      compilationFailed = false;
    }

    // Render fresh if no cache or forcing a refresh
    if (!capturedImage || refreshAll || forceFresh) {
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
    if (!vscodeApi || !isCurrent()) {
      return;
    }

    if (renderThumbnail && canvas) {
      await thumbnailRenderQueue.enqueue(queueId, async () => {
        await fetchShaderCode(isCurrent);
        if (!isCurrent()) {
          return;
        }
        await initializeRendering();
      });
      return;
    }

    await fetchShaderCode(isCurrent);
  }

  async function fetchShaderCode(
    isCurrent: () => boolean = () => !destroyed,
    { keepPreviousImage = false }: { keepPreviousImage?: boolean } = {},
  ) {
    if (!vscodeApi || shaderCode || !isCurrent()) {
      return;
    }

    const controller = new AbortController();
    pendingShaderRequests.add(controller);
    try {
      const response = await requestShaderCode({
        vscodeApi,
        path: shader.path,
        target: window,
        signal: controller.signal,
      });

      if (!isCurrent()) {
        return;
      }

      if (response.scriptBundleError) {
        throw new Error(response.scriptBundleError);
      }

      shaderCode = response.code;
      previewPath = response.previewPath ?? shader.path;
      shaderConfig = response.config || null;
      shaderBuffers = response.buffers;
      shaderLanguage = response.language;
      customUniformDeclarations = response.customUniformDeclarations;
      customUniformInfo = response.customUniformInfo;
      slangModules = response.slangModules;
    } catch (err) {
      if (isCurrent()) {
        console.error('Failed to load shader code:', err);
        lastThumbnailRenderSucceeded = false;
        if (keepPreviousImage) {
          return;
        }
        capturedImage = '';
        compilationFailed = true;
        onCompilationFailed?.();
      }
    } finally {
      pendingShaderRequests.delete(controller);
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
        if (disposed) {
          return;
        }
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
      engine.setInputEnabled(false);

      const result = await engine.compileShaderPipeline(
        shaderCode,
        shaderConfig,
        previewPath,
        shaderBuffers,
        customUniformDeclarations,
        customUniformInfo,
        slangModules,
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
    if (!engine) {
      return;
    }

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

    if (
      language !== 'glsl'
      || !targetCanvas
      || targetCanvas === sharedGlslThumbnailCanvas
      || targetCanvas === sharedGlslHoverCanvas
    ) {
      return;
    }

    try {
      // Force WebGL context to be lost to free resources
      const gl = targetCanvas.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (err) {
      console.error('Failed to release WebGL context:', err);
    }
  }

  async function initializeRendering({
    keepPreviousImage = false,
    isCurrent: isResizeCurrent = () => true,
    retryLostContext = true,
  }: {
    keepPreviousImage?: boolean;
    isCurrent?: () => boolean;
    retryLostContext?: boolean;
  } = {}) {
    if (!shaderCode || !canvas || destroyed) {
      return;
    }

    const displayCanvas = canvas;
    const targetCanvas = shaderLanguage === 'glsl'
      ? getSharedGlslThumbnailCanvas(width, height)
      : displayCanvas;
    const generation = ++thumbnailGeneration;
    const isCurrent = () => (
      !destroyed
      && generation === thumbnailGeneration
      && canvas === displayCanvas
      && isResizeCurrent()
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
        if (getRenderingOwnership() === ownershipSlot.current) {
          renderingOwnership = null;
        }
        return;
      }

      const { ownership, result } = renderer;
      const { engine } = ownership;

      if (
        !result?.success
        && retryLostContext
        && shaderLanguage === 'glsl'
        && isLostSharedGlslThumbnailCanvas(targetCanvas)
      ) {
        ownership.dispose();
        if (getRenderingOwnership() === ownership) {
          renderingOwnership = null;
        }
        discardSharedGlslThumbnailCanvas(targetCanvas);
        await initializeRendering({
          keepPreviousImage,
          isCurrent: isResizeCurrent,
          retryLostContext: false,
        });
        return;
      }

      if (result?.success) {
        // Let next frame render to ensure it's fully initialized
        await new Promise((resolve) => setTimeout(resolve, 16));
        if (!isCurrent() || getRenderingOwnership() !== ownership || ownership.isDisposed()) {
          return;
        }
        
        // Capture the rendered frame as an image
        try {
          engine.renderForCapture();
          capturedImage = targetCanvas.toDataURL('image/png');
          compilationFailed = false;
          lastThumbnailRenderSucceeded = true;
          
          // Save thumbnail to cache on extension side
          if (vscodeApi && capturedImage) {
            vscodeApi.postMessage({
              type: 'saveThumbnail',
              path: shader.path,
              thumbnail: capturedImage,
              thumbnailVersion: shader.thumbnailVersion,
            });
          }
        } catch (err) {
          console.error('Failed to capture image for shader:', shader.name, err);
          lastThumbnailRenderSucceeded = false;
          if (!keepPreviousImage) {
            capturedImage = '';
            compilationFailed = true;
            onCompilationFailed?.();
          }
        }
        
        // Clean up rendering resources
        ownership.dispose();
        if (getRenderingOwnership() === ownership) {
          renderingOwnership = null;
        }
        
        // Keep shader code and buffers for hover rendering - don't clear them
      } else {
        console.error('Failed to compile shader:', shader.name, result?.errors);
        lastThumbnailRenderSucceeded = false;
        if (!keepPreviousImage) {
          capturedImage = '';
          compilationFailed = true;
          onCompilationFailed?.();
        }
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
      if (!isCurrent()) {
        return;
      }

      console.error('Failed to initialize rendering:', err);
      lastThumbnailRenderSucceeded = false;
      if (!keepPreviousImage) {
        capturedImage = '';
        compilationFailed = true;
        onCompilationFailed?.();
      }
    }
  }

  async function handleMouseEnter() {
    if (isHovering || !hoverCanvasWrapper || destroyed) {
      return;
    }

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
      if (!isCurrent()) {
        return;
      }

      // Wait for shader code to be loaded
      if (!shaderCode) {
        console.error('Failed to load shader code for hover');
        cleanupHoverRendering();
        return;
      }
    }

    if (shaderLanguage === 'glsl') {
      activeSharedGlslHoverCleanup?.();
    }

    const targetCanvas = shaderLanguage === 'glsl'
      ? getSharedGlslHoverCanvas(width, height)
      : document.createElement('canvas');
    targetCanvas.width = width;
    targetCanvas.height = height;
    targetCanvas.className = 'shader-preview hover-canvas';
    targetCanvas.style.pointerEvents = 'none';
    targetCanvas.tabIndex = -1;
    hoverCanvas = targetCanvas;

    if (shaderLanguage === 'glsl') {
      sharedHoverCleanup = () => {
        if (hoverCanvas === targetCanvas) {
          cleanupHoverRendering();
        }
      };
      activeSharedGlslHoverCleanup = sharedHoverCleanup;
    }

    // Append the canvas to the wrapper
    hoverCanvasWrapper.appendChild(targetCanvas);

    try {
      // Create a completely new rendering engine and pipeline, start the render loop
      const ownershipSlot: { current: RendererOwnership | null } = { current: null };
      hoverQueueId = `${queueId}-hover-${generation}`;
      const rendererSlot: {
        current: Awaited<ReturnType<typeof createShaderRenderer>>;
      } = { current: null };
      let rendererError: unknown;
      await hoverRenderQueue.enqueue(hoverQueueId, async () => {
        if (!isCurrent() || hoverCanvas !== targetCanvas) {
          return;
        }
        try {
          rendererSlot.current = await createShaderRenderer(
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
        } catch (error) {
          rendererError = error;
        }
      });
      if (rendererError) {
        throw rendererError;
      }
      const renderer = rendererSlot.current;
      if (!renderer || !isCurrent() || hoverCanvas !== targetCanvas) {
        if (getHoverOwnership() === ownershipSlot.current) {
          hoverOwnership = null;
        }
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
      if (!isCurrent()) {
        return;
      }

      console.error('Failed to initialize hover rendering:', err);
      cleanupHoverRendering();
    }
  }
  
  function handleMouseLeave() {
    if (!isHovering) {
      return;
    }
    
    cleanupHoverRendering();
  }
  
  function cleanupHoverRendering() {
    hoverGeneration++;
    isHovering = false;
    hoverVisible = false;

    if (hoverQueueId) {
      hoverRenderQueue.remove(hoverQueueId);
      hoverQueueId = '';
    }

    if (activeSharedGlslHoverCleanup === sharedHoverCleanup) {
      activeSharedGlslHoverCleanup = null;
    }
    sharedHoverCleanup = null;
    
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
    resizeGeneration++;
    versionGeneration++;
    if (resizeTimeout !== null) {
      window.clearTimeout(resizeTimeout);
    }
    if (versionRefreshTimeout !== null) {
      window.clearTimeout(versionRefreshTimeout);
    }
    clearEditErrorGrace();
    for (const controller of pendingShaderRequests) {
      controller.abort();
    }
    pendingShaderRequests.clear();
    stopVisibilityObserver?.();

    // Remove from queue if still waiting
    if (queueId) {
      thumbnailRenderQueue.remove(queueId);
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

  <canvas
    bind:this={canvas}
    {width}
    {height}
    class="shader-preview"
    class:offscreen={!!capturedImage && !compilationFailed}
  ></canvas>
  {#if capturedImage}
    <img
      src={capturedImage}
      alt={shader.name}
      {width}
      {height}
      class="shader-preview image-overlay"
    />
  {:else if compilationFailed}
    <div class="shader-error">
      <div class="error-icon" style="font-size:{errorIconSize}px">⚠️</div>
      <div class="error-message" style="font-size:{errorTextSize}px">Failed</div>
    </div>
  {:else}
    <div class="loading-placeholder"></div>
  {/if}
</div>

<style>
  .shader-preview-container {
    width: 100%;
    height: 100%;
    display: block;
    position: relative;
    background: #000;
    overflow: hidden;
  }

  .shader-preview {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
    pointer-events: none;
  }
  
  .loading-placeholder {
    width: 100%;
    height: 100%;
    background: #000;
    position: absolute;
    top: 0;
    left: 0;
  }

  .offscreen {
    opacity: 0;
  }

  .image-overlay {
    position: absolute;
    top: 0;
    left: 0;
  }

  .shader-error {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    background: #000;
    color: #fff;
    overflow: hidden;
    padding: 2px;
  }

  .error-icon {
    line-height: 1;
    opacity: 0.6;
    filter: grayscale(100%);
    flex-shrink: 0;
  }

  .error-message {
    line-height: 1;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    flex-shrink: 0;
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
    pointer-events: none;
  }
  
  .hover-canvas-wrapper.visible {
    display: block;
  }
  
  .hover-canvas-wrapper :global(canvas) {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
</style>
