<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    clearVariablePreview,
    setVariablePreview,
  } from '../../state/variablePreviewState.svelte';
  import type { VariablePreviewRequest } from '../../state/variablePreviewState.svelte';

  interface Props {
    pixels: Uint8ClampedArray;
    gridWidth: number;
    gridHeight: number;
    varName: string;
    varType: string;
    debugLine: number;
    activeBufferName: string;
    filePath: string | null;
    maxSize?: number;
  }

  let {
    pixels,
    gridWidth,
    gridHeight,
    varName,
    varType,
    debugLine,
    activeBufferName,
    filePath,
    maxSize = 32,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let mounted = $state(false);
  let hovered = $state(false);
  let focused = $state(false);
  let previewActive = $state(false);
  let displayWidth = $derived(gridWidth >= gridHeight
    ? maxSize
    : Math.round(maxSize * (gridWidth / gridHeight)));
  let displayHeight = $derived(gridHeight >= gridWidth
    ? maxSize
    : Math.round(maxSize * (gridHeight / gridWidth)));
  let canExpand = $derived(gridWidth > displayWidth || gridHeight > displayHeight);
  let previewRequest: VariablePreviewRequest = $derived({
    varName,
    varType,
    debugLine,
    activeBufferName,
    filePath,
  });

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
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), gridWidth, gridHeight), 0, 0);
  }

  function syncPreviewActive() {
    const nextActive = hovered || focused;
    if (previewActive === nextActive) {
      return;
    }
    previewActive = nextActive;
    if (previewActive) {
      setVariablePreview(previewRequest);
    } else {
      clearVariablePreview(varName, varType);
    }
  }

  function setHovered(value: boolean) {
    hovered = value;
    syncPreviewActive();
  }

  function setFocused(value: boolean) {
    focused = value;
    syncPreviewActive();
  }

  onMount(() => {
    mounted = true; draw();
  });

  onDestroy(() => {
    clearVariablePreview(varName, varType);
  });

  $effect(() => {
    pixels; gridWidth; gridHeight;
    draw();
  });
</script>

<button
  type="button"
  class="thumb-wrap"
  aria-label="Captured variable thumbnail"
  onmouseenter={() => setHovered(true)}
  onmouseleave={() => setHovered(false)}
  onfocus={() => setFocused(true)}
  onblur={() => setFocused(false)}
>
  <canvas
    bind:this={canvas}
    width={gridWidth}
    height={gridHeight}
    style="width: {displayWidth}px; height: {displayHeight}px; image-rendering: pixelated;"
    class="thumb"
  ></canvas>
  {#if canExpand && previewActive}
    <canvas
      width={gridWidth}
      height={gridHeight}
      style="width: {gridWidth}px; height: {gridHeight}px; image-rendering: pixelated;"
      class="thumb-expanded"
      use:drawExpanded={{ pixels, gridWidth, gridHeight }}
    ></canvas>
  {/if}
</button>

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
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), gridWidth, gridHeight), 0, 0);
  }
</script>

<style>
  .thumb-wrap {
    position: relative;
    flex-shrink: 0;
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
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
