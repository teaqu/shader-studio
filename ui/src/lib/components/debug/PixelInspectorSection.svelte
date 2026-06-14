<svelte:options runes={true} />

<script lang="ts">
  import { getInspectorState, requestLockAt } from '../../state/pixelInspectorState.svelte';

  interface Props {
    canvasElement?: HTMLCanvasElement | null;
    canvasWidth?: number;
    canvasHeight?: number;
  }

  let { canvasElement = null, canvasWidth = 0, canvasHeight = 0 }: Props = $props();

  const SIZE = 120;
  const ZOOM = 8;
  const SRC_PIXELS = Math.ceil(SIZE / ZOOM); // 15

  let zoomCanvas = $state<HTMLCanvasElement | null>(null);

  const inspector = $derived(getInspectorState());

  function handleZoomClick(event: MouseEvent) {
    if (!inspector.canvasPosition) return;
    const rect = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const cx = (event.clientX - rect.left) * (SIZE / rect.width);
    const cy = (event.clientY - rect.top) * (SIZE / rect.height);
    const halfSrc = Math.floor(SRC_PIXELS / 2);
    const srcX = Math.floor(inspector.canvasPosition.x) - halfSrc;
    const srcY = Math.floor(inspector.canvasPosition.y) - halfSrc;
    const clickedX = srcX + Math.floor(cx / ZOOM);
    const clickedY = srcY + Math.floor(cy / ZOOM);
    requestLockAt(clickedX, clickedY);
  }
  const hasPixel = $derived(
    inspector.canvasPosition !== null && inspector.pixelRGB !== null && inspector.fragCoord !== null
  );
  const rgb = $derived(inspector.pixelRGB);
  const fragCoord = $derived(inspector.fragCoord);

  const hexColor = $derived(
    rgb
      ? `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`
      : null
  );

  $effect(() => {
    if (!zoomCanvas) return;
    const ctx = zoomCanvas.getContext('2d');
    if (!ctx) return;

    if (!canvasElement || !inspector.canvasPosition) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      return;
    }

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;

    const halfSrc = Math.floor(SRC_PIXELS / 2);
    const srcX = Math.floor(inspector.canvasPosition.x) - halfSrc;
    const srcY = Math.floor(inspector.canvasPosition.y) - halfSrc;

    ctx.drawImage(canvasElement, srcX, srcY, SRC_PIXELS, SRC_PIXELS, 0, 0, SIZE, SIZE);

    const center = SIZE / 2;
    const pixelSize = ZOOM;

    function drawIndicator(strokeStyle: string, lineWidth: number) {
      ctx!.strokeStyle = strokeStyle;
      ctx!.lineWidth = lineWidth;
      ctx!.strokeRect(center - pixelSize / 2, center - pixelSize / 2, pixelSize, pixelSize);
      ctx!.beginPath();
      ctx!.moveTo(center - 10, center);
      ctx!.lineTo(center - pixelSize / 2 - 1, center);
      ctx!.moveTo(center + pixelSize / 2 + 1, center);
      ctx!.lineTo(center + 10, center);
      ctx!.moveTo(center, center - 10);
      ctx!.lineTo(center, center - pixelSize / 2 - 1);
      ctx!.moveTo(center, center + pixelSize / 2 + 1);
      ctx!.lineTo(center, center + 10);
      ctx!.stroke();
    }

    drawIndicator('rgba(0, 0, 0, 0.75)', 3);
    drawIndicator('rgba(255, 255, 255, 0.95)', 1);
  });
</script>

<div class="pixel-inspector-section">
  <canvas
    bind:this={zoomCanvas}
    width={SIZE}
    height={SIZE}
    class:locked={inspector.isLocked}
    class:empty={!hasPixel}
    onclick={hasPixel ? handleZoomClick : undefined}
    style={hasPixel ? 'cursor: crosshair;' : ''}
  ></canvas>

  {#if hasPixel && rgb && fragCoord}
    <div class="info-col">
      <div class="info-grid">
        <span class="info-label">RGB</span>
        <span class="info-val"><span class="swatch" style="background: rgb({rgb.r},{rgb.g},{rgb.b})"></span>{rgb.r}, {rgb.g}, {rgb.b}</span>
        <span class="info-label">Hex</span>
        <span class="info-val">{hexColor}</span>
        <span class="info-label">Float</span>
        <span class="info-val">{(rgb.r / 255).toFixed(3)}, {(rgb.g / 255).toFixed(3)}, {(rgb.b / 255).toFixed(3)}</span>
        <span class="info-label">fragCoord</span>
        <span class="info-val">{fragCoord.x.toFixed(1)}, {fragCoord.y.toFixed(1)}</span>
        {#if canvasWidth && canvasHeight}
          <span class="info-label">UV</span>
          <span class="info-val">{(fragCoord.x / canvasWidth).toFixed(3)}, {(fragCoord.y / canvasHeight).toFixed(3)}</span>
        {/if}
      </div>
    </div>
  {:else}
    <span class="hint-text">Hover over canvas<br>to inspect pixel</span>
  {/if}
</div>

<style>
  .pixel-inspector-section {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0 8px;
    margin-bottom: 4px;
  }

  canvas {
    flex-shrink: 0;
    display: block;
    width: 120px;
    height: 120px;
    image-rendering: pixelated;
    image-rendering: -webkit-optimize-contrast;
    border: 1px solid var(--vscode-panel-border, #454545);
  }

  canvas.locked {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  canvas.empty {
    opacity: 0.2;
    border-style: dashed;
  }

  .info-col {
    flex: 1;
    min-width: 0;
    align-self: center;
  }

  .info-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
    row-gap: 3px;
    align-items: center;
  }

  .info-label {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    white-space: nowrap;
  }

  .info-val {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--vscode-editor-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swatch {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    border: 1px solid var(--vscode-panel-border, #454545);
    border-radius: 2px;
  }

  .hint-text {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    font-size: 11px;
    line-height: 1.4;
    align-self: center;
  }
</style>
