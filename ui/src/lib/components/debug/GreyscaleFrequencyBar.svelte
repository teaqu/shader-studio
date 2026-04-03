<script lang="ts">
  export let bins: number[];
  export let min: number;
  export let max: number;

  let hoveredBin: number | null = null;

  $: total = bins.reduce((a, b) => a + b, 0);

  function greyColor(i: number): string {
    const center = min + (i + 0.5) / bins.length * (max - min);
    const g = Math.round(Math.max(0, Math.min(1, center)) * 255);
    return `rgb(${g}, ${g}, ${g})`;
  }

  function fmt(n: number): string {
    if (Math.abs(n) >= 1000) {
      return n.toFixed(0);
    }
    if (Math.abs(n) >= 10) {
      return n.toFixed(1);
    }
    return n.toFixed(3);
  }

  function pct(count: number): string {
    if (total === 0) {
      return '0%';
    }
    return (count / total * 100).toFixed(1) + '%';
  }
</script>

<div class="grey-freq-wrap">
  <div class="bar">
    {#each bins as count, i}
      {#if count > 0 && total > 0}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="segment"
          class:hovered={hoveredBin === i}
          style="width: {(count / total) * 100}%; background: {greyColor(i)}"
          on:mouseenter={() => hoveredBin = i}
          on:mouseleave={() => hoveredBin = null}
        ></div>
      {/if}
    {/each}
  </div>

  <div class="tooltip">
    {#if hoveredBin !== null}
      {@const lo = min + hoveredBin / bins.length * (max - min)}
      {@const hi = min + (hoveredBin + 1) / bins.length * (max - min)}
      <span class="swatch" style="background: {greyColor(hoveredBin)}"></span>
      <span class="tooltip-val">{fmt(lo)} – {fmt(hi)}</span>
      <span class="tooltip-pct">{pct(bins[hoveredBin])}</span>
    {/if}
  </div>
</div>

<style>
  .grey-freq-wrap {
    width: 100%;
    margin-top: 4px;
  }

  .bar {
    display: flex;
    height: 20px;
    border-radius: 3px;
    overflow: hidden;
    width: 100%;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    background: var(--vscode-input-background, rgba(128,128,128,0.06));
  }

  .segment {
    height: 100%;
    transition: filter 0.1s;
    flex-shrink: 0;
  }

  .segment.hovered {
    filter: brightness(1.3) contrast(1.1);
  }

  .tooltip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    padding: 2px 0;
    height: 16px;
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    flex-shrink: 0;
  }

  .tooltip-val {
    color: var(--vscode-editor-foreground);
  }

  .tooltip-pct {
    color: var(--vscode-descriptionForeground);
    margin-left: auto;
  }
</style>
