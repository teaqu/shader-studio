<script lang="ts">
  import type { CaptureIssue, CapturedVariable, RefreshMode, VariableCaptureManager } from '../../VariableCaptureManager';
  import VariableRow from './VariableRow.svelte';
  import ErrorTooltip from '../ErrorTooltip.svelte';

  interface Props {
    capturedVariables?: CapturedVariable[];
    isPixelMode?: boolean;
    enableRowPreview?: boolean;
    isLoading?: boolean;
    captureIssues?: CaptureIssue[];
    onExpandToggle?: (varName: string) => void;
    onVarClick?: (varName: string, declarationLine: number) => void;
    variableCaptureManager?: VariableCaptureManager;
    sampleSize?: number;
    refreshMode?: RefreshMode;
    pollingMs?: number;
    hasPixelSelected?: boolean;
    hasBorderTop?: boolean;
  }

  let {
    capturedVariables = [],
    isPixelMode = false,
    enableRowPreview = false,
    isLoading = false,
    captureIssues = [],
    onExpandToggle = (_varName: string) => {},
    onVarClick = (_varName: string, _declarationLine: number) => {},
    variableCaptureManager = undefined,
    sampleSize = 32,
    refreshMode = 'polling',
    pollingMs = 500,
    hasPixelSelected = false,
    hasBorderTop = false,
  }: Props = $props();

  const SAMPLE_SIZES = [16, 32, 64, 128];

  let issueAnchorEl = $state<HTMLDivElement | null>(null);
  let isIssueTooltipHovered = $state(false);
  let isIssueTooltipTriggerHovered = $state(false);

  const hasIssues = $derived(captureIssues.length > 0);
  /** One line per failure, naming the variable it belongs to where there is one. */
  const issueMessages = $derived(
    captureIssues.map((issue) => (issue.varName ? `${issue.varName}: ${issue.message}` : issue.message)),
  );
  const isIssueTooltipVisible = $derived(
    hasIssues && (isIssueTooltipTriggerHovered || isIssueTooltipHovered),
  );

  function handleIssueTriggerLeave(event: MouseEvent) {
    isIssueTooltipTriggerHovered = false;
    const nextTarget = event.relatedTarget;
    const enteredTooltip = nextTarget instanceof Node
      && (nextTarget as HTMLElement).closest?.('.error-tooltip');
    if (!enteredTooltip) {
      isIssueTooltipHovered = false;
    }
  }

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

<div class="variables-section" class:has-border-top={hasBorderTop}>
  <div class="section-header">
    <span class="section-label">Variables</span>
    <div class="controls">
      {#if hasIssues}
        <!-- Mirrors the pause button: the icon reports that something failed and
             holds the detail, so partial results stay visible behind it. -->
        <div class="issue-indicator" bind:this={issueAnchorEl}>
          <button
            class="issue-button"
            aria-label="Show capture errors"
            onmouseenter={() => (isIssueTooltipTriggerHovered = true)}
            onmouseleave={handleIssueTriggerLeave}
          >
            <i class="codicon codicon-error"></i>
            {#if captureIssues.length > 1}
              <span class="issue-count">{captureIssues.length}</span>
            {/if}
          </button>
          <ErrorTooltip
            messages={issueMessages}
            visible={isIssueTooltipVisible}
            anchor={issueAnchorEl}
            onmouseenter={() => (isIssueTooltipHovered = true)}
            onmouseleave={() => (isIssueTooltipHovered = false)}
          />
        </div>
      {/if}
      <!-- Grid sample size (hidden when pixel is selected) -->
      {#if !hasPixelSelected}
        <span class="ctrl-label">Size</span>
        {#each SAMPLE_SIZES as s (s)}
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

  {#if isLoading && capturedVariables.length === 0}
    <div class="loading-row">
      <span class="loading-text">Capturing...</span>
    </div>
  {:else if capturedVariables.length === 0}
    <div class="empty-row">
      <span class="empty-text">{hasIssues ? 'No variables could be captured' : 'No variables in scope'}</span>
    </div>
  {:else}
    {#each capturedVariables as variable (variable.varName)}
      <VariableRow
        {variable}
        {isPixelMode}
        {enableRowPreview}
        onExpandToggle={() => onExpandToggle(variable.varName)}
        onLineClick={() => onVarClick(variable.varName, variable.declarationLine)}
      />
    {/each}
  {/if}
</div>

<style>
  .variables-section {
    margin-bottom: 8px;
    padding-top: 6px;
  }

  .variables-section.has-border-top {
    border-top: 1px solid var(--vscode-panel-border);
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

  /* Anchors the tooltip, which positions itself against its parent. */
  .issue-indicator {
    position: relative;
    display: flex;
    align-items: center;
    margin-left: 6px;
  }

  .issue-button {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 3px;
    background: transparent;
    border: none;
    border-radius: 3px;
    color: var(--vscode-errorForeground, #f48771);
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
  }

  .issue-button:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .issue-count {
    font-size: 10px;
  }
</style>
