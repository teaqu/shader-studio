<script lang="ts">
  import type { CapturedVariable, RefreshMode, VariableCaptureManager } from '../../VariableCaptureManager';
  import VariableRow from './VariableRow.svelte';

  interface Props {
    capturedVariables?: CapturedVariable[];
    isPixelMode?: boolean;
    isLoading?: boolean;
    captureError?: string | null;
    onExpandToggle?: (varName: string) => void;
    onVarClick?: (varName: string, declarationLine: number) => void;
    variableCaptureManager?: VariableCaptureManager;
    sampleSize?: number;
    refreshMode?: RefreshMode;
    pollingMs?: number;
    hasPixelSelected?: boolean;
  }

  let {
    capturedVariables = [],
    isPixelMode = false,
    isLoading = false,
    captureError = null,
    onExpandToggle = (_varName: string) => {},
    onVarClick = (_varName: string, _declarationLine: number) => {},
    variableCaptureManager = undefined,
    sampleSize = 32,
    refreshMode = 'polling',
    pollingMs = 500,
    hasPixelSelected = false,
  }: Props = $props();

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
            onclick={() => variableCaptureManager?.changeSampleSize(s)}
            title="Sample {s}×{s} points across canvas"
          >{s}</button>
        {/each}
      {/if}

      <!-- Refresh mode -->
      <span class="ctrl-label">Refresh</span>
      <button
        class="ctrl-btn"
        class:active={refreshMode === 'manual'}
        onclick={toggleManual}
        title="Recapture on state change (cursor move, shader edit)"
      >manual</button>
      <button
        class="ctrl-btn has-input"
        class:active={refreshMode === 'polling'}
        onclick={() => {
          if (refreshMode !== 'polling') {
            changeRefreshMode('polling');
          }
        }}
        title="Auto-recapture every {pollingMs}ms"
      >
        <input
          type="number"
          class="ms-input"
          min="1"
          step="100"
          value={pollingMs}
          onfocus={handlePollingMsFocus}
          oninput={handlePollingMsInput}
          onclick={(e) => e.stopPropagation()}
          title="Custom refresh interval in milliseconds"
        />
        <span class="ms-suffix">ms</span>
      </button>
      <button
        class="ctrl-btn"
        class:active={refreshMode === 'realtime'}
        onclick={toggleRealtime}
        title="Capture every frame"
      >realtime</button>
      <button
        class="ctrl-btn"
        class:active={refreshMode === 'pause'}
        onclick={togglePause}
        title="Pause — freeze captured values"
      >pause</button>
    </div>
  </div>

  {#if captureError && capturedVariables.length === 0}
    <div class="error-row">
      <span class="error-text">{captureError}</span>
    </div>
  {:else if isLoading && capturedVariables.length === 0}
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
  .empty-row,
  .error-row {
    padding: 2px 0;
  }

  .loading-text,
  .empty-text {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }

  .error-text {
    font-size: 12px;
    color: var(--vscode-inputValidation-errorForeground, #f48771);
    white-space: pre-wrap;
  }
</style>
