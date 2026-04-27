<script lang="ts">
  import { onMount } from "svelte";
  import {
    aspectRatioStore,
    type AspectRatioMode,
  } from "../stores/aspectRatioStore";
  import { resolutionStore, type ResolutionState } from "../stores/resolutionStore";
  import { AspectRatioCalculator } from "../util/AspectRatioCalculator";

  interface Props {
    zoomLevel?: number;
    onCanvasReady?: (canvas: HTMLCanvasElement) => void;
    onCanvasResize?: (data: { width: number; height: number }) => void;
    onCanvasClick?: (event: MouseEvent) => void;
    isInspectorActive?: boolean;
  }

  let {
    zoomLevel = 1.0,
    onCanvasReady = () => {},
    onCanvasResize = () => {},
    onCanvasClick = () => {},
    isInspectorActive = false,
  }: Props = $props();

  let glCanvas: HTMLCanvasElement;
  let currentAspectMode: AspectRatioMode = $state("16:9");
  let currentResolution: ResolutionState = $state({ scale: 1, forceBlackBackground: false, source: 'session' });
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
        currentResolution.width,
        currentResolution.height,
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
      resizeObserver.disconnect();
    };
  });

  let mouseDownPosition: { x: number; y: number } | null = $state(null);
  const CLICK_THRESHOLD = 5;

  function setupInputHandling() {
    if (glCanvas) {
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

  $effect(() => {
    if (glCanvas) {
      setupInputHandling();
    }
  });

  $effect(() => {
    if (glCanvas && zoomLevel && resizeCanvasToFitAspectRatio) {
      resizeCanvasToFitAspectRatio();
    }
  });
</script>

<div
  class="canvas-container"
  class:force-black-background={currentResolution.forceBlackBackground}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={(e) => e.key === 'Enter' && onCanvasClick(e as unknown as MouseEvent)}
>
  <canvas bind:this={glCanvas} onmousedown={handleMouseDown}></canvas>
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
