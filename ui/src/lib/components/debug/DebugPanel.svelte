<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ShaderDebugState, DebugFunctionContext, DebugLoopInfo } from "../../types/ShaderDebugState";
  import type { PassUniforms } from "../../../../../rendering/src/models/PassUniforms";
  import ParameterEditor from "./ParameterEditor.svelte";

  import type { ShaderDebugManager } from "../../ShaderDebugManager";
  import type { VariableCaptureManager, RefreshMode } from "../../VariableCaptureManager";
  import { dragScrub } from "../../actions/dragScrub";


  import VariablesSection from "./VariablesSection.svelte";

  export let debugState: ShaderDebugState;
  export let getUniforms: () => PassUniforms | null = () => null;
  export let isInspectorEnabled: boolean = false;
  export let isInspectorActive: boolean = false;
  export let isInspectorLocked: boolean = false;
  export let shaderDebugManager: ShaderDebugManager | undefined = undefined;
  export let variableCaptureManager: VariableCaptureManager | undefined = undefined;
  export let onToggleInspectorEnabled: () => void = () => {};
  export let onToggleInlineRendering: () => void = () => {};
  export let onExpandVarHistogram: (varName: string) => void = () => {};
  export let onVarClick: (varName: string, declarationLine: number) => void = () => {};
  export let sampleSize: number = 32;
  export let refreshMode: RefreshMode = 'polling';
  export let pollingMs: number = 500;
  export let hasPixelSelected: boolean = false;
  export let customUniformValues: Record<string, number | number[] | boolean> = {};
  export let isVariableCaptureLoading: boolean = false;
  export let variableCaptureError: string | null = null;

  let uniforms: PassUniforms | null = null;
  let uniformsHandle: number | null = null;
  let isLineTooltipTriggerHovered = false;
  let isLineTooltipHovered = false;
  let isLineTooltipHoverArmed = false;
  const activeHeaderPointers = new Set<number>();

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
  $: lineTooltipText = debugError || (debugState.lineContent ? debugState.lineContent.trim() : (lineNum !== null ? `Line ${lineNum}` : ''));
  $: showParams = isInlineOn && isInFunction && ctx !== null;
  $: showLoops = isInlineOn && ctx !== null && ctx.loops.length > 0;
  $: hasContentAboveUniforms = (showParams && ctx && ctx.parameters.length > 0) || showLoops;
  $: isVarInspectorOn = debugState.isVariableInspectorEnabled;
  $: capturedVariables = debugState.capturedVariables;

  // Explicit reactive derivations for VariablesSection passthrough props.
  // In Svelte 5 legacy mode, creating derived signals from props ensures
  // the child component sees updates even during rapid parent re-renders.
  $: vsRefreshMode = refreshMode;
  $: vsPollingMs = pollingMs;
  $: vsHasPixelSelected = hasPixelSelected;
  $: vsSampleSize = sampleSize;

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
    activeHeaderPointers.clear();
  });

  function handleLoopIterInput(loop: DebugLoopInfo, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    if (value === '' || value === '0') {
      shaderDebugManager?.setLoopMaxIterations(loop.loopIndex, null);
    } else {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) {
        shaderDebugManager?.setLoopMaxIterations(loop.loopIndex, num);
      }
    }
  }

  function handleStepEdgeInput(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    if (!isNaN(value)) {
      shaderDebugManager?.setStepEdge(value);
    }
  }

  function formatTime(t: number): string {
    return t.toFixed(2);
  }

  function formatVec(v: number[] | Float32Array | null): string {
    if (!v) return '—';
    return Array.from(v).map(n => n.toFixed(1)).join(', ');
  }

  function formatCustomValue(val: number | number[] | boolean | undefined): string {
    if (val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return val.toFixed(3);
    if (Array.isArray(val)) return val.map(v => v.toFixed(2)).join(', ');
    return String(val);
  }

  function activateHeaderControl(action: () => void) {
    action();
  }

  function handleHeaderControlPointerDown(event: PointerEvent, action: () => void) {
    const isPrimaryPress = event.isPrimary ?? true;
    const isMainButton = event.button ?? 0;
    if (!isPrimaryPress || isMainButton !== 0) return;
    if (activeHeaderPointers.has(event.pointerId)) return;

    activeHeaderPointers.add(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    activateHeaderControl(action);
  }

  function handleHeaderControlPointerEnd(event: PointerEvent) {
    activeHeaderPointers.delete(event.pointerId);
  }

  function handleHeaderControlKeydown(event: KeyboardEvent, action: () => void) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateHeaderControl(action);
  }

  $: customUniformEntries = Object.entries(customUniformValues);
  $: isLineTooltipVisible =
    isLineTooltipTriggerHovered || (isLineTooltipHoverArmed && isLineTooltipHovered);

  function handleLineTooltipTriggerEnter() {
    isLineTooltipHoverArmed = true;
    isLineTooltipTriggerHovered = true;
  }

  function handleLineTooltipTriggerLeave(event: MouseEvent) {
    isLineTooltipTriggerHovered = false;
    const nextTarget = event.relatedTarget as Node | null;
    const enteredTooltip =
      nextTarget instanceof Node &&
      (nextTarget as HTMLElement).closest?.('.line-tooltip');
    if (!isLineTooltipHovered && !enteredTooltip) {
      isLineTooltipHoverArmed = false;
    }
  }

  function handleLineTooltipEnter() {
    isLineTooltipHovered = true;
  }

  function handleLineTooltipLeave(event: MouseEvent) {
    isLineTooltipHovered = false;
    const nextTarget = event.relatedTarget as Node | null;
    const returnedToTrigger =
      nextTarget instanceof Node &&
      (nextTarget as HTMLElement).closest?.('.header-info');
    if (!returnedToTrigger) {
      isLineTooltipHoverArmed = false;
    }
  }
</script>

<svelte:window
  on:pointerup={handleHeaderControlPointerEnd}
  on:pointercancel={handleHeaderControlPointerEnd}
/>

<div class="debug-panel">
  <div class="debug-header">
    <button
      class="header-btn has-tooltip"
      class:active={isInspectorEnabled}
      class:disabled={!debugState.isEnabled}
      on:pointerdown={(event) => handleHeaderControlPointerDown(event, onToggleInspectorEnabled)}
      on:keydown={(event) => handleHeaderControlKeydown(event, onToggleInspectorEnabled)}
      on:click|preventDefault|stopPropagation={() => {}}
      disabled={!debugState.isEnabled}
      aria-label="Toggle inspector"
      data-tooltip="Pixel Inspector{!debugState.isEnabled ? ' (enable debug first)' : ''}"
    >
      <i class="codicon codicon-inspect"></i>
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isInlineOn}
      on:pointerdown={(event) => handleHeaderControlPointerDown(event, onToggleInlineRendering)}
      on:keydown={(event) => handleHeaderControlKeydown(event, onToggleInlineRendering)}
      on:click|preventDefault|stopPropagation={() => {}}
      aria-label="Toggle inline rendering"
      data-tooltip="Inline Rendering"
    >
      <i class="codicon codicon-eye"></i>
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isLineLocked}
      on:pointerdown={(event) => handleHeaderControlPointerDown(event, () => shaderDebugManager?.toggleLineLock())}
      on:keydown={(event) => handleHeaderControlKeydown(event, () => shaderDebugManager?.toggleLineLock())}
      on:click|preventDefault|stopPropagation={() => {}}
      aria-label="Toggle line lock"
      data-tooltip={isLineLocked ? "Unlock line" : "Lock to line"}
    >
      {#if isLineLocked}
        <i class="codicon codicon-lock"></i>
      {:else}
        <i class="codicon codicon-unlock"></i>
      {/if}
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={normalizeMode !== 'off'}
      on:pointerdown={(event) => handleHeaderControlPointerDown(event, () => shaderDebugManager?.cycleNormalizeMode())}
      on:keydown={(event) => handleHeaderControlKeydown(event, () => shaderDebugManager?.cycleNormalizeMode())}
      on:click|preventDefault|stopPropagation={() => {}}
      aria-label="Cycle normalize mode"
      data-tooltip={normalizeTooltip}
    >
      <i class="codicon codicon-graph-line"></i>
      {#if normalizeMode !== 'off'}
        <span class="normalize-badge">{normalizeMode === 'soft' ? 'S' : 'A'}</span>
      {/if}
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isStepEnabled}
      on:pointerdown={(event) => handleHeaderControlPointerDown(event, () => shaderDebugManager?.toggleStep())}
      on:keydown={(event) => handleHeaderControlKeydown(event, () => shaderDebugManager?.toggleStep())}
      on:click|preventDefault|stopPropagation={() => {}}
      aria-label="Toggle step threshold"
      data-tooltip={isStepEnabled ? `Step: ON (edge=${stepEdge})` : "Step: OFF\nBinary threshold"}
    >
      <i class="codicon codicon-pulse"></i>
    </button>
    {#if isStepEnabled}
      <input
        type="number"
        step="0.05"
        min="0"
        max="1"
        value={stepEdge}
        on:input={handleStepEdgeInput}
        use:dragScrub={{ step: 0.05, onInput: (v) => shaderDebugManager?.setStepEdge(v) }}
        class="step-edge-input"
        aria-label="Step edge threshold"
      />
    {/if}
    <button
      class="header-btn has-tooltip"
      class:active={isVarInspectorOn}
      on:pointerdown={(event) => handleHeaderControlPointerDown(event, () => shaderDebugManager?.toggleVariableInspector())}
      on:keydown={(event) => handleHeaderControlKeydown(event, () => shaderDebugManager?.toggleVariableInspector())}
      on:click|preventDefault|stopPropagation={() => {}}
      aria-label="Toggle variable inspector"
      data-tooltip="Variable Inspector"
    >
      <i class="codicon codicon-symbol-variable"></i>
    </button>
    {#if lineNum !== null}
      <span class="line-tooltip-anchor">
        <span
          class="header-info"
          class:error={debugError}
          class:has-line-content={!debugError && debugState.lineContent}
          data-tooltip={lineTooltipText}
          role="presentation"
          on:mouseenter={handleLineTooltipTriggerEnter}
          on:mouseleave={handleLineTooltipTriggerLeave}
        >L{lineNum}</span>
        <div
          class="line-tooltip"
          class:visible={isLineTooltipVisible}
          class:error={debugError}
          class:has-line-content={!debugError && debugState.lineContent}
          role="presentation"
          on:mouseenter={handleLineTooltipEnter}
          on:mouseleave={handleLineTooltipLeave}
        >{lineTooltipText}</div>
      </span>
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
              onChange={(value) => shaderDebugManager?.setCustomParameter(index, value)}
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
                use:dragScrub={{ step: 1, onInput: (v) => { const num = Math.max(1, Math.round(v)); shaderDebugManager?.setLoopMaxIterations(loop.loopIndex, num > 0 ? num : null); } }}
                class="loop-input"
                aria-label="Max iterations for loop at line {loop.lineNumber + 1}"
              />
            </div>
          {/each}
        </div>
      {/if}

    {/if}

    {#if isVarInspectorOn}
      <VariablesSection
        {capturedVariables}
        isPixelMode={isInspectorActive || isInspectorLocked}
        isLoading={isVariableCaptureLoading}
        captureError={variableCaptureError}
        onExpandToggle={onExpandVarHistogram}
        {onVarClick}
        {variableCaptureManager}
        sampleSize={vsSampleSize}
        refreshMode={vsRefreshMode}
        pollingMs={vsPollingMs}
        hasPixelSelected={vsHasPixelSelected}
      />
    {:else}
      <div class="section var-hint-section">
        <span class="hint-text">Enable Variable Inspector to view variables</span>
      </div>
    {/if}

    <div class="section uniforms-section" class:has-border={hasContentAboveUniforms || isVarInspectorOn}>
      <div class="section-label">Uniforms</div>
      {#if uniforms}
        <div class="uniform-row"><span class="uniform-name">iTime</span><span class="uniform-value">{formatTime(uniforms.time)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iResolution</span><span class="uniform-value">{formatVec(uniforms.res)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iMouse</span><span class="uniform-value">{formatVec(uniforms.mouse)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iFrame</span><span class="uniform-value">{uniforms.frame}</span></div>
        <div class="uniform-row"><span class="uniform-name">iTimeDelta</span><span class="uniform-value">{uniforms.timeDelta.toFixed(4)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iFrameRate</span><span class="uniform-value">{uniforms.frameRate.toFixed(1)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iDate</span><span class="uniform-value">{formatVec(uniforms.date)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iSampleRate</span><span class="uniform-value">{uniforms.sampleRate}</span></div>
        {#each customUniformEntries as [name, value], i}
          <div class="uniform-row" class:custom-first={i === 0}><span class="uniform-name">{name}</span><span class="uniform-value">{formatCustomValue(value)}</span></div>
        {/each}
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

  .header-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .header-btn:disabled:hover {
    background: none;
  }

  /* CSS tooltips via data-tooltip attribute */
  .has-tooltip {
    position: relative;
  }

  .line-tooltip-anchor {
    position: relative;
    display: inline-flex;
  }

  .line-tooltip {
    position: absolute;
    top: 100%;
    left: 0;
    transform: translateY(0);
    padding: 4px 8px;
    background: var(--vscode-editorHoverWidget-background, #2d2d30);
    color: var(--vscode-editorHoverWidget-foreground, #cccccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
    border-radius: 3px;
    font-size: 12px;
    z-index: 100;
    width: max-content;
    max-width: 250px;
    white-space: pre;
    user-select: text;
    cursor: text;
    opacity: 0;
    transition: opacity 0.15s ease-in;
  }

  .line-tooltip.visible {
    opacity: 1;
  }

  .has-tooltip::after {
    content: attr(data-tooltip);
    position: absolute;
    top: 100%;
    left: 0;
    transform: translateY(6px);
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

  .line-tooltip.has-line-content {
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

  .line-tooltip.error {
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

  .var-hint-section {
    border-top: 1px solid var(--vscode-panel-border);
    padding-top: 6px;
  }

  .uniform-row.custom-first {
    border-top: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.06));
    margin-top: 2px;
    padding-top: 4px;
  }

  .uniform-name {
    color: var(--vscode-descriptionForeground);
  }

  .uniform-value {
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-editor-foreground);
  }
</style>
