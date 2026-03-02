<script lang="ts">
  import type { ColorFrequency } from '../../VariableCaptureManager';

  export let colors: ColorFrequency[];

  let hoveredIndex: number | null = null;

  function rgb(r: number, g: number, b: number): string {
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }

  function fmt(n: number): string {
    return n.toFixed(3);
  }

  function pct(freq: number): string {
    return (freq * 100).toFixed(1) + '%';
  }
</script>

<div class="color-freq-wrap">
  <div class="bar">
    {#each colors as c, i}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="segment"
        class:hovered={hoveredIndex === i}
        style="width: {c.freq * 100}%; background: {rgb(c.r, c.g, c.b)}"
        on:mouseenter={() => hoveredIndex = i}
        on:mouseleave={() => hoveredIndex = null}
      ></div>
    {/each}
  </div>

  <div class="tooltip">
    {#if hoveredIndex !== null}
      {@const c = colors[hoveredIndex]}
      <span class="swatch" style="background: {rgb(c.r, c.g, c.b)}"></span>
      <span class="tooltip-val">({fmt(c.r)}, {fmt(c.g)}, {fmt(c.b)})</span>
      <span class="tooltip-pct">{pct(c.freq)}</span>
    {/if}
  </div>
</div>

<style>
  .color-freq-wrap {
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
  }

  .segment {
    height: 100%;
    transition: filter 0.1s;
    flex-shrink: 0;
  }

  .segment.hovered {
    filter: brightness(1.3);
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
    border: 1px solid rgba(128, 128, 128, 0.3);
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
