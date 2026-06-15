<svelte:options runes={true} />

<script lang="ts">
  import { getInspectorState, requestLockAt } from '../../state/pixelInspectorState.svelte';
  import { debugPanelStore } from '../../stores/debugPanelStore';

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
  let showConfigMenu = $state(false);

  function handleWindowClick(event: MouseEvent) {
    if (!showConfigMenu) {
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest('.config-btn, .config-menu')) {
      return;
    }
    showConfigMenu = false;
  }

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

<div class="section-heading">
  <div class="section-title">Pixel Inspector</div>
  <div class="config">
    <button
      class="config-btn"
      class:active={showConfigMenu}
      type="button"
      aria-label="Inspector settings"
      aria-haspopup="menu"
      aria-expanded={showConfigMenu}
      title="Settings"
      onclick={() => (showConfigMenu = !showConfigMenu)}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
        />
        <path
          fill="currentColor"
          d="M6.94 1.5a.75.75 0 0 0-.73.57l-.28 1.15a4.6 4.6 0 0 0-.9.52l-1.12-.4a.75.75 0 0 0-.9.34l-1.06 1.83a.75.75 0 0 0 .17.95l.9.75a4.7 4.7 0 0 0 0 1.04l-.9.75a.75.75 0 0 0-.17.95l1.06 1.83c.18.31.56.45.9.34l1.12-.4c.28.21.58.39.9.52l.28 1.15c.08.33.38.57.73.57h2.12a.75.75 0 0 0 .73-.57l.28-1.15c.32-.13.62-.31.9-.52l1.12.4c.34.11.72-.03.9-.34l1.06-1.83a.75.75 0 0 0-.17-.95l-.9-.75a4.7 4.7 0 0 0 0-1.04l.9-.75a.75.75 0 0 0 .17-.95l-1.06-1.83a.75.75 0 0 0-.9-.34l-1.12.4a4.6 4.6 0 0 0-.9-.52l-.28-1.15a.75.75 0 0 0-.73-.57H6.94Zm.59 1.5h.94l.23.96c.05.22.21.4.42.47.36.12.69.31.98.56.17.15.41.19.62.11l.94-.33.47.81-.76.63a.55.55 0 0 0-.19.59c.05.19.07.38.07.57s-.02.38-.07.57c-.05.22.02.45.19.59l.76.63-.47.81-.94-.33a.55.55 0 0 0-.62.11c-.29.25-.62.44-.98.56a.55.55 0 0 0-.42.47l-.23.96h-.94l-.23-.96a.55.55 0 0 0-.42-.47 3.1 3.1 0 0 1-.98-.56.55.55 0 0 0-.62-.11l-.94.33-.47-.81.76-.63c.17-.14.24-.37.19-.59a2.3 2.3 0 0 1 0-1.14c.05-.22-.02-.45-.19-.59l-.76-.63.47-.81.94.33c.21.08.45.04.62-.11.29-.25.62-.44.98-.56a.55.55 0 0 0 .42-.47l.23-.96Z"
        />
      </svg>
    </button>

    {#if showConfigMenu}
      <div class="config-menu" role="menu">
        <label class="marker-toggle">
          <input
            type="checkbox"
            checked={$debugPanelStore.isPixelMarkerEnabled}
            onchange={(e) => debugPanelStore.setPixelMarkerEnabled(e.currentTarget.checked)}
          />
          Marker on canvas
        </label>
      </div>
    {/if}
  </div>
</div>

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

<svelte:window onclick={handleWindowClick} />

<style>
  .marker-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-foreground);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  .marker-toggle input {
    margin: 0;
    cursor: pointer;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .section-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
  }

  .config {
    position: relative;
    display: flex;
  }

  .config-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    opacity: 0.7;
    cursor: pointer;
    transition: background 0.12s ease, opacity 0.12s ease;
  }

  .config-btn:hover,
  .config-btn.active {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
  }

  .config-btn svg {
    display: block;
  }

  .config-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 2;
    padding: 6px 8px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background, #252526));
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, #454545));
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  }

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
