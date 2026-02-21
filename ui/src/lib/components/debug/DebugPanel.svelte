<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ShaderDebugState, DebugFunctionContext, DebugLoopInfo } from "../../types/ShaderDebugState";
  import type { PassUniforms } from "../../../../../rendering/src/models/PassUniforms";
  import ParameterEditor from "./ParameterEditor.svelte";

  import { dragScrub } from "../../actions/dragScrub";
  import inspectorIcon from "../../../assets/inspector.svg?raw";
  import lockIcon from "../../../assets/lock.svg?raw";
  import unlockIcon from "../../../assets/unlock.svg?raw";

  export let debugState: ShaderDebugState;
  export let getUniforms: () => PassUniforms | null = () => null;
  export let isInspectorEnabled: boolean = false;
  export let onParameterChange: (index: number, value: string) => void = () => {};
  export let onLoopMaxIterChange: (loopIndex: number, maxIter: number | null) => void = () => {};
  export let onToggleLineLock: () => void = () => {};
  export let onToggleInspectorEnabled: () => void = () => {};
  export let onToggleInlineRendering: () => void = () => {};
  export let onCycleNormalize: () => void = () => {};
  export let onToggleStep: () => void = () => {};
  export let onSetStepEdge: (edge: number) => void = () => {};

  let uniforms: PassUniforms | null = null;
  let uniformsHandle: number | null = null;

  $: ctx = debugState.functionContext;
  $: isInlineOn = debugState.isInlineRenderingEnabled;
  $: isLineLocked = debugState.isLineLocked;
  $: lineNum = debugState.currentLine !== null ? debugState.currentLine + 1 : null;
  $: isInFunction = ctx !== null && ctx.isFunction;
  $: isMainImage = ctx !== null && !ctx.isFunction;
  $: hasVariable = debugState.lineContent !== null && debugState.isActive;
  $: normalizeMode = debugState.normalizeMode;
  $: isStepEnabled = debugState.isStepEnabled;
  $: stepEdge = debugState.stepEdge;
  $: debugError = debugState.debugError;
  $: showParams = isInlineOn && isInFunction && ctx !== null;
  $: showLoops = isInlineOn && ctx !== null && ctx.loops.length > 0;
  $: hasContentAboveUniforms = (showParams && ctx && ctx.parameters.length > 0) || showLoops;

  $: normalizeTooltip = normalizeMode === 'off'
    ? "Normalize: OFF\nRaw shader output values"
    : normalizeMode === 'soft'
    ? "Normalize: SOFT\nSigned normalization\nzero = gray (0.5)\nnegative < 0.5, positive > 0.5"
    : "Normalize: ABS\nAbsolute value normalization\nzero = black\nlarger magnitudes brighter";

  onMount(() => {
    const updateUniforms = () => {
      uniforms = getUniforms();
      uniformsHandle = requestAnimationFrame(updateUniforms);
    };
    uniformsHandle = requestAnimationFrame(updateUniforms);
  });

  onDestroy(() => {
    if (uniformsHandle !== null) {
      cancelAnimationFrame(uniformsHandle);
    }
  });

  function handleLoopIterInput(loop: DebugLoopInfo, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    if (value === '' || value === '0') {
      onLoopMaxIterChange(loop.loopIndex, null);
    } else {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) {
        onLoopMaxIterChange(loop.loopIndex, num);
      }
    }
  }

  function handleStepEdgeInput(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    if (!isNaN(value)) {
      onSetStepEdge(value);
    }
  }

  function formatTime(t: number): string {
    return t.toFixed(2);
  }

  function formatVec(v: number[] | Float32Array | null): string {
    if (!v) return '—';
    return Array.from(v).map(n => n.toFixed(1)).join(', ');
  }
</script>

