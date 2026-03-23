<script lang="ts">
  import type { CapturedVariable, RefreshMode, VariableCaptureManager } from '../../VariableCaptureManager';
  import VariableRow from './VariableRow.svelte';

  export let capturedVariables: CapturedVariable[] = [];
  export let isPixelMode: boolean = false;
  export let isLoading: boolean = false;
  export let onExpandToggle: (varName: string) => void = () => {};
  export let onVarClick: (varName: string, declarationLine: number) => void = () => {};
  export let variableCaptureManager: VariableCaptureManager | undefined = undefined;
  export let sampleSize: number = 32;
  export let refreshMode: RefreshMode = 'polling';
  export let pollingMs: number = 500;
  export let hasPixelSelected: boolean = false;

  const SAMPLE_SIZES = [16, 32, 64, 128];

  function changeRefreshMode(mode: RefreshMode) {
    variableCaptureManager?.changeRefreshMode(mode, hasPixelSelected);
  }

  function toggleManual() {
    changeRefreshMode(refreshMode === 'manual' ? 'polling' : 'manual');
  }

  function toggleRealtime() {
    changeRefreshMode(refreshMode === 'realtime' ? 'polling' : 'realtime');
  }

  function togglePause() {
    changeRefreshMode(refreshMode === 'pause' ? 'polling' : 'pause');
  }

  function handlePollingMsInput(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    if (!isNaN(value) && value > 0) {
      if (refreshMode !== 'polling') {
        variableCaptureManager?.changeRefreshMode('polling', hasPixelSelected);
      }
      variableCaptureManager?.changePollingMs(value, hasPixelSelected);
    }
  }

  function handlePollingMsFocus() {
    if (refreshMode !== 'polling') {
      variableCaptureManager?.changeRefreshMode('polling', hasPixelSelected);
    }
  }
</script>

<div class="variables-section">
  <div class="section-header">
    <span class="section-label">Variables</span>
    <div class="controls">
      <!-- Grid sample size (hidden when pixel is selected) -->
      {#if !hasPixelSelected}
        <span class="ctrl-label">Size</span>
        {#each SAMPLE_SIZES as s}
          <button
            class="ctrl-btn"
            class:active={sampleSize === s}
            on:click={() => variableCaptureManager?.changeSampleSize(s)}
            title="Sample {s}×{s} points across canvas"
          >{s}</button>
        {/each}
      {/if}

      <!-- Refresh mode -->
      <span class="ctrl-label">Refresh</span>
      <button
        class="ctrl-btn"
        class:active={refreshMode === 'manual'}
        on:click={toggleManual}
        title="Recapture on state change (cursor move, shader edit)"
      >manual</button>
      <button
        class="ctrl-btn has-input"
        class:active={refreshMode === 'polling'}
        on:click={() => { if (refreshMode !== 'polling') changeRefreshMode('polling'); }}
        title="Auto-recapture every {pollingMs}ms"
      >
        <input
          type="number"
          class="ms-input"
          min="1"
          step="100"
          value={pollingMs}
          on:focus={handlePollingMsFocus}
          on:input={handlePollingMsInput}
          on:click|stopPropagation
          title="Custom refresh interval in milliseconds"
        />
        <span class="ms-suffix">ms</span>
      </button>
      <button
        class="ctrl-btn"
        class:active={refreshMode === 'realtime'}
        on:click={toggleRealtime}
        title="Capture every frame"
      >realtime</button>
      <button
        class="ctrl-btn"
        class:active={refreshMode === 'pause'}
        on:click={togglePause}
        title="Pause — freeze captured values"
      >pause</button>
    </div>
  </div>

  {#if isLoading && capturedVariables.length === 0}
    <div class="loading-row">
      <span class="loading-text">Capturing...</span>
    </div>
  {:else if capturedVariables.length === 0}
    <div class="empty-row">
      <span class="empty-text">No variables in scope</span>
    </div>
  {:else}
    {#each capturedVariables as variable (variable.varName)}
      <VariableRow
        {variable}
        {isPixelMode}
        onExpandToggle={() => onExpandToggle(variable.varName)}
        onLineClick={() => onVarClick(variable.varName, variable.declarationLine)}
      />
    {/each}
  {/if}
</div>

<style>
  .variables-section {
    margin-bottom: 8px;
    border-top: 1px solid var(--vscode-panel-border);
    padding-top: 6px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .section-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
    flex-shrink: 0;
  }

  .controls {
    display: flex;
    gap: 2px;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
  }

  .ctrl-label {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
    padding: 0 2px 0 4px;
    align-self: center;
  }

  .ctrl-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 10px;
    padding: 1px 4px;
    line-height: 1.4;
  }

  .ctrl-btn.has-input {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .ctrl-btn:hover {
    color: var(--vscode-editor-foreground);
    background: var(--vscode-toolbar-hoverBackground);
  }

  .ctrl-btn.active {
    color: var(--vscode-editor-foreground);
    border-color: var(--vscode-focusBorder);
  }

  .ms-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    padding: 1px 3px;
    font-size: 10px;
    width: 38px;
    height: 16px;
  }

  .ms-input:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ms-suffix {
    font-size: 10px;
  }

  .loading-row,
  .empty-row {
    padding: 2px 0;
  }

  .loading-text,
  .empty-text {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
</style>
