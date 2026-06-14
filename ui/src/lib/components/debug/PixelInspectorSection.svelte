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
  // Only zoom levels that divide SIZE evenly — guarantees 1 source pixel = exactly zoomLevel canvas pixels
  const ZOOM_LEVELS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30];
  const DEFAULT_ZOOM = 8;
  const DRAG_THRESHOLD = 3;

  let zoomLevel = $state(DEFAULT_ZOOM);
  const srcPixels = $derived(SIZE / zoomLevel);

  let zoomCanvas = $state<HTMLCanvasElement | null>(null);
  let showZoomLabel = $state(false);
  let zoomLabelTimer: ReturnType<typeof setTimeout> | null = null;

  const inspector = $derived(getInspectorState());

  let dragActive = false;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartSrcX = 0;
  let dragStartSrcY = 0;
  let hasDragged = false;
  let isDragging = $state(false);

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(zoomLevel);
    const step = event.deltaY > 0 ? -1 : 1;
    const newIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + step));
    zoomLevel = ZOOM_LEVELS[newIdx];
    showZoomLabel = true;
    if (zoomLabelTimer !== null) {
      clearTimeout(zoomLabelTimer);
    }
    zoomLabelTimer = setTimeout(() => {
      showZoomLabel = false;
    }, 1200);
  }

  function handlePointerDown(event: PointerEvent) {
    if (!hasPixel || !inspector.canvasPosition) {
      return;
    }
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
    dragActive = true;
    hasDragged = false;
    dragStartClientX = event.clientX;
    dragStartClientY = event.clientY;
    dragStartSrcX = inspector.canvasPosition.x;
    dragStartSrcY = inspector.canvasPosition.y;
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragActive) {
      return;
    }
    const node = event.currentTarget as HTMLCanvasElement;
    const rect = node.getBoundingClientRect();
    const scale = SIZE / (rect.width || SIZE);
    const dx = (event.clientX - dragStartClientX) * scale;
    const dy = (event.clientY - dragStartClientY) * scale;
    if (!hasDragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      hasDragged = true;
      isDragging = true;
    }
    if (hasDragged) {
      requestLockAt(
        Math.round(dragStartSrcX - dx / zoomLevel),
        Math.round(dragStartSrcY - dy / zoomLevel)
      );
    }
  }

  function handlePointerUp(event: PointerEvent) {
    if (!dragActive) {
      return;
    }
    dragActive = false;
    isDragging = false;
    if (!hasDragged) {
      handleClickJump(event);
    }
    hasDragged = false;
  }

  function handleClickJump(event: PointerEvent) {
    if (!inspector.canvasPosition) {
      return;
    }
    const node = event.currentTarget as HTMLCanvasElement;
    const rect = node.getBoundingClientRect();
    const cx = (event.clientX - rect.left) * (SIZE / (rect.width || SIZE));
    const cy = (event.clientY - rect.top) * (SIZE / (rect.height || SIZE));
    const halfSrc = Math.floor(srcPixels / 2);
    const srcX = Math.floor(inspector.canvasPosition.x) - halfSrc;
    const srcY = Math.floor(inspector.canvasPosition.y) - halfSrc;
    requestLockAt(
      srcX + Math.floor(cx / zoomLevel),
      srcY + Math.floor(cy / zoomLevel)
    );
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
    return () => {
      if (zoomLabelTimer !== null) {
        clearTimeout(zoomLabelTimer);
      }
    };
  });

  $effect(() => {
    if (!zoomCanvas) {
      return;
    }
    const ctx = zoomCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    if (!canvasElement || !inspector.canvasPosition) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      return;
    }

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = false;

    const halfSrc = Math.floor(srcPixels / 2);
    const srcX = Math.floor(inspector.canvasPosition.x) - halfSrc;
    const srcY = Math.floor(inspector.canvasPosition.y) - halfSrc;

    ctx.drawImage(canvasElement, srcX, srcY, srcPixels, srcPixels, 0, 0, SIZE, SIZE);

    // Crosshair: highlight exactly the center source pixel.
    // Because ZOOM_LEVELS always divide SIZE, zoomLevel === SIZE / srcPixels exactly.
    const pixelSize = zoomLevel;
    const left = halfSrc * pixelSize;
    const top = halfSrc * pixelSize;
    const midX = left + pixelSize / 2;
    const midY = top + pixelSize / 2;
    const arm = Math.max(4, pixelSize);

    function drawIndicator(strokeStyle: string, lineWidth: number) {
      ctx!.strokeStyle = strokeStyle;
      ctx!.lineWidth = lineWidth;
      ctx!.strokeRect(left, top, pixelSize, pixelSize);
      ctx!.beginPath();
      ctx!.moveTo(midX, top - arm);
      ctx!.lineTo(midX, top - 1);
      ctx!.moveTo(midX, top + pixelSize + 1);
      ctx!.lineTo(midX, top + pixelSize + arm);
      ctx!.moveTo(left - arm, midY);
      ctx!.lineTo(left - 1, midY);
      ctx!.moveTo(left + pixelSize + 1, midY);
      ctx!.lineTo(left + pixelSize + arm, midY);
      ctx!.stroke();
    }

    drawIndicator('rgba(0, 0, 0, 0.75)', 3);
    drawIndicator('rgba(255, 255, 255, 0.95)', 1);
  });
</script>

<div class="pixel-inspector-section">
  <div class="canvas-wrapper">
    <canvas
      bind:this={zoomCanvas}
      width={SIZE}
      height={SIZE}
      class:locked={inspector.isLocked}
      class:empty={!hasPixel}
      onpointerdown={hasPixel ? handlePointerDown : undefined}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
      onwheel={handleWheel}
      style={!hasPixel ? '' : isDragging ? 'cursor: grabbing;' : 'cursor: crosshair;'}
    ></canvas>
    {#if showZoomLabel}
      <span class="zoom-label">{zoomLevel}×</span>
    {/if}
  </div>

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

  .canvas-wrapper {
    position: relative;
    flex-shrink: 0;
  }

  canvas {
    display: block;
    width: 120px;
    height: 120px;
    image-rendering: pixelated;
    image-rendering: -webkit-optimize-contrast;
    border: 1px solid var(--vscode-panel-border, #454545);
    touch-action: none;
  }

  canvas.locked {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  canvas.empty {
    opacity: 0.2;
    border-style: dashed;
  }

  .zoom-label {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    padding: 1px 4px;
    border-radius: 2px;
    pointer-events: none;
    user-select: none;
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
