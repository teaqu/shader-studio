<script lang="ts">
  import { onMount } from "svelte";

  export let keyboardManager: any;
  export let mouseManager: any;

  export let onCanvasReady: (canvas: HTMLCanvasElement) => void = () => {};
  export let onCanvasResize: (data: {
    width: number;
    height: number;
  }) => void = () => {};

  let glCanvas: HTMLCanvasElement;

  onMount(() => {
    const container = glCanvas.parentElement!;

    function resizeCanvasToFit16x9() {
      const container = glCanvas.parentElement!;
      const styles = getComputedStyle(container);
      const paddingX =
        parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);

      const w = container.clientWidth - paddingX;
      const h = container.clientHeight;
      const aspect = 16 / 9;

      let newWidth, newHeight;
      if (w / h > aspect) {
        newHeight = h;
        newWidth = h * aspect;
      } else {
        newWidth = w;
        newHeight = w / aspect;
      }

      glCanvas.style.width = `${newWidth}px`;
      glCanvas.style.height = `${newHeight}px`;

      // Render at full device pixel ratio resolution
      const scaleFactor = window.devicePixelRatio;
      const renderWidth = Math.floor(newWidth * scaleFactor);
      const renderHeight = Math.floor(newHeight * scaleFactor);

      onCanvasResize({ width: renderWidth, height: renderHeight });
    }

    const resizeObserver = new ResizeObserver(resizeCanvasToFit16x9);
    resizeObserver.observe(container);
    resizeCanvasToFit16x9();
    setupInputHandling();
    onCanvasReady(glCanvas);
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
</script>

<div class="canvas-container">
  <canvas bind:this={glCanvas}></canvas>
</div>
