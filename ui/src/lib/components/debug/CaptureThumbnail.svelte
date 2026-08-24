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
    previewEnabled?: boolean;
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
    previewEnabled = true,
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let mounted = $state(false);
  let hovered = $state(false);
  let focused = $state(false);
  let previewActive = $state(false);
  const THUMBNAIL_SIZE = 32;
  let displayMaxSize = $derived(Math.max(gridWidth, gridHeight) >= 64
    ? Math.max(gridWidth, gridHeight)
    : THUMBNAIL_SIZE);
  let displayWidth = $derived(gridWidth >= gridHeight
    ? displayMaxSize
    : Math.round(displayMaxSize * (gridWidth / gridHeight)));
  let displayHeight = $derived(gridHeight >= gridWidth
    ? displayMaxSize
    : Math.round(displayMaxSize * (gridHeight / gridWidth)));
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
    if (!previewEnabled) {
      return;
    }
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
    if (previewEnabled) {
      clearVariablePreview(varName, varType);
    }
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
</button>

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

</style>
