<svelte:options runes={true} />
<script lang="ts">
  import { decodeVolumeTexture, volumeSlice, type VolumeTextureData } from "@shader-studio/types";
  import { VolumePreviewRenderer } from "../../util/VolumePreviewRenderer";
  interface Props { path: string; controls?: boolean; thumbnail?: boolean }
  let { path, controls = false, thumbnail = false }: Props = $props();
  let volume = $state<VolumeTextureData | null>(null);
  let error = $state("");
  let axis = $state<"x" | "y" | "z">("z");
  let slice = $state(0);
  let canvas = $state<HTMLCanvasElement>();
  let renderer = $state<VolumePreviewRenderer | null>(null);
  let previewError = $state("");
  let mode = $state<"3d" | "slice">("3d");
  let yaw = $state(0.6);
  let pitch = $state(0.35);
  let zoom = $state(1);
  let drag: { id: number; x: number; y: number } | null = null;
  const show3d = $derived(controls && !thumbnail && mode === "3d");
  function resetView() {
    yaw = 0.6; pitch = 0.35; zoom = 1;
  }
  function rotate(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) {
      return;
    }
    yaw += (event.clientX - drag.x) * 0.015;
    pitch = Math.max(-1.5, Math.min(1.5, pitch + (event.clientY - drag.y) * 0.015));
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  const size = $derived(volume ? axis === "x" ? volume.width : axis === "y" ? volume.height : volume.depth : 1);
  $effect(() => {
    const url = path;
    const abort = new AbortController();
    volume = null;
    error = "";
    if (url) {
      void fetch(url, { signal: abort.signal }).then(async response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const decoded = decodeVolumeTexture(await response.arrayBuffer());
        if (!abort.signal.aborted) {
          resetView(); volume = decoded; slice = thumbnail ? Math.floor(decoded.depth / 2) : 0;
        }
      }).catch(reason => {
        if (!abort.signal.aborted) {
          error = reason instanceof Error ? reason.message : String(reason);
        }
      });
    }
    return () => abort.abort();
  });
  $effect(() => {
    if (!volume || !canvas) {
      return;
    }
    previewError = "";
    if (show3d) {
      try {
        const gpu = new VolumePreviewRenderer(canvas, volume);
        renderer = gpu;
        return () => {
          gpu.dispose(); renderer = null;
        };
      } catch (reason) {
        previewError = reason instanceof Error ? reason.message : String(reason);
      }
      return;
    }
    const image = volumeSlice(volume, axis, Math.min(slice, size - 1));
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context) {
      const pixels = new ImageData(Uint8ClampedArray.from(image.data), image.width, image.height);
      context.putImageData(pixels, 0, 0);
    }
  });
  $effect(() => {
    renderer?.draw(yaw, pitch, zoom);
  });
</script>
{#if error}
  <span role="alert">{error}</span>
{:else if volume}
  <div class="volume-preview" class:thumbnail>
    {#if !thumbnail}<span>{volume.width} × {volume.height} × {volume.depth} · {volume.channels === 1 ? "R8" : "RGBA8"}</span>{/if}
    {#if controls && !thumbnail}
      <div class="view-controls">
        <button type="button" aria-pressed={mode === "3d"} onclick={() => mode = "3d"}>3D</button>
        <button type="button" aria-pressed={mode === "slice"} onclick={() => mode = "slice"}>Slices</button>
      </div>
    {/if}
    {#key show3d}
      <canvas bind:this={canvas} class:interactive={show3d}
        aria-label={show3d ? "3D volume preview; drag to rotate" : "Volume slice preview"}
        onpointerdown={event => {
          if (show3d) {
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvas?.setPointerCapture?.(event.pointerId);
          }
        }}
        onpointermove={rotate} onpointerup={() => drag = null} onpointercancel={() => drag = null} onlostpointercapture={() => drag = null}></canvas>
    {/key}
    {#if previewError}<span role="alert">{previewError}</span>{/if}
    {#if show3d}
      <span>Drag to rotate · Density preview</span>
      <div class="view-controls">
        <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onclick={() => zoom = Math.max(0.5, zoom - 0.2)}>−</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 2.5} onclick={() => zoom = Math.min(2.5, zoom + 0.2)}>+</button>
        <button type="button" onclick={resetView}>Reset view</button>
      </div>
    {:else if controls}
      <label>Slice axis <select bind:value={axis} onchange={() => slice = 0}><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
      <label>Slice {Math.min(slice, size - 1)} <input type="range" min="0" max={size - 1} step="1" bind:value={slice} /></label>
    {/if}
  </div>
{:else if path}
  <span>Loading volume…</span>
{/if}
<style>
  .volume-preview { display: flex; flex-direction: column; gap: 6px; max-width: 240px; }
  .thumbnail { width: 100%; height: 100%; max-width: none; gap: 0; }
  .thumbnail canvas { height: 100%; max-height: 100%; }
  canvas { width: 100%; max-height: 160px; object-fit: contain; image-rendering: pixelated; }
  .interactive { cursor: grab; touch-action: none; image-rendering: auto; }
  .interactive:active { cursor: grabbing; }
  .view-controls { display: flex; gap: 6px; }
  button { background: var(--vscode-button-secondaryBackground, #343434); color: var(--vscode-button-secondaryForeground, #eee); border: 1px solid transparent; border-radius: 3px; padding: 3px 8px; cursor: pointer; }
  button[aria-pressed="true"] { border-color: var(--vscode-focusBorder, #579bdb); }
  button:disabled { opacity: 0.5; cursor: default; }
  span { font-size: 11px; }
  label { display: flex; gap: 8px; align-items: center; }
</style>
