<script lang="ts">
  import { onMount } from "svelte";
  import {
    aspectRatioStore,
    type AspectRatioMode,
  } from "../stores/aspectRatioStore";
  import { qualityStore, type QualityMode } from "../stores/qualityStore";
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
  let currentQuality: QualityMode = "HD";
  let aspectRatioCalculator: AspectRatioCalculator;
  let resizeCanvasToFitAspectRatio: () => void;

  onMount(() => {
    const container = glCanvas.parentElement!;
    aspectRatioCalculator = new AspectRatioCalculator(container);

    resizeCanvasToFitAspectRatio = () => {
      const result = aspectRatioCalculator.calculate(
        currentAspectMode,
        currentQuality,
        zoomLevel,
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

    const unsubscribeQuality = qualityStore.subscribe((state) => {
      currentQuality = state.mode;
      resizeCanvasToFitAspectRatio();
    });

    resizeCanvasToFitAspectRatio();
    setupInputHandling();
    onCanvasReady(glCanvas);

    return () => {
      unsubscribeAspectRatio();
      unsubscribeQuality();
    };
  });

  let mouseDownPosition: { x: number; y: number } | null = null;
  const CLICK_THRESHOLD = 5; // pixels

  function setupInputHandling() {
    if (glCanvas) {
      // Make canvas focusable for keyboard events
      glCanvas.tabIndex = 0;
      glCanvas.focus();
    }
  }

  function handleMouseDown(event: MouseEvent) {
    mouseDownPosition = { x: event.clientX, y: event.clientY };
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
  role="button"
  tabindex="0"
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && handleClick(e)}
>
  <canvas bind:this={glCanvas} on:mousedown={handleMouseDown}></canvas>
</div>
