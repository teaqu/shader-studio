<script lang="ts">
  import type { CapturedVariable } from '../../VariableCaptureManager';
  import MiniHistogram from './MiniHistogram.svelte';
  import MultiChannelHistogram from './MultiChannelHistogram.svelte';
  import ColorFrequencyBar from './ColorFrequencyBar.svelte';
  import GreyscaleFrequencyBar from './GreyscaleFrequencyBar.svelte';
  import CaptureThumbnail from './CaptureThumbnail.svelte';

  interface Props {
    variable: CapturedVariable;
    isPixelMode: boolean;
    onExpandToggle?: () => void;
    onLineClick?: () => void;
  }

  let {
    variable,
    isPixelMode,
    onExpandToggle = () => {},
    onLineClick = () => {},
  }: Props = $props();

  let isScalar = $derived(variable.varType === 'float' || variable.varType === 'int' || variable.varType === 'bool');
  let isVec = $derived(variable.varType === 'vec2' || variable.varType === 'vec3' || variable.varType === 'vec4' || variable.varType === 'mat2');
  let isColorVec = $derived(variable.varType === 'vec3' || variable.varType === 'vec4');
  let isExpanded = $derived(variable.histogram !== null || variable.colorFrequencies !== null || variable.channelHistograms !== null);
  let isVecConstant = $derived(isVec && variable.channelStats !== null
    && variable.channelStats.every(s => s.min === s.max));

  let hasPixelData = $derived(isPixelMode && variable.value !== null);
  let showThumbnail = $derived(!hasPixelData && variable.thumbnail !== null);

  let vecGlobalMin = $derived(variable.channelStats ? Math.min(...variable.channelStats.map(s => s.min)) : 0);
  let vecGlobalMax = $derived(variable.channelStats ? Math.max(...variable.channelStats.map(s => s.max)) : 1);
  let showColorBar = $derived(variable.colorFrequencies !== null
    && !(vecGlobalMin > 1.0 || vecGlobalMax < 0.0));

  let colorSrc = $derived(isColorVec ? (variable.value ?? variable.channelMeans) : null);
  let colorStyle = $derived(colorSrc && colorSrc.length >= 3
    ? `background-color: rgb(${clamp01(colorSrc[0])}, ${clamp01(colorSrc[1])}, ${clamp01(colorSrc[2])})`
    : '');

  function clamp01(v: number): number {
    return Math.round(Math.min(Math.max(v, 0), 1) * 255);
  }

  function fmt(v: number): string {
    return v.toFixed(3);
  }

  function isDimmed(v: number): boolean {
    return Math.abs(v) < 0.0001;
  }
</script>

