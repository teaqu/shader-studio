<script lang="ts">
  import { onMount } from "svelte";
  import { aspectRatioStore, type AspectRatioMode } from "../stores/aspectRatioStore";
  import { qualityStore, type QualityMode } from "../stores/qualityStore";
  import { AspectRatioCalculator } from "../util/AspectRatioCalculator";

  export let keyboardManager: any;
  export let mouseManager: any;
  export let zoomLevel: number = 1.0;

  export let onCanvasReady: (canvas: HTMLCanvasElement) => void = () => {};
  export let onCanvasResize: (data: {
    width: number;
    height: number;
  }) => void = () => {};

  let glCanvas: HTMLCanvasElement;
  let currentAspectMode: AspectRatioMode = '16:9';
  let currentQuality: QualityMode = 'HD';
  let aspectRatioCalculator: AspectRatioCalculator;
  let resizeCanvasToFitAspectRatio: () => void;

  onMount(() => {
    const container = glCanvas.parentElement!;
    aspectRatioCalculator = new AspectRatioCalculator(container);

    resizeCanvasToFitAspectRatio = () => {
      const result = aspectRatioCalculator.calculate(
        currentAspectMode,
        currentQuality,
        zoomLevel
      );

      glCanvas.style.width = `${result.visualWidth}px`;
      glCanvas.style.height = `${result.visualHeight}px`;

      onCanvasResize({ 
        width: result.renderWidth, 
        height: result.renderHeight 
      });
    };

    const resizeObserver = new ResizeObserver(resizeCanvasToFitAspectRatio);
    resizeObserver.observe(container);
    
    const unsubscribeAspectRatio = aspectRatioStore.subscribe(state => {
      currentAspectMode = state.mode;
      resizeCanvasToFitAspectRatio();
    });
    
    const unsubscribeQuality = qualityStore.subscribe(state => {
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

  function setupInputHandling() {
    if (keyboardManager && mouseManager && glCanvas) {
      keyboardManager.setupEventListeners(glCanvas);
      mouseManager.setupEventListeners(glCanvas);
      // Make canvas focusable for keyboard events
      glCanvas.tabIndex = 0;
      glCanvas.focus();
    }
  }

  $: if (keyboardManager && mouseManager && glCanvas) {
    setupInputHandling();
  }

  // React to zoom level changes
  $: if (glCanvas && zoomLevel && resizeCanvasToFitAspectRatio) {
    resizeCanvasToFitAspectRatio();
  }
</script>

<div class="canvas-container">
  <canvas bind:this={glCanvas}></canvas>
</div>
