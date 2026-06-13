<svelte:options runes={true} />

<script lang="ts">
  interface Props {
    isActive?: boolean;
    mouseX?: number;
    mouseY?: number;
    canvasElement?: HTMLCanvasElement | null;
    canvasPosition?: { x: number; y: number } | null;
  }

  const LOUPE_SIZE = 120;
  const ZOOM = 8;
  const SRC_PIXELS = Math.ceil(LOUPE_SIZE / ZOOM);
  const OFFSET_X = 20;

  let {
    isActive = false,
    mouseX = 0,
    mouseY = 0,
    canvasElement = null,
    canvasPosition = null,
  }: Props = $props();

  let loupeCanvas = $state<HTMLCanvasElement | null>(null);

  let positionX = $derived(
    typeof window !== 'undefined' && mouseX + OFFSET_X + LOUPE_SIZE > window.innerWidth
      ? mouseX - LOUPE_SIZE - OFFSET_X
      : mouseX + OFFSET_X
  );

  let positionY = $derived(mouseY - LOUPE_SIZE - 12 < 0 ? mouseY + 20 : mouseY - LOUPE_SIZE - 12);

  $effect(() => {
    if (!loupeCanvas || !canvasElement || !isActive || !canvasPosition) {
      return;
    }

    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.imageSmoothingEnabled = false;

    const halfSrc = Math.floor(SRC_PIXELS / 2);
    const srcX = Math.floor(canvasPosition.x) - halfSrc;
    const srcY = Math.floor(canvasPosition.y) - halfSrc;

    ctx.drawImage(canvasElement, srcX, srcY, SRC_PIXELS, SRC_PIXELS, 0, 0, LOUPE_SIZE, LOUPE_SIZE);

    const center = LOUPE_SIZE / 2;
    const pixelSize = ZOOM;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(center - pixelSize / 2, center - pixelSize / 2, pixelSize, pixelSize);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center - 10, center);
    ctx.lineTo(center - pixelSize / 2 - 1, center);
    ctx.moveTo(center + pixelSize / 2 + 1, center);
    ctx.lineTo(center + 10, center);
    ctx.moveTo(center, center - 10);
    ctx.lineTo(center, center - pixelSize / 2 - 1);
    ctx.moveTo(center, center + pixelSize / 2 + 1);
    ctx.lineTo(center, center + 10);
    ctx.stroke();
  });
</script>

{#if isActive && canvasPosition !== null}
  <div class="loupe" style="left: {positionX}px; top: {positionY}px;">
    <canvas bind:this={loupeCanvas} width={LOUPE_SIZE} height={LOUPE_SIZE}></canvas>
  </div>
{/if}

<style>
  .loupe {
    position: fixed;
    box-sizing: border-box;
    width: 120px;
    height: 120px;
    border: 2px solid var(--vscode-panel-border, #454545);
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 10001;
  }

  canvas {
    display: block;
    image-rendering: pixelated;
    image-rendering: -webkit-optimize-contrast;
  }
</style>
