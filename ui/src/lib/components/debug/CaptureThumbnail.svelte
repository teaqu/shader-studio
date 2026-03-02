<script lang="ts">
  import { onMount } from 'svelte';

  export let pixels: Uint8ClampedArray;  // gridSize×gridSize×4 RGBA bytes
  export let size: number = 32;          // CSS display size in px

  let canvas: HTMLCanvasElement;
  let mounted = false;
  let hovered = false;

  $: gridPixelSize = Math.round(Math.sqrt(pixels.length / 4));
  $: canExpand = gridPixelSize > size;

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

<div
  class="thumb-wrap"
  on:mouseenter={() => hovered = true}
  on:mouseleave={() => hovered = false}
>
  <canvas
    bind:this={canvas}
    width={gridPixelSize}
    height={gridPixelSize}
    style="width: {size}px; height: {size}px; image-rendering: pixelated;"
    class="thumb"
  />
  {#if canExpand && hovered}
    <canvas
      width={gridPixelSize}
      height={gridPixelSize}
      style="width: {gridPixelSize}px; height: {gridPixelSize}px; image-rendering: pixelated;"
      class="thumb-expanded"
      use:drawExpanded={pixels}
    />
  {/if}
</div>

<script lang="ts" context="module">
  function drawExpanded(node: HTMLCanvasElement, pixels: Uint8ClampedArray) {
    render(node, pixels);
    return {
      update(pixels: Uint8ClampedArray) { render(node, pixels); }
    };
  }

  function render(canvas: HTMLCanvasElement, pixels: Uint8ClampedArray) {
    const size = Math.round(Math.sqrt(pixels.length / 4));
    if (size < 1) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = size;
    canvas.height = size;
    ctx.putImageData(new ImageData(pixels, size, size), 0, 0);
  }
</script>

<style>
  .thumb-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .thumb {
    display: block;
    border-radius: 2px;
  }

  .thumb-expanded {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    border-radius: 3px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
</style>
