<script lang="ts">
  import MiniHistogram from './MiniHistogram.svelte';

  export let channels: Array<{ bins: number[]; min: number; max: number; label: string }>;

  const LABEL_COLORS = [
    'var(--vscode-charts-red)',
    'var(--vscode-charts-green)',
    'var(--vscode-charts-blue)',
    'var(--vscode-charts-purple)',
  ];

  const BAR_COLOR = 'var(--vscode-charts-blue)';
</script>

<div class="multi-hist">
  {#each channels as ch, ci}
    <div class="channel-row">
      <span class="ch-label" style="color: {LABEL_COLORS[ci] ?? '#aaa'}">{ch.label}</span>
      <div class="ch-hist">
        <MiniHistogram bins={ch.bins} min={ch.min} max={ch.max} color={BAR_COLOR} />
      </div>
    </div>
  {/each}
</div>

<style>
  .multi-hist {
    width: 100%;
    margin-top: 4px;
  }

  .channel-row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }

  .ch-label {
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-weight: 600;
    width: 10px;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .ch-hist {
    flex: 1;
    min-width: 0;
  }
</style>
