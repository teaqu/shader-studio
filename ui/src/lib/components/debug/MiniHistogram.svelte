<script lang="ts">
  export let bins: number[];
  export let min: number;
  export let max: number;
  export let color: string = 'var(--vscode-charts-blue, #4a9eff)';

  const HEIGHT = 48;
  const BAR_GAP = 1;

  $: maxBin = Math.max(...bins, 1);
  $: totalSamples = bins.reduce((a, b) => a + b, 0);
  $: barWidth = bins.length > 0 ? (100 / bins.length) : 0;
  $: hasZeroCrossing = min < 0 && max > 0;
  $: zeroFraction = hasZeroCrossing ? (-min) / (max - min) : null;

  let hoveredBin: number | null = null;

  function formatNum(n: number): string {
    if (Math.abs(n) >= 1000) {
      return n.toFixed(0);
    }
    if (Math.abs(n) >= 10) {
      return n.toFixed(1);
    }
    return n.toFixed(3);
  }

  function handleMouseMove(event: MouseEvent) {
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const i = Math.floor(x * bins.length);
    hoveredBin = i >= 0 && i < bins.length ? i : null;
  }

  function handleMouseLeave() {
    hoveredBin = null;
  }

  $: hoveredCount = hoveredBin !== null ? bins[hoveredBin] : null;
  $: hoveredLo = hoveredBin !== null ? min + (hoveredBin / bins.length) * (max - min) : null;
  $: hoveredHi = hoveredBin !== null ? min + ((hoveredBin + 1) / bins.length) * (max - min) : null;
  $: hoveredPct = hoveredBin !== null && totalSamples > 0
    ? ((bins[hoveredBin] / totalSamples) * 100).toFixed(1)
    : null;
</script>

<div class="histogram-wrap">
  <svg
    role="img"
    aria-label="Variable histogram"
    width="100%"
    height={HEIGHT}
    viewBox="0 0 100 {HEIGHT}"
    preserveAspectRatio="none"
    on:mousemove={handleMouseMove}
    on:mouseleave={handleMouseLeave}
    style="cursor: default;"
  >
    <!-- Subtle background so the chart area is visible on any theme -->
    <rect x="0" y="0" width="100" height={HEIGHT} class="bg" />

    <!-- Y-axis grid lines at 25%, 50%, 75% -->
    {#each [0.25, 0.5, 0.75] as frac}
      <line
        x1="0" y1={HEIGHT - 2 - frac * (HEIGHT - 4)}
        x2="100" y2={HEIGHT - 2 - frac * (HEIGHT - 4)}
        class="grid-line"
      />
    {/each}

    <!-- Bars -->
    {#each bins as count, i}
      {@const barH = (count / maxBin) * (HEIGHT - 4)}
      {@const x = i * barWidth + BAR_GAP / 2}
      {@const w = barWidth - BAR_GAP}
      <rect
        x={x}
        y={HEIGHT - 2 - barH}
        width={w}
        height={Math.max(barH, 0.5)}
        fill={color}
        class="bar"
        class:hovered={hoveredBin === i}
      />
    {/each}

    <!-- Hovered bin vertical indicator -->
    {#if hoveredBin !== null}
      {@const hoverX = (hoveredBin + 0.5) * barWidth}
      <line
        x1={hoverX} y1={2}
        x2={hoverX} y2={HEIGHT - 2}
        class="hover-line"
      />
    {/if}

    <!-- Zero crossing line -->
    {#if hasZeroCrossing && zeroFraction !== null}
      {@const zeroX = zeroFraction * 100}
      <line
        x1={zeroX} y1={2}
        x2={zeroX} y2={HEIGHT - 2}
        class="zero-line"
      />
    {/if}
  </svg>

  <div class="tooltip">
    {#if hoveredBin !== null && hoveredLo !== null && hoveredHi !== null}
      <span class="tooltip-range">{formatNum(hoveredLo)} – {formatNum(hoveredHi)}</span>
      <span class="tooltip-count">{hoveredCount} ({hoveredPct}%)</span>
    {/if}
  </div>

  <div class="labels">
    <span>{formatNum(min)}</span>
    {#if min !== max}
      <span class="label-mid">{formatNum((min + max) / 2)}</span>
    {/if}
    <span>{formatNum(max)}</span>
  </div>
</div>

<style>
  .histogram-wrap {
    width: 100%;
    margin-top: 4px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    border-radius: 3px;
    padding: 2px;
  }

  svg {
    display: block;
  }

  .bg {
    fill: var(--vscode-input-background, rgba(128,128,128,0.06));
  }

  .bar {
    opacity: 0.8;
  }

  .bar.hovered {
    opacity: 1;
  }

  .grid-line {
    stroke: var(--vscode-panel-border, rgba(128,128,128,0.15));
    stroke-width: 0.5;
  }

  .zero-line {
    stroke: var(--vscode-descriptionForeground);
    stroke-width: 0.5;
    stroke-dasharray: 2 2;
  }

  .hover-line {
    stroke: var(--vscode-editor-foreground);
    stroke-width: 0.3;
    opacity: 0.3;
    pointer-events: none;
  }

  .tooltip {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    padding: 1px 2px;
    height: 14px;
  }

  .tooltip-range {
    color: var(--vscode-editor-foreground);
  }

  .tooltip-count {
    color: var(--vscode-descriptionForeground);
  }

  .labels {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family, monospace);
    padding: 1px 2px;
  }

  .label-mid {
    color: var(--vscode-descriptionForeground);
  }
</style>
