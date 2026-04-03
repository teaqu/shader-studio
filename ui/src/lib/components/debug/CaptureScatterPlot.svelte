<script lang="ts">
  import { onMount } from 'svelte';

  export let xData: Float32Array;
  export let yData: Float32Array;
  export let xMin: number;
  export let xMax: number;
  export let yMin: number;
  export let yMax: number;

  const W = 160;
  const H = 120;
  const PAD = 10;

  let canvas: HTMLCanvasElement;
  let mounted = false;

  function draw() {
    if (!canvas || !mounted) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);

    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const tx = (v: number) => PAD + (v - xMin) / xRange * (W - PAD * 2);
    const ty = (v: number) => H - PAD - (v - yMin) / yRange * (H - PAD * 2);

    // Zero-crossing guide lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    if (xMin < 0 && xMax > 0) {
      const zx = tx(0);
      ctx.beginPath(); ctx.moveTo(zx, PAD); ctx.lineTo(zx, H - PAD); ctx.stroke();
    }
    if (yMin < 0 && yMax > 0) {
      const zy = ty(0);
      ctx.beginPath(); ctx.moveTo(PAD, zy); ctx.lineTo(W - PAD, zy); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(PAD, PAD, W - PAD * 2, H - PAD * 2);

    // Dots
    ctx.fillStyle = 'rgba(97, 175, 239, 0.55)';
    for (let i = 0; i < xData.length; i++) {
      const x = tx(xData[i]);
      const y = ty(yData[i]);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  onMount(() => {
    mounted = true; draw(); 
  });
  $: xData, yData, xMin, xMax, yMin, yMax, draw();

  function fmt(n: number): string {
    if (Math.abs(n) >= 1000) {
      return n.toFixed(0);
    }
    if (Math.abs(n) >= 10) {
      return n.toFixed(1);
    }
    return n.toFixed(3);
  }
</script>

<div class="scatter-wrap">
  <canvas
    bind:this={canvas}
    width={W}
    height={H}
    style="width: 100%; height: auto; display: block;"
  ></canvas>
  <div class="axis-labels">
    <span><span class="ax">x</span> {fmt(xMin)} – {fmt(xMax)}</span>
    <span><span class="ax">y</span> {fmt(yMin)} – {fmt(yMax)}</span>
  </div>
</div>

<style>
  .scatter-wrap {
    width: 100%;
    margin-top: 4px;
  }

  canvas {
    border-radius: 2px;
  }

  .axis-labels {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-descriptionForeground);
    padding: 2px 0;
  }

  .ax {
    color: var(--vscode-editor-foreground);
    font-weight: 600;
  }
</style>
