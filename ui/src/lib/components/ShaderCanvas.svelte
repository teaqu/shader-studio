<script lang="ts">
  import { onMount } from "svelte";
  import {
    aspectRatioStore,
    type AspectRatioMode,
  } from "../stores/aspectRatioStore";
  import { resolutionStore, type ResolutionState } from "../stores/resolutionStore";
  import { AspectRatioCalculator } from "../util/AspectRatioCalculator";

  export let zoomLevel: number = 1.0;

  export let onCanvasReady: (canvas: HTMLCanvasElement) => void = () => {};
  export let onCanvasResize: (data: {
    width: number;
    height: number;
  }) => void = () => {};
  export let onCanvasClick: (event: MouseEvent) => void = () => {};
  export let isInspectorActive: boolean = false;

  let glCanvas: HTMLCanvasElement;
  let currentAspectMode: AspectRatioMode = "16:9";
  let currentResolution: ResolutionState = { scale: 1, forceBlackBackground: false, source: 'session' };
  let aspectRatioCalculator: AspectRatioCalculator;
  let resizeCanvasToFitAspectRatio: () => void;

  onMount(() => {
    const container = glCanvas.parentElement!;
    aspectRatioCalculator = new AspectRatioCalculator(container);

    resizeCanvasToFitAspectRatio = () => {
      const result = aspectRatioCalculator.calculate(
        currentAspectMode,
        currentResolution.scale,
        zoomLevel,
        currentResolution.customWidth,
        currentResolution.customHeight,
      );

      glCanvas.style.width = `${result.visualWidth}px`;
      glCanvas.style.height = `${result.visualHeight}px`;

      onCanvasResize({
        width: result.renderWidth,
        height: result.renderHeight,
      });
    };

    const resizeObserver = new ResizeObserver(resizeCanvasToFitAspectRatio);
    resizeObserver.observe(container);

    const unsubscribeAspectRatio = aspectRatioStore.subscribe((state) => {
      currentAspectMode = state.mode;
      resizeCanvasToFitAspectRatio();
    });

    const unsubscribeResolution = resolutionStore.subscribe((state) => {
      currentResolution = state;
      resizeCanvasToFitAspectRatio();
    });

    glCanvas.style.imageRendering = 'pixelated';

    resizeCanvasToFitAspectRatio();
    setupInputHandling();
    onCanvasReady(glCanvas);

    return () => {
      unsubscribeAspectRatio();
      unsubscribeResolution();
    };
  });

  let mouseDownPosition: { x: number; y: number } | null = null;
  const CLICK_THRESHOLD = 5; // pixels

  function setupInputHandling() {
    if (glCanvas) {
      // Make canvas focusable for keyboard events
      glCanvas.tabIndex = 0;
    }
  }

  function handleMouseDown(event: MouseEvent) {
    mouseDownPosition = { x: event.clientX, y: event.clientY };
    if (isInspectorActive) {
      glCanvas?.focus();
    }
    if (isInspectorActive) {
      event.stopPropagation();
      event.preventDefault();
    }
  }

  function handleClick(event: MouseEvent) {
    // Only trigger click if mouse hasn't moved much (not a drag)
    if (mouseDownPosition) {
      const dx = Math.abs(event.clientX - mouseDownPosition.x);
      const dy = Math.abs(event.clientY - mouseDownPosition.y);
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= CLICK_THRESHOLD) {
        onCanvasClick(event);
      }
    }
    mouseDownPosition = null;
  }

  $: if (glCanvas) {
    setupInputHandling();
  }

  // React to zoom level changes
  $: if (glCanvas && zoomLevel && resizeCanvasToFitAspectRatio) {
    resizeCanvasToFitAspectRatio();
  }
</script>

<div
  class="canvas-container"
  class:force-black-background={currentResolution.forceBlackBackground}
  role="button"
  tabindex="0"
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && onCanvasClick(e as unknown as MouseEvent)}
>
  <canvas bind:this={glCanvas} on:mousedown={handleMouseDown}></canvas>
</div>

<style>
  .canvas-container.force-black-background {
    background: #000;
  }

  canvas {
    image-rendering: pixelated;
    image-rendering: -webkit-optimize-contrast;
  }
</style>
