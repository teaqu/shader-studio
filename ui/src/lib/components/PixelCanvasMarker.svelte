<svelte:options runes={true} />

<script lang="ts">
  import { getInspectorState } from '../state/pixelInspectorState.svelte';
  import { debugPanelStore } from '../stores/debugPanelStore';
  import { computeMarkerScreenPos } from '../util/pixelMarkerPosition';

  interface Props {
    glCanvas?: HTMLCanvasElement | null;
    container?: HTMLElement | null;
  }

  let { glCanvas = null, container = null }: Props = $props();

  let markerCanvas = $state<HTMLCanvasElement | null>(null);

  const inspector = $derived(getInspectorState());
  const markerEnabled = $derived($debugPanelStore.isPixelMarkerEnabled);

  function syncSize() {
    if (!markerCanvas || !container) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth || 0;
    const h = container.clientHeight || 0;
    markerCanvas.width = Math.round(w * dpr);
    markerCanvas.height = Math.round(h * dpr);
    markerCanvas.style.width = `${w}px`;
    markerCanvas.style.height = `${h}px`;
  }

  function draw() {
    if (!markerCanvas) {
      return;
    }
    const ctx = markerCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    const cssW = markerCanvas.width / dpr;
    const cssH = markerCanvas.height / dpr;
    ctx.clearRect(0, 0, cssW, cssH);

    const insp = getInspectorState();
    if (
      !markerEnabled ||
      !insp.isEnabled ||
      !insp.isLocked ||
      !insp.canvasPosition ||
      !glCanvas ||
      !container
    ) {
      return;
    }

    const pos = computeMarkerScreenPos(
      glCanvas.getBoundingClientRect(),
      container.getBoundingClientRect(),
      glCanvas.width,
      glCanvas.height,
      insp.canvasPosition,
    );
    if (!pos) {
      return;
    }

    drawCrosshair(ctx, pos.x, pos.y, pos.pixelSize);
  }

  // Re-size and redraw when the container resizes.
  $effect(() => {
    if (!markerCanvas || !container) {
      return;
    }
    const ro = new ResizeObserver(() => {
      syncSize();
      draw();
    });
    ro.observe(container);
    syncSize();
    draw();
    return () => ro.disconnect();
  });

  // Redraw when the inspected point or toggle changes.
  $effect(() => {
    // Track reactive deps, then draw imperatively.
    void inspector;
    void markerEnabled;
    draw();
  });

  // Matches the zoom view's indicator (PixelInspectorSection): box around the
  // exact pixel + 4 arms with a 1px gap, arm length scaling with the pixel size.
  function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    pixelSize: number,
  ) {
    const midX = left + pixelSize / 2;
    const midY = top + pixelSize / 2;
    const arm = Math.max(7, pixelSize * 1.25);

    // Black outline first, then white on top — always visible on any background.
    function drawIndicator(strokeStyle: string, lineWidth: number) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(left, top, pixelSize, pixelSize);
      ctx.beginPath();
      ctx.moveTo(midX, top - arm);
      ctx.lineTo(midX, top - 1);
      ctx.moveTo(midX, top + pixelSize + 1);
      ctx.lineTo(midX, top + pixelSize + arm);
      ctx.moveTo(left - arm, midY);
      ctx.lineTo(left - 1, midY);
      ctx.moveTo(left + pixelSize + 1, midY);
      ctx.lineTo(left + pixelSize + arm, midY);
      ctx.stroke();
    }

    drawIndicator('rgba(0, 0, 0, 0.75)', 3);
    drawIndicator('rgba(255, 255, 255, 0.95)', 1);
  }
</script>

<canvas bind:this={markerCanvas} class="pixel-canvas-marker"></canvas>

<style>
  .pixel-canvas-marker {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    pointer-events: none;
    z-index: 5;
  }
</style>