<div class="var-row" class:has-thumb={showThumbnail}>
  {#if showThumbnail}
    <div class="thumb-col">
      <CaptureThumbnail
        pixels={variable.thumbnail!}
        gridWidth={variable.gridWidth}
        gridHeight={variable.gridHeight}
        varName={variable.varName}
        varType={variable.varType}
        debugLine={variable.captureLine}
        activeBufferName={variable.captureBufferName}
        filePath={variable.captureFilePath}
        maxSize={32}
      />
    </div>
  {/if}

  <div class="var-body">
    <div class="var-header">
      <div class="var-meta">
        <span class="var-name" title={variable.varName}>{variable.varName}</span>
        <span class="var-type">{variable.varType}</span>
        {#if variable.declarationLine >= 0}
          <span
            class="var-line"
            onclick={onLineClick}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && onLineClick()}
          >L{variable.declarationLine + 1}</span>
        {/if}
      </div>

      {#if hasPixelData}
        <!-- Exact pixel values -->
        <span class="var-value">
          {#if colorStyle}
            <span class="color-swatch" style={colorStyle}></span>
          {/if}
          {#if variable.value && variable.value.length === 1}
            <span class:dimmed={isDimmed(variable.value[0])}>{fmt(variable.value[0])}</span>
          {:else if variable.value}
            <span class="vec-value">
              ({#each variable.value as v, i (i)}<span class:dimmed={isDimmed(v)}>{fmt(v)}</span>{#if i < variable.value.length - 1}<span class="sep">, </span>{/if}{/each})
            </span>
          {/if}
        </span>

      {:else if isScalar}
        <!-- Grid mode scalar -->
        {#if variable.stats !== null}
          {#if variable.stats.min === variable.stats.max}
            <span class="var-value">
              <span class:dimmed={isDimmed(variable.stats.min)}>{fmt(variable.stats.min)}</span>
            </span>
          {:else}
            <span class="var-stats">
              <span class="stat-label">min</span><span class="stat-val">{fmt(variable.stats.min)}</span>
              <span class="stat-sep">·</span>
              <span class="stat-label">max</span><span class="stat-val">{fmt(variable.stats.max)}</span>
              <span class="stat-sep">·</span>
              <span class="stat-label">avg</span><span class="stat-val">{fmt(variable.stats.mean)}</span>
              <button class="expand-btn" class:expanded={isExpanded} onclick={onExpandToggle} aria-label="Toggle histogram"><i class="codicon codicon-chevron-down"></i></button>
            </span>
          {/if}
        {:else}
          <span class="var-loading">—</span>
        {/if}

      {:else if isVec}
        <!-- Grid mode vec -->
        {#if variable.channelMeans !== null}
          <span class="var-value">
            {#if isVecConstant && variable.channelStats !== null}
              <!-- Constant across canvas: exact values, no expand -->
              {#if variable.channelStats.length === 1}
                <span class:dimmed={isDimmed(variable.channelStats[0].mean)}>{fmt(variable.channelStats[0].mean)}</span>
              {:else}
                <span class="vec-value">
                  ({#each variable.channelStats as s, i (i)}<span class:dimmed={isDimmed(s.mean)}>{fmt(s.mean)}</span>{#if i < variable.channelStats.length - 1}<span class="sep">, </span>{/if}{/each})
                </span>
              {/if}
            {:else}
              <!-- Varying: means + expand -->
              <span class="approx">≈</span>
              {#if variable.channelMeans.length === 1}
                <span class:dimmed={isDimmed(variable.channelMeans[0])}>{fmt(variable.channelMeans[0])}</span>
              {:else}
                <span class="vec-value">
                  ({#each variable.channelMeans as v, i (i)}<span class:dimmed={isDimmed(v)}>{fmt(v)}</span>{#if i < variable.channelMeans.length - 1}<span class="sep">, </span>{/if}{/each})
                </span>
              {/if}
              <button class="expand-btn" class:expanded={isExpanded} onclick={onExpandToggle} aria-label="Toggle channel view"><i class="codicon codicon-chevron-down"></i></button>
            {/if}
          </span>
        {:else}
          <span class="var-loading">—</span>
        {/if}
      {/if}
    </div>

    <!-- Expanded content -->
    {#if isExpanded}
      <div class="expanded-row">
        {#if isScalar && variable.histogram !== null}
          <!-- Float: greyscale frequency bar + blue histogram -->
          <GreyscaleFrequencyBar bins={variable.histogram.bins} min={variable.histogram.min} max={variable.histogram.max} />
          <MiniHistogram bins={variable.histogram.bins} min={variable.histogram.min} max={variable.histogram.max} />
        {:else}
          <!-- Vec: colour frequency bar (only if values are in [0,1]), then per-channel histograms -->
          {#if showColorBar}
            <ColorFrequencyBar colors={variable.colorFrequencies!} />
          {/if}
          {#if variable.channelHistograms !== null}
            <MultiChannelHistogram channels={variable.channelHistograms} />
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .var-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 3px 0;
    font-size: 13px;
  }

  .thumb-col {
    flex-shrink: 0;
    padding-top: 1px;
    width: 32px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }

  .var-body {
    flex: 1;
    min-width: 0;
  }

  .var-header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .var-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .var-name {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-editor-foreground);
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .var-line {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
    cursor: pointer;
  }

  .var-line:hover {
    color: var(--vscode-editor-foreground);
    text-decoration: underline;
  }

  .var-type {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    flex-shrink: 0;
    max-width: 52px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .var-value {
    margin-left: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-editor-foreground);
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    max-width: 100%;
  }

  .color-swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    flex-shrink: 0;
  }

  .approx {
    color: var(--vscode-descriptionForeground);
  }

  .var-stats {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }

  .stat-label {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    font-size: 11px;
  }

  .stat-val {
    color: var(--vscode-editor-foreground);
  }

  .stat-sep {
    color: var(--vscode-panel-border);
    font-size: 10px;
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 0 2px;
    font-size: 10px;
    transition: transform 0.15s;
  }

  .expand-btn.expanded {
    transform: rotate(180deg);
  }

  .expand-btn:hover {
    color: var(--vscode-editor-foreground);
  }

  .dimmed {
    opacity: 0.35;
  }

  .sep {
    color: var(--vscode-descriptionForeground);
  }

  .var-loading {
    margin-left: auto;
    color: var(--vscode-descriptionForeground);
  }

  .vec-value {
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .expanded-row {
    width: 100%;
    padding: 2px 0;
  }
</style>
