<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    pixels: Uint8ClampedArray;
    gridWidth: number;
    gridHeight: number;
    maxSize?: number;
  }

  let {
    pixels,
    gridWidth,
    gridHeight,
    maxSize = 32,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let mounted = $state(false);
  let hovered = $state(false);

  let displayWidth = $derived(gridWidth >= gridHeight
    ? maxSize
    : Math.round(maxSize * (gridWidth / gridHeight)));
  let displayHeight = $derived(gridHeight >= gridWidth
    ? maxSize
    : Math.round(maxSize * (gridHeight / gridWidth)));
  let canExpand = $derived(gridWidth > displayWidth || gridHeight > displayHeight);

  function draw() {
    if (!canvas || !mounted || gridWidth < 1 || gridHeight < 1) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    canvas.width = gridWidth;
    canvas.height = gridHeight;
    ctx.putImageData(new ImageData(pixels, gridWidth, gridHeight), 0, 0);
  }

  onMount(() => {
    mounted = true; draw();
  });

  $effect(() => {
    pixels; gridWidth; gridHeight;
    draw();
  });
</script>

<div
  class="thumb-wrap"
  role="img"
  aria-label="Captured variable thumbnail"
  onmouseenter={() => hovered = true}
  onmouseleave={() => hovered = false}
>
  <canvas
    bind:this={canvas}
    width={gridWidth}
    height={gridHeight}
    style="width: {displayWidth}px; height: {displayHeight}px; image-rendering: pixelated;"
    class="thumb"
  ></canvas>
  {#if canExpand && hovered}
    <canvas
      width={gridWidth}
      height={gridHeight}
      style="width: {gridWidth}px; height: {gridHeight}px; image-rendering: pixelated;"
      class="thumb-expanded"
      use:drawExpanded={{ pixels, gridWidth, gridHeight }}
    ></canvas>
  {/if}
</div>

<script lang="ts" module>
  function drawExpanded(node: HTMLCanvasElement, params: { pixels: Uint8ClampedArray; gridWidth: number; gridHeight: number }) {
    render(node, params);
    return {
      update(params: { pixels: Uint8ClampedArray; gridWidth: number; gridHeight: number }) {
        render(node, params);
      }
    };
  }

  function render(canvas: HTMLCanvasElement, { pixels, gridWidth, gridHeight }: { pixels: Uint8ClampedArray; gridWidth: number; gridHeight: number }) {
    if (gridWidth < 1 || gridHeight < 1) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    canvas.width = gridWidth;
    canvas.height = gridHeight;
    ctx.putImageData(new ImageData(pixels, gridWidth, gridHeight), 0, 0);
  }
</script>

<style>
  .thumb-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .thumb {
    display: block;
  }

  .thumb-expanded {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
</style>
