<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from "svelte";
  import type { ShaderDebugState, DebugLoopInfo } from "../../types/ShaderDebugState";
  import type { PassUniforms } from "../../../../../rendering/src/models/PassUniforms";
  import ParameterEditor from "./ParameterEditor.svelte";

  import type { ShaderDebugManager } from "../../ShaderDebugManager";
  import type { VariableCaptureManager, RefreshMode } from "../../VariableCaptureManager";
  import { dragScrub } from "../../actions/dragScrub";
  import { debugPanelStore } from "../../stores/debugPanelStore";


  import VariablesSection from "./VariablesSection.svelte";

  type DebugPanelProps = {
    debugState?: ShaderDebugState;
    getUniforms?: () => PassUniforms | null;
    uniforms?: PassUniforms | null;
    isInspectorEnabled?: boolean;
    isInspectorActive?: boolean;
    isInspectorLocked?: boolean;
    shaderDebugManager?: ShaderDebugManager;
    variableCaptureManager?: VariableCaptureManager;
    onToggleInspectorEnabled?: () => void;
    onToggleInlineRendering?: () => void;
    onExpandVarHistogram?: (varName: string) => void;
    onVarClick?: (varName: string, declarationLine: number) => void;
    sampleSize?: number;
    refreshMode?: RefreshMode;
    pollingMs?: number;
    hasPixelSelected?: boolean;
    customUniformValues?: Record<string, number | number[] | boolean>;
    isVariableCaptureLoading?: boolean;
    variableCaptureError?: string | null;
    onCaptureSettingsChanged?: () => void;
  };

  let {
    debugState = undefined,
    getUniforms = () => null,
    uniforms = null,
    isInspectorEnabled = false,
    isInspectorActive = false,
    isInspectorLocked = false,
    shaderDebugManager = undefined,
    variableCaptureManager = undefined,
    onToggleInspectorEnabled = () => {},
    onToggleInlineRendering = () => {},
    onExpandVarHistogram = () => {},
    onVarClick = () => {},
    sampleSize: sampleSizeOverride = undefined,
    refreshMode: refreshModeOverride = undefined,
    pollingMs: pollingMsOverride = undefined,
    hasPixelSelected = false,
    customUniformValues = {},
    isVariableCaptureLoading: variableCaptureLoadingOverride = undefined,
    variableCaptureError: variableCaptureErrorOverride = undefined,
    onCaptureSettingsChanged = () => {},
  }: DebugPanelProps = $props();

  let liveUniforms = $state<PassUniforms | null>(null);
  let uniformsHandle = $state<number | null>(null);
  let isLineTooltipTriggerHovered = $state(false);
  let isLineTooltipHovered = $state(false);
  let isLineTooltipHoverArmed = $state(false);
  const activeHeaderPointers = new Set<number>();
  let persistedVariableInspectorEnabled = $state(false);
  let persistedInlineRenderingEnabled = $state(true);
  let persistedPixelInspectorEnabled = $state(true);
  let debugPanelPrefsRestored = $state(false);
  let lastAppliedPersistedVariableInspectorEnabled = $state<boolean | null>(null);
  let lastAppliedPersistedInlineRenderingEnabled = $state<boolean | null>(null);
  let lastObservedDebugStateVariableInspectorEnabled = $state<boolean | null>(null);
  let lastObservedDebugStateInlineRenderingEnabled = $state<boolean | null>(null);
  let internalSampleSize = $state(32);
  let internalRefreshMode = $state<RefreshMode>('polling');
  let internalPollingMs = $state(500);
  let internalVariableCaptureLoading = $state(false);
  let internalVariableCaptureError = $state<string | null>(null);

  const ctx = $derived(debugState?.functionContext);
  const isInlineOn = $derived(debugState?.isInlineRenderingEnabled);
  const isLineLocked = $derived(debugState?.isLineLocked);
  const lineNum = $derived(debugState?.currentLine !== null && debugState?.currentLine !== undefined ? debugState.currentLine + 1 : null);
  const isInFunction = $derived(ctx !== null && ctx !== undefined && ctx.isFunction);
  const hasVariable = $derived(debugState?.lineContent !== null && debugState?.lineContent !== undefined && debugState?.isActive);
  const normalizeMode = $derived(debugState?.normalizeMode);
  const isStepEnabled = $derived(debugState?.isStepEnabled);
  const stepEdge = $derived(debugState?.stepEdge);
  const debugError = $derived(debugState?.debugError);
  const debugNotice = $derived(debugState?.debugNotice);
  const lineTooltipText = $derived(
    debugError || debugNotice || (debugState?.lineContent ? debugState.lineContent.trim() : (lineNum !== null ? `Line ${lineNum}` : ''))
  );
  const isVarInspectorOn = $derived(debugState?.isVariableInspectorEnabled);
  const showParams = $derived((isInlineOn || isVarInspectorOn) && isInFunction && ctx !== null);
  const showLoops = $derived((isInlineOn || isVarInspectorOn) && ctx !== null && ctx !== undefined && ctx.loops.length > 0);
  const hasContentAboveUniforms = $derived((showParams && ctx && ctx.parameters.length > 0) || showLoops);
  const capturedVariables = $derived(debugState?.capturedVariables);
  const customUniformEntries = $derived(Object.entries(customUniformValues));
  const isLineTooltipVisible = $derived(
    isLineTooltipTriggerHovered || (isLineTooltipHoverArmed && isLineTooltipHovered)
  );
  const displayedUniforms = $derived(uniforms ?? liveUniforms);
  const sampleSize = $derived(
    sampleSizeOverride ?? internalSampleSize
  );
  const refreshMode = $derived(
    refreshModeOverride ?? internalRefreshMode
  );
  const pollingMs = $derived(
    pollingMsOverride ?? internalPollingMs
  );
  const variableCaptureLoading = $derived(variableCaptureLoadingOverride ?? internalVariableCaptureLoading);
  const variableCaptureError = $derived(variableCaptureErrorOverride ?? internalVariableCaptureError);

  const normalizeTooltip = $derived(normalizeMode === 'off'
    ? "Normalize: OFF\nRaw shader output values"
    : normalizeMode === 'soft'
    ? "Normalize: SOFT\nSigned normalization\nzero = gray (0.5)\nnegative < 0.5, positive > 0.5"
    : "Normalize: ABS\nAbsolute value normalization\nzero = black\nlarger magnitudes brighter");

  $effect(() => {
    const updateUniforms = () => {
      liveUniforms = getUniforms();
      uniformsHandle = requestAnimationFrame(updateUniforms);
    };
    uniformsHandle = requestAnimationFrame(updateUniforms);
    return () => {
      if (uniformsHandle !== null) {
        cancelAnimationFrame(uniformsHandle);
      }
      activeHeaderPointers.clear();
    };
  });

  onMount(() => {
    const unsubscribe = debugPanelStore.subscribe((state) => {
      persistedVariableInspectorEnabled = state.isVariableInspectorEnabled;
      persistedInlineRenderingEnabled = state.isInlineRenderingEnabled;
      persistedPixelInspectorEnabled = state.isPixelInspectorEnabled;
      debugPanelPrefsRestored = true;
    });

    return unsubscribe;
  });

  onMount(() => {
    if (!variableCaptureManager) {
      return;
    }

    internalSampleSize = variableCaptureManager.sampleSize;
    internalRefreshMode = variableCaptureManager.getActiveRefreshMode(hasPixelSelected);
    internalPollingMs = variableCaptureManager.getActivePollingMs(hasPixelSelected);
    variableCaptureManager.setLoadingStateCallback((isLoading) => {
      internalVariableCaptureLoading = isLoading;
    });
    variableCaptureManager.setErrorCallback((error) => {
      internalVariableCaptureError = error;
    });
    variableCaptureManager.setSampleSettingsCallback(() => {
      internalSampleSize = variableCaptureManager.sampleSize;
      internalRefreshMode = variableCaptureManager.getActiveRefreshMode(hasPixelSelected);
      internalPollingMs = variableCaptureManager.getActivePollingMs(hasPixelSelected);
      onCaptureSettingsChanged();
    });
  });

  $effect(() => {
    if (!shaderDebugManager || !debugPanelPrefsRestored) {
      return;
    }

    if (lastAppliedPersistedInlineRenderingEnabled !== persistedInlineRenderingEnabled) {
      lastAppliedPersistedInlineRenderingEnabled = persistedInlineRenderingEnabled;
      shaderDebugManager.setInlineRenderingEnabled?.(persistedInlineRenderingEnabled);
    }

    if (lastAppliedPersistedVariableInspectorEnabled !== persistedVariableInspectorEnabled) {
      lastAppliedPersistedVariableInspectorEnabled = persistedVariableInspectorEnabled;
      shaderDebugManager.setVariableInspectorEnabled?.(persistedVariableInspectorEnabled);
    }
  });

  $effect(() => {
    if (!debugPanelPrefsRestored || !debugState) {
      return;
    }

    if (lastObservedDebugStateVariableInspectorEnabled !== debugState.isVariableInspectorEnabled) {
      lastObservedDebugStateVariableInspectorEnabled = debugState.isVariableInspectorEnabled;
    } else {
      return;
    }

    if (persistedVariableInspectorEnabled !== debugState.isVariableInspectorEnabled) {
      debugPanelStore.setVariableInspectorEnabled(debugState.isVariableInspectorEnabled);
    }
  });

  $effect(() => {
    if (!debugPanelPrefsRestored || !debugState) {
      return;
    }

    if (lastObservedDebugStateInlineRenderingEnabled !== debugState.isInlineRenderingEnabled) {
      lastObservedDebugStateInlineRenderingEnabled = debugState.isInlineRenderingEnabled;
    } else {
      return;
    }

    if (persistedInlineRenderingEnabled !== debugState.isInlineRenderingEnabled) {
      debugPanelStore.setInlineRenderingEnabled(debugState.isInlineRenderingEnabled);
    }
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
    if (!v) {
      return '—';
    }
    return Array.from(v).map(n => n.toFixed(1)).join(', ');
  }

  function formatCustomValue(val: number | number[] | boolean | undefined): string {
    if (val === undefined) {
      return '—';
    }
    if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    }
    if (typeof val === 'number') {
      return val.toFixed(3);
    }
    if (Array.isArray(val)) {
      return val.map(v => v.toFixed(2)).join(', ');
    }
    return String(val);
  }

  function activateHeaderControl(action: () => void) {
    action();
  }

  function handleToggleInlineRendering() {
    debugPanelStore.setInlineRenderingEnabled(!persistedInlineRenderingEnabled);
    onToggleInlineRendering();
  }

  function handleToggleInspectorEnabled() {
    if (!debugState?.isEnabled) {
      return;
    }
    debugPanelStore.setPixelInspectorEnabled(!persistedPixelInspectorEnabled);
    onToggleInspectorEnabled();
  }

  function handleToggleVariableInspector() {
    debugPanelStore.setVariableInspectorEnabled(!persistedVariableInspectorEnabled);
  }

  function handleHeaderControlPointerDown(event: PointerEvent, action: () => void) {
    const isPrimaryPress = event.isPrimary ?? true;
    const isMainButton = event.button ?? 0;
    if (!isPrimaryPress || isMainButton !== 0) {
      return;
    }
    if (activeHeaderPointers.has(event.pointerId)) {
      return;
    }

    activeHeaderPointers.add(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    activateHeaderControl(action);
  }

  function handleHeaderControlPointerEnd(event: PointerEvent) {
    activeHeaderPointers.delete(event.pointerId);
  }

  function handleHeaderControlKeydown(event: KeyboardEvent, action: () => void) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    activateHeaderControl(action);
  }

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

  function escapeLoopHeader(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightLoopHeader(value: string) {
    const escaped = escapeLoopHeader(value);
    const tokenPattern = /(\b(?:for|while|if|return)\b|\b(?:int|float|bool|vec[234])\b|-?\b\d+\b)/g;

    return escaped.replace(tokenPattern, (token) => {
      if (/^(for|while|if|return)$/.test(token)) {
        return `<span class="loop-keyword">${token}</span>`;
      }
      if (/^(int|float|bool|vec[234])$/.test(token)) {
        return `<span class="loop-type">${token}</span>`;
      }
      return `<span class="loop-number">${token}</span>`;
    });
  }
</script>

<svelte:window
  onpointerup={handleHeaderControlPointerEnd}
  onpointercancel={handleHeaderControlPointerEnd}
/>

<div class="debug-panel">
  <div class="debug-header">
    <button
      class="header-btn has-tooltip"
      class:active={isInspectorEnabled}
      class:disabled={!debugState?.isEnabled}
      onpointerdown={(event) => handleHeaderControlPointerDown(event, handleToggleInspectorEnabled)}
      onkeydown={(event) => handleHeaderControlKeydown(event, handleToggleInspectorEnabled)}
      onclick={(event) => {
        event.preventDefault(); event.stopPropagation(); 
      }}
      disabled={!debugState?.isEnabled}
      aria-label="Toggle inspector"
      data-tooltip="Pixel Inspector{!debugState?.isEnabled ? ' (enable debug first)' : ''}"
    >
      <i class="codicon codicon-inspect"></i>
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isVarInspectorOn}
      onpointerdown={(event) => handleHeaderControlPointerDown(event, handleToggleVariableInspector)}
      onkeydown={(event) => handleHeaderControlKeydown(event, handleToggleVariableInspector)}
      onclick={(event) => {
        event.preventDefault(); event.stopPropagation(); 
      }}
      aria-label="Toggle variable inspector"
      data-tooltip="Variable Inspector"
    >
      <i class="codicon codicon-symbol-variable"></i>
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isInlineOn}
      onpointerdown={(event) => handleHeaderControlPointerDown(event, handleToggleInlineRendering)}
      onkeydown={(event) => handleHeaderControlKeydown(event, handleToggleInlineRendering)}
      onclick={(event) => {
        event.preventDefault(); event.stopPropagation(); 
      }}
      aria-label="Toggle inline rendering"
      data-tooltip="Inline Rendering"
    >
      <i class="codicon codicon-eye"></i>
    </button>
    <button
      class="header-btn has-tooltip"
      class:active={isLineLocked}
      onpointerdown={(event) => handleHeaderControlPointerDown(event, () => shaderDebugManager?.toggleLineLock())}
      onkeydown={(event) => handleHeaderControlKeydown(event, () => shaderDebugManager?.toggleLineLock())}
      onclick={(event) => {
        event.preventDefault(); event.stopPropagation(); 
      }}
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
      onpointerdown={(event) => handleHeaderControlPointerDown(event, () => shaderDebugManager?.cycleNormalizeMode())}
      onkeydown={(event) => handleHeaderControlKeydown(event, () => shaderDebugManager?.cycleNormalizeMode())}
      onclick={(event) => {
        event.preventDefault(); event.stopPropagation(); 
      }}
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
      onpointerdown={(event) => handleHeaderControlPointerDown(event, () => shaderDebugManager?.toggleStep())}
      onkeydown={(event) => handleHeaderControlKeydown(event, () => shaderDebugManager?.toggleStep())}
      onclick={(event) => {
        event.preventDefault(); event.stopPropagation(); 
      }}
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
        oninput={handleStepEdgeInput}
        use:dragScrub={{ step: 0.05, onInput: (v) => shaderDebugManager?.setStepEdge(v) }}
        class="step-edge-input"
        aria-label="Step edge threshold"
      />
    {/if}
    {#if lineNum !== null}
      <span class="line-tooltip-anchor">
        <span
          class="header-info"
          class:error={debugError}
          class:has-line-content={!debugError && !debugNotice && debugState?.lineContent}
          data-tooltip={lineTooltipText}
          role="presentation"
          onmouseenter={handleLineTooltipTriggerEnter}
          onmouseleave={handleLineTooltipTriggerLeave}
        >L{lineNum}</span>
        <div
          class="line-tooltip"
          class:visible={isLineTooltipVisible}
          class:error={debugError}
          class:has-line-content={!debugError && !debugNotice && debugState?.lineContent}
          role="presentation"
          onmouseenter={handleLineTooltipEnter}
          onmouseleave={handleLineTooltipLeave}
        >{lineTooltipText}</div>
      </span>
    {/if}
    {#if isInlineOn && ctx}
      <span class="header-info fn-name">{ctx.functionName}</span>
      <span class="header-info fn-type">{ctx.returnType}</span>
    {/if}
    {#if debugState?.isEnabled && debugState?.activeBufferName && debugState.activeBufferName !== 'Image'}
      <span class="buffer-badge">{debugState.activeBufferName}</span>
    {/if}
  </div>

  <div class="debug-content">
    {#if isInlineOn && !hasVariable}
      <div class="section hint-section">
        <span class="hint-text">Place cursor on a GLSL line to inspect</span>
      </div>
    {/if}
    {#if isInlineOn || isVarInspectorOn}
      {#if showParams && ctx && ctx.parameters.length > 0}
        <div class="section">
          <div class="section-heading">
            <div class="section-label">Parameters</div>
            <button
              class="section-reset"
              type="button"
              onclick={() => shaderDebugManager?.resetCustomParameters()}
              aria-label="Reset parameters"
            >
              Reset
            </button>
          </div>
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
              <span class="loop-header has-tooltip" data-tooltip={loop.loopHeader}>
                {@html highlightLoopHeader(loop.loopHeader)}
              </span>
              <span class="loop-iter-label">Iterations</span>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="max"
                value={loop.maxIter ?? ''}
                oninput={(e) => handleLoopIterInput(loop, e)}
                use:dragScrub={{ step: 1, onInput: (v) => {
                  const num = Math.max(1, Math.round(v)); shaderDebugManager?.setLoopMaxIterations(loop.loopIndex, num > 0 ? num : null); 
                } }}
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
        isLoading={variableCaptureLoading}
        captureError={variableCaptureError}
        onExpandToggle={onExpandVarHistogram}
        {onVarClick}
        {variableCaptureManager}
        {sampleSize}
        {refreshMode}
        {pollingMs}
        {hasPixelSelected}
        hasBorderTop={isInlineOn || hasContentAboveUniforms}
      />
    {:else}
      <div class="section var-hint-section" class:has-border={isInlineOn}>
        <span class="hint-text">Enable Variable Inspector to view variables</span>
      </div>
    {/if}

    <div class="section uniforms-section" class:has-border={hasContentAboveUniforms || isVarInspectorOn}>
      <div class="section-label">Uniforms</div>
      {#if displayedUniforms}
        <div class="uniform-row"><span class="uniform-name">iTime</span><span class="uniform-value">{formatTime(displayedUniforms.time)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iResolution</span><span class="uniform-value">{formatVec(displayedUniforms.res)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iMouse</span><span class="uniform-value">{formatVec(displayedUniforms.mouse)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iFrame</span><span class="uniform-value">{displayedUniforms.frame}</span></div>
        <div class="uniform-row"><span class="uniform-name">iTimeDelta</span><span class="uniform-value">{displayedUniforms.timeDelta.toFixed(4)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iFrameRate</span><span class="uniform-value">{displayedUniforms.frameRate.toFixed(1)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iDate</span><span class="uniform-value">{formatVec(displayedUniforms.date)}</span></div>
        <div class="uniform-row"><span class="uniform-name">iSampleRate</span><span class="uniform-value">{displayedUniforms.sampleRate}</span></div>
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

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .section-heading .section-label {
    margin-bottom: 0;
  }

  .section-reset {
    background: var(--vscode-button-secondaryBackground, var(--vscode-toolbar-hoverBackground));
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px;
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 3px 8px;
  }

  .section-reset:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
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

  .loop-header :global(.loop-keyword) {
    color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
    font-weight: 600;
  }

  .loop-header :global(.loop-type) {
    color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
  }

  .loop-header :global(.loop-number) {
    color: var(--vscode-debugTokenExpression-number, #b5cea8);
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
    padding-top: 6px;
  }

  .var-hint-section.has-border {
    border-top: 1px solid var(--vscode-panel-border);
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