<div class="debug-panel">
  <div class="debug-header">
    <button
      class="header-btn has-tooltip"
      class:active={isInspectorEnabled}
      on:click={onToggleInspectorEnabled}
      aria-label="Toggle inspector"
      data-tooltip="Pixel Inspector"
    >
      {@html inspectorIcon}
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isInlineOn}
      on:click={onToggleInlineRendering}
      aria-label="Toggle inline rendering"
      data-tooltip="Inline Rendering"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isLineLocked}
      on:click={onToggleLineLock}
      aria-label="Toggle line lock"
      data-tooltip={isLineLocked ? "Unlock line" : "Lock to line"}
    >
      {#if isLineLocked}
        {@html lockIcon}
      {:else}
        {@html unlockIcon}
      {/if}
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={normalizeMode !== 'off'}
      on:click={onCycleNormalize}
      aria-label="Cycle normalize mode"
      data-tooltip={normalizeTooltip}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 17l6-6 4 4 8-8"/>
        <path d="M17 7h4v4"/>
      </svg>
      {#if normalizeMode !== 'off'}
        <span class="normalize-badge">{normalizeMode === 'soft' ? 'S' : 'A'}</span>
      {/if}
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isStepEnabled}
      on:click={onToggleStep}
      aria-label="Toggle step threshold"
      data-tooltip={isStepEnabled ? `Step: ON (edge=${stepEdge})` : "Step: OFF\nBinary threshold"}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 18h6v-12h6v12h6"/>
      </svg>
    </button>
    {#if isStepEnabled}
      <input
        type="number"
        step="0.05"
        min="0"
        max="1"
        value={stepEdge}
        on:input={handleStepEdgeInput}
        use:dragScrub={{ step: 0.05, onInput: (v) => onSetStepEdge(v) }}
        class="step-edge-input"
        aria-label="Step edge threshold"
      />
    {/if}
    {#if lineNum !== null}
      <span class="header-info has-tooltip" class:error={debugError} class:has-line-content={!debugError && debugState.lineContent} data-tooltip={debugError || (debugState.lineContent ? debugState.lineContent.trim() : `Line ${lineNum}`)}>L{lineNum}</span>
    {/if}
    {#if isInlineOn && ctx}
      <span class="header-info fn-name">{ctx.functionName}</span>
      <span class="header-info fn-type">{ctx.returnType}</span>
    {/if}
  </div>

  <div class="debug-content">
    {#if isInlineOn && !hasVariable}
      <div class="section hint-section">
        <span class="hint-text">Place cursor on a GLSL line to inspect</span>
      </div>
    {/if}
    {#if isInlineOn}
      {#if showParams && ctx && ctx.parameters.length > 0}
        <div class="section">
          <div class="section-label">Parameters</div>
          {#each ctx.parameters as param, index}
            <ParameterEditor
              {param}
              onChange={(value) => onParameterChange(index, value)}
            />
          {/each}
        </div>
      {/if}

      {#if showLoops && ctx}
        <div class="section">
          <div class="section-label">Loops</div>
          {#each ctx.loops as loop}
            <div class="loop-row">
              <span class="loop-line">L{loop.lineNumber + 1}:</span>
              <span class="loop-header has-tooltip" data-tooltip={loop.loopHeader}>{loop.loopHeader}</span>
              <span class="loop-iter-label">Iterations</span>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="max"
                value={loop.maxIter ?? ''}
                on:input={(e) => handleLoopIterInput(loop, e)}
                use:dragScrub={{ step: 1, onInput: (v) => { const num = Math.max(1, Math.round(v)); onLoopMaxIterChange(loop.loopIndex, num > 0 ? num : null); } }}
                class="loop-input"
                aria-label="Max iterations for loop at line {loop.lineNumber + 1}"
              />
            </div>
          {/each}
        </div>
      {/if}

    {/if}

    <div class="section uniforms-section" class:has-border={hasContentAboveUniforms}>
      <div class="section-label">Uniforms</div>
      {#if uniforms}
        <div class="uniform-row"><span class="uniform-name">iTime</span><span class="uniform-value">{formatTime(uniforms.time)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iResolution</span><span class="uniform-value">{formatVec(uniforms.res)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iMouse</span><span class="uniform-value">{formatVec(uniforms.mouse)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iFrame</span><span class="uniform-value">{uniforms.frame}</span></div>
        <div class="uniform-row"><span class="uniform-name">iTimeDelta</span><span class="uniform-value">{uniforms.timeDelta.toFixed(4)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iFrameRate</span><span class="uniform-value">{uniforms.frameRate.toFixed(1)}</span></div>
      {:else}
        <div class="uniform-row"><span class="uniform-value">—</span></div>
      {/if}
    </div>
  </div>
</div>

<style>
  .debug-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
    color: var(--vscode-editor-foreground);
    font-size: 14px;
  }

  .debug-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
  }

  .header-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: 24px;
    height: 24px;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 2px;
  }

  .header-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .header-btn.active {
    color: var(--vscode-editor-foreground);
    border-color: var(--vscode-focusBorder);
  }

  /* CSS tooltips via data-tooltip attribute */
  .has-tooltip {
    position: relative;
  }

  .has-tooltip::after {
    content: attr(data-tooltip);
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 6px;
    padding: 4px 8px;
    background: var(--vscode-editorHoverWidget-background, #2d2d30);
    color: var(--vscode-editorHoverWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
    border-radius: 3px;
    font-size: 12px;
    white-space: pre;
    z-index: 100;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease-in;
    width: max-content;
    max-width: 250px;
  }

  .has-tooltip:hover::after {
    opacity: 1;
  }

  /* Line content tooltip - wraps long lines */
  .header-info.has-line-content::after {
    white-space: pre-wrap;
    max-width: 350px;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  /* Error tooltip - left-aligned from line number, wraps long messages */
  .header-info.error::after {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border-color: var(--vscode-inputValidation-errorBorder, #be1100);
    color: var(--vscode-errorForeground, #f44747);
    white-space: pre-wrap;
    max-width: 350px;
  }

  .step-edge-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    padding: 2px 4px;
    font-size: 12px;
    width: 45px;
    height: 20px;
  }

  .normalize-badge {
    position: absolute;
    bottom: 0;
    right: 0;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    color: var(--vscode-editor-foreground);
  }

  .header-info {
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
    padding: 0 2px;
  }

  .header-info.error {
    color: var(--vscode-errorForeground, #f44747);
  }

  .fn-name {
    font-weight: 600;
    color: var(--vscode-editor-foreground);
  }

  .fn-type {
    font-style: italic;
  }

  .debug-content {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }

  .section {
    margin-bottom: 8px;
  }

  .section-label {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
    font-weight: 600;
  }

  .loop-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
  }

  .loop-line {
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    min-width: 28px;
    font-size: 13px;
  }

  .loop-header {
    font-size: 13px;
    color: var(--vscode-editor-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .loop-iter-label {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .loop-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    padding: 2px 6px;
    font-size: 13px;
    width: 55px;
  }

  .uniforms-section {
    padding-top: 6px;
  }

  .uniforms-section.has-border {
    border-top: 1px solid var(--vscode-panel-border);
  }

  .uniform-row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    font-size: 13px;
  }

  .hint-text {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    font-size: 12px;
  }

  .uniform-name {
    color: var(--vscode-descriptionForeground);
  }

  .uniform-value {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-editor-foreground);
  }
</style>
