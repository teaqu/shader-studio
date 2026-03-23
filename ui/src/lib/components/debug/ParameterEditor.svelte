<script lang="ts">
  import type { DebugParameterInfo } from "../../types/ShaderDebugState";
  import { dragScrub } from "../../actions/dragScrub";

  export let param: DebugParameterInfo;
  export let onChange: (glslValue: string) => void = () => {};

  let expression = param.expression || param.defaultExpression;
  let presetMenu: HTMLDetailsElement | undefined;

  const isVec = param.type === 'vec2' || param.type === 'vec3' || param.type === 'vec4';
  const componentCount = param.type === 'vec2' ? 2 : param.type === 'vec3' ? 3 : param.type === 'vec4' ? 4 : 0;
  const floatPresets = ['iTime', 'sin(iTime)', 'cos(iTime)', 'fract(iTime)', 'iTimeDelta'];
  const intPresets = ['iFrame', 'int(iTime)'];
  const boolPresets = ['iTime > 1.0', 'iFrame > 30'];
  const vec2Presets = ['iMouse.xy/iResolution.xy', 'iResolution.xy'];
  const vec3Presets = ['vec3(iTime)', 'vec3(sin(iTime))'];
  const vec4Presets = ['vec4(iTime)', 'vec4(sin(iTime), cos(iTime), 0.0, 1.0)'];
  const quickExpressions: Record<string, string[]> = {
    float: floatPresets,
    int: intPresets,
    bool: boolPresets,
    vec2: vec2Presets,
    vec3: vec3Presets,
    vec4: vec4Presets,
    sampler2D: ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3'],
  };

  function normalizeExpression(type: string, value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    if (type === 'vec2' || type === 'vec3' || type === 'vec4') {
      const ctorMatch = trimmed.match(/^\s*vec[234]\s*\(/);
      if (ctorMatch) return trimmed;
      if (trimmed.includes(',')) return `${type}(${trimmed})`;
    }

    return trimmed;
  }

  function escapeExpression(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightExpression(value: string): string {
    const escaped = escapeExpression(value || '');
    const tokenPattern = /(\b(?:vec[234]|float|int|bool|true|false)\b|\b(?:sin|cos|tan|fract|mix|clamp|min|max|normalize|length|dot|pow|smoothstep|step)\b(?=\s*\()|\bi(?:Time|TimeDelta|Frame|Mouse|Resolution|Channel[0-3])\b|-?\b\d*\.?\d+(?:e[+-]?\d+)?\b)/g;

    return escaped.replace(tokenPattern, (token) => {
      if (/^-?\d/.test(token)) return `<span class="expr-number">${token}</span>`;
      if (/^(true|false|bool)$/.test(token)) return `<span class="expr-keyword">${token}</span>`;
      if (/^(vec[234]|float|int)$/.test(token)) return `<span class="expr-type">${token}</span>`;
      if (/^i(?:Time|TimeDelta|Frame|Mouse|Resolution|Channel[0-3])$/.test(token)) return `<span class="expr-uniform">${token}</span>`;
      return `<span class="expr-fn">${token}</span>`;
    });
  }

  function parseNumericValue(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseVectorComponents(type: string, value: string): number[] | null {
    const trimmed = normalizeExpression(type, value);
    const ctor = trimmed.match(/^vec[234]\((.*)\)$/);
    if (!ctor) return null;

    const parts = ctor[1].split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length !== componentCount) return null;

    const values = parts.map(parseNumericValue);
    if (values.some(v => v === null)) return null;
    return values as number[];
  }

  function emit(nextValue: string) {
    expression = nextValue;
    onChange(normalizeExpression(param.type, nextValue));
  }

  function applyQuickExpression(value: string) {
    emit(value);
  }

  function handlePresetSelect(value: string) {
    applyQuickExpression(value);
    presetMenu?.removeAttribute('open');
  }

  function handleExpressionInput(event: Event) {
    emit((event.target as HTMLInputElement).value);
  }

  function handleExpressionBlur() {
    expression = normalizeExpression(param.type, expression);
  }

  function updateFloatValue(next: number) {
    emit(String(next));
  }

  function updateBoolValue(next: boolean) {
    emit(next ? 'true' : 'false');
  }

  function updateSampler(value: string) {
    emit(value);
  }

  function vecToHex(components: number[]): string {
    const r = Math.round(Math.max(0, Math.min(1, components[0] ?? 0)) * 255);
    const g = Math.round(Math.max(0, Math.min(1, components[1] ?? 0)) * 255);
    const b = Math.round(Math.max(0, Math.min(1, components[2] ?? 0)) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function handleColorPicker(event: Event) {
    const hex = (event.target as HTMLInputElement).value;
    const r = (parseInt(hex.slice(1, 3), 16) / 255).toFixed(2);
    const g = (parseInt(hex.slice(3, 5), 16) / 255).toFixed(2);
    const b = (parseInt(hex.slice(5, 7), 16) / 255).toFixed(2);
    if (param.type === 'vec3') {
      emit(`vec3(${r}, ${g}, ${b})`);
    } else if (param.type === 'vec4') {
      const components = parseVectorComponents('vec4', expression) || [Number(r), Number(g), Number(b), 1];
      emit(`vec4(${r}, ${g}, ${b}, ${components[3].toFixed(2)})`);
    }
  }

  $: floatValue = parseNumericValue(expression);
  $: boolValue = expression.trim() === 'true';
  $: vecComponents = isVec ? parseVectorComponents(param.type, expression) : null;
  $: quickChips = quickExpressions[param.type] || [];
  $: sliderDisplayValue = Number.isFinite(floatValue ?? NaN) ? Math.max(0, Math.min(1, floatValue as number)) : 0;
  $: highlightedExpression = highlightExpression(expression || param.defaultExpression);
</script>

<div class="param-editor">
  <div class="param-row">
    <span class="param-name">{param.name}</span>
    <span class="param-type">{param.type}</span>
    <div class="expression-shell">
      <div class="expression-highlight" aria-hidden="true">
        {@html highlightedExpression}
      </div>
      <input
        class="expression-input"
        type="text"
        value={expression}
        on:input={handleExpressionInput}
        on:blur={handleExpressionBlur}
        aria-label="Expression for {param.name}"
        placeholder={param.defaultExpression}
        spellcheck="false"
      />
    </div>
    {#if param.type === 'vec3' || param.type === 'vec4'}
      <input
        type="color"
        value={vecToHex(vecComponents || [0, 0, 0])}
        on:input={handleColorPicker}
        class="color-picker"
        aria-label="Color picker for {param.name}"
      />
    {/if}
    {#if param.type === 'float'}
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={sliderDisplayValue}
        on:input={(e) => updateFloatValue(parseFloat((e.target as HTMLInputElement).value) || 0)}
        use:dragScrub={{ step: 0.01, onInput: (v) => updateFloatValue(v) }}
        class="value-slider value-slider-inline"
        aria-label="Float slider for {param.name}"
      />
    {/if}
    {#if quickChips.length > 0}
      <details class="preset-menu" bind:this={presetMenu}>
        <summary class="preset-trigger" aria-label="Preset for {param.name}">
          <span class="preset-icon" aria-hidden="true">⋯</span>
        </summary>
        <div class="preset-popover">
          {#each quickChips as chip}
            <button
              class="preset-option"
              type="button"
              on:click={() => handlePresetSelect(chip)}
            >
              {chip}
            </button>
          {/each}
        </div>
      </details>
    {/if}
  </div>

  {#if param.type === 'int'}
    <div class="control-row">
      <input
        type="number"
        step="1"
        value={parseNumericValue(expression) ?? ''}
        on:input={(e) => emit((e.target as HTMLInputElement).value)}
        use:dragScrub={{ step: 1, onInput: (v) => emit(String(Math.round(v))) }}
        class="value-input"
        aria-label="Int value for {param.name}"
      />
    </div>
  {:else if param.type === 'bool'}
    <div class="control-row">
      <label class="checkbox-row">
        <input
          type="checkbox"
          checked={boolValue}
          on:change={(e) => updateBoolValue((e.target as HTMLInputElement).checked)}
          aria-label="Bool value for {param.name}"
        />
        <span>Toggle</span>
      </label>
    </div>
  {:else if param.type === 'sampler2D'}
    <div class="control-row">
      <select class="channel-select" value={expression} on:change={(e) => updateSampler((e.target as HTMLSelectElement).value)} aria-label="Channel for {param.name}">
        <option value="iChannel0">iChannel0</option>
        <option value="iChannel1">iChannel1</option>
        <option value="iChannel2">iChannel2</option>
        <option value="iChannel3">iChannel3</option>
      </select>
    </div>
  {/if}
</div>

<style>
  .param-editor {
    padding: 4px 0 6px;
  }

  .param-row {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: nowrap;
    min-width: 0;
  }

  .param-name {
    font-weight: 600;
    min-width: 40px;
    color: var(--vscode-editor-foreground);
  }

  .param-type {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    min-width: 40px;
  }

  .expression-input,
  .value-input,
  .channel-select,
  .preset-trigger {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    padding: 3px 6px;
    font-size: 13px;
  }

  .expression-input {
    width: 100%;
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--vscode-editor-font-family, monospace);
    background: transparent;
    color: transparent;
    caret-color: var(--vscode-input-foreground);
    position: relative;
    z-index: 1;
  }

  .expression-input::placeholder {
    color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));
  }

  .expression-shell {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
  }

  .expression-shell:focus-within {
    border-color: var(--vscode-focusBorder);
  }

  .expression-highlight {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 3px 6px;
    overflow: hidden;
    white-space: nowrap;
    pointer-events: none;
    font-size: 13px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-input-foreground);
  }

  .expression-highlight :global(.expr-keyword) {
    color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-editor-foreground));
  }

  .expression-highlight :global(.expr-type) {
    color: var(--vscode-symbolIcon-classForeground, var(--vscode-editor-foreground));
  }

  .expression-highlight :global(.expr-uniform) {
    color: var(--vscode-debugTokenExpression-name, var(--vscode-editor-foreground));
  }

  .expression-highlight :global(.expr-number) {
    color: var(--vscode-debugTokenExpression-number, var(--vscode-editor-foreground));
  }

  .expression-highlight :global(.expr-fn) {
    color: var(--vscode-symbolIcon-functionForeground, var(--vscode-editor-foreground));
  }

  .preset-menu {
    position: relative;
    flex: 0 0 auto;
  }

  .preset-trigger {
    display: grid;
    place-items: center;
    width: 28px;
    min-width: 28px;
    list-style: none;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    padding: 3px 0;
  }

  .preset-trigger::-webkit-details-marker {
    display: none;
  }

  .preset-menu[open] .preset-trigger {
    border-color: var(--vscode-focusBorder);
  }

  .preset-icon {
    font-size: 16px;
    line-height: 1;
    transform: translateY(-1px);
  }

  .preset-popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    max-width: 240px;
    padding: 4px;
    background: var(--vscode-editorWidget-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
    border-radius: 4px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24);
    z-index: 3;
  }

  .preset-option {
    background: transparent;
    border: 0;
    border-radius: 3px;
    color: var(--vscode-editor-foreground);
    cursor: pointer;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    padding: 6px 8px;
    text-align: left;
  }

  .preset-option:hover {
    background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.06));
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .value-input {
    width: 70px;
  }

  .value-slider {
    width: 90px;
    height: 16px;
  }

  .value-slider-inline {
    width: 116px;
    flex: 0 0 116px;
  }

  .checkbox-row {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .color-picker {
    width: 26px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--vscode-input-border);
    cursor: pointer;
  }
</style>
