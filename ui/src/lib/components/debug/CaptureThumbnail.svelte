<script lang="ts">
  import { onMount } from 'svelte';

  export let pixels: Uint8ClampedArray;  // gridSize×gridSize×4 RGBA bytes
  export let size: number = 40;          // CSS display size in px

  let canvas: HTMLCanvasElement;
  let mounted = false;

  $: gridPixelSize = Math.round(Math.sqrt(pixels.length / 4));

  function draw() {
    if (!canvas || !mounted || gridPixelSize < 1) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = gridPixelSize;
    canvas.height = gridPixelSize;
    ctx.putImageData(new ImageData(pixels, gridPixelSize, gridPixelSize), 0, 0);
  }

  onMount(() => { mounted = true; draw(); });
  $: pixels, draw();
</script>

<canvas
  bind:this={canvas}
  width={gridPixelSize}
  height={gridPixelSize}
  style="width: {size}px; height: {size}px; image-rendering: pixelated; display: block; border-radius: 2px; flex-shrink: 0;"
/>
