<script lang="ts">
  import type { DebugParameterInfo, ParameterMode } from "../../types/ShaderDebugState";
  import { dragScrub } from "../../actions/dragScrub";

  export let param: DebugParameterInfo;
  export let onChange: (glslValue: string) => void = () => {};

  let mode: ParameterMode = param.mode;
  let customValue: string = param.customValue;
  let presetExpression: string = '';

  // Float-specific
  let floatValue = parseFloat(param.defaultCustomValue) || 0.5;

  // Vec component values and per-component modes
  let vecComponents: number[] = parseVecComponents(param.defaultCustomValue, param.type);
  let vecComponentModes: string[] = initComponentModes(param.type);
  let vecComponentPresets: string[] = initComponentPresets(param.type);

  // Bool
  let boolValue = param.defaultCustomValue === 'true';

  // sampler2D channel
  let channel = param.defaultCustomValue;

  // Component labels per vec type
  const vecLabels: Record<string, string[]> = {
    'vec2': ['X', 'Y'],
    'vec3': ['R', 'G', 'B'],
    'vec4': ['X', 'Y', 'Z', 'W'],
  };

  // Preset options per type
  const floatPresets = ['iTime', 'sin(iTime)', 'cos(iTime)', 'fract(iTime)', 'iTimeDelta'];
  const intPresets = ['iFrame', 'int(iTime)'];
  const boolPresets = ['iTime > 1.0', 'iFrame > 30'];

  // Per-component presets (float-level values suitable for a single component)
  const componentPresets = ['iTime', 'sin(iTime)', 'cos(iTime)', 'fract(iTime)', 'uv.x', 'uv.y'];

  // Whole-vec presets
  const vec2Presets = ['iMouse.xy/iResolution.xy', 'iResolution.xy'];
  const vec3Presets = ['vec3(iTime)', 'vec3(sin(iTime))'];
  const vec4Presets = ['vec4(iTime)', 'vec4(sin(iTime), cos(iTime), 0.0, 1.0)'];

  function getPresetsForType(type: string): string[] {
    switch (type) {
      case 'float': return floatPresets;
      case 'int': return intPresets;
      case 'vec2': return vec2Presets;
      case 'vec3': return vec3Presets;
      case 'vec4': return vec4Presets;
      case 'bool': return boolPresets;
      default: return [];
    }
  }

  $: presets = getPresetsForType(param.type);
  $: isVec = param.type === 'vec2' || param.type === 'vec3' || param.type === 'vec4';
  $: compCount = isVec ? (param.type === 'vec2' ? 2 : param.type === 'vec3' ? 3 : 4) : 0;
  $: labels = vecLabels[param.type] || [];

  function initComponentModes(type: string): string[] {
    const count = type === 'vec2' ? 2 : type === 'vec3' ? 3 : type === 'vec4' ? 4 : 0;
    return new Array(count).fill('custom');
  }

  function initComponentPresets(type: string): string[] {
    const count = type === 'vec2' ? 2 : type === 'vec3' ? 3 : type === 'vec4' ? 4 : 0;
    return new Array(count).fill('');
  }

  function parseVecComponents(value: string, type: string): number[] {
    const parenMatch = value.match(/\(([^)]*)\)/);
    const inner = parenMatch ? parenMatch[1] : value;
    const match = inner.match(/[\d.eE+-]+/g);
    const nums = match ? match.map(Number).filter(n => !isNaN(n)) : [];
    switch (type) {
      case 'vec2': return nums.length >= 2 ? nums.slice(0, 2) : [nums[0] ?? 0.5, nums[0] ?? 0.5];
      case 'vec3': return nums.length >= 3 ? nums.slice(0, 3) : [nums[0] ?? 0.5, nums[0] ?? 0.5, nums[0] ?? 0.5];
      case 'vec4': return nums.length >= 4 ? nums.slice(0, 4) : [nums[0] ?? 0.5, nums[0] ?? 0.5, nums[0] ?? 0.5, nums[0] ?? 1.0];
      default: return [];
    }
  }

  function vecToHex(components: number[]): string {
    const r = Math.round(Math.max(0, Math.min(1, components[0] ?? 0)) * 255);
    const g = Math.round(Math.max(0, Math.min(1, components[1] ?? 0)) * 255);
    const b = Math.round(Math.max(0, Math.min(1, components[2] ?? 0)) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function getComponentExpression(index: number): string {
    const compMode = vecComponentModes[index];
    if (compMode === 'custom') {
      return String(vecComponents[index]);
    } else if (compMode.startsWith('preset:')) {
      return compMode.substring(7);
    }
    return String(vecComponents[index]);
  }

  function emitValue() {
    if (mode === 'uv') {
      onChange(param.uvValue);
      return;
    }
    if (mode === 'centered-uv') {
      onChange(param.centeredUvValue);
      return;
    }
    if (mode === 'preset') {
      onChange(presetExpression);
      return;
    }
    // mode === 'custom'
    switch (param.type) {
      case 'float':
        onChange(String(floatValue));
        break;
      case 'vec2':
      case 'vec3':
      case 'vec4': {
        const components = [];
        for (let i = 0; i < compCount; i++) {
          components.push(getComponentExpression(i));
        }
        onChange(`${param.type}(${components.join(', ')})`);
        break;
      }
      case 'int':
        onChange(customValue);
        break;
      case 'bool':
        onChange(boolValue ? 'true' : 'false');
        break;
      case 'sampler2D':
        onChange(channel);
        break;
      default:
        onChange(customValue);
    }
  }

  function handleModeChange(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    if (val.startsWith('preset:')) {
      mode = 'preset';
      presetExpression = val.substring(7);
    } else {
      mode = val as ParameterMode;
    }
    emitValue();
  }

  function handleComponentModeChange(index: number, event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    vecComponentModes[index] = val;
    vecComponentModes = [...vecComponentModes];
    emitValue();
  }

  function handleFloatInput(event: Event) {
    floatValue = parseFloat((event.target as HTMLInputElement).value) || 0;
    emitValue();
  }

  function handleVecInput(index: number, event: Event) {
    vecComponents[index] = parseFloat((event.target as HTMLInputElement).value) || 0;
    vecComponents = [...vecComponents];
    emitValue();
  }

  function handleBoolChange(event: Event) {
    boolValue = (event.target as HTMLInputElement).checked;
    emitValue();
  }

  function handleChannelChange(event: Event) {
    channel = (event.target as HTMLSelectElement).value;
    emitValue();
  }

  function handleIntInput(event: Event) {
    customValue = (event.target as HTMLInputElement).value;
    emitValue();
  }

  function handleColorPicker(event: Event) {
    const hex = (event.target as HTMLInputElement).value;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    vecComponents = [r, g, b];
    emitValue();
  }

  $: isSampler = param.type === 'sampler2D';
  $: showModeDropdown = !isSampler;
  $: modeSelectValue = mode === 'preset' ? `preset:${presetExpression}` : mode;
</script>

<div class="param-row">
  <span class="param-name">{param.name}</span>
  <span class="param-type">{param.type}</span>

  {#if showModeDropdown}
    <select class="mode-select" value={modeSelectValue} on:change={handleModeChange} aria-label="Parameter mode for {param.name}">
      <option value="uv">UV</option>
      <option value="centered-uv">Centered UV</option>
      <option value="custom">Custom</option>
      {#if presets.length > 0}
        <optgroup label="Uniforms">
          {#each presets as preset}
            <option value="preset:{preset}">{preset}</option>
          {/each}
        </optgroup>
      {/if}
    </select>
  {/if}

  {#if isSampler}
    <select class="channel-select" value={channel} on:change={handleChannelChange} aria-label="Channel for {param.name}">
      <option value="iChannel0">iChannel0</option>
      <option value="iChannel1">iChannel1</option>
      <option value="iChannel2">iChannel2</option>
      <option value="iChannel3">iChannel3</option>
    </select>
  {:else if mode === 'centered-uv'}
    <span class="preset-label">centered</span>
  {:else if mode === 'custom'}
    {#if param.type === 'float'}
      <input type="number" step="0.01" value={floatValue} on:input={handleFloatInput} use:dragScrub={{ step: 0.01, onInput: (v) => { floatValue = v; emitValue(); } }} class="value-input" aria-label="Float value for {param.name}" />
      <input type="range" min="0" max="1" step="0.01" value={floatValue} on:input={handleFloatInput} class="value-slider" aria-label="Float slider for {param.name}" />
    {:else if isVec}
      <!-- handled below in component rows -->
    {:else if param.type === 'int'}
      <input type="number" step="1" value={customValue} on:input={handleIntInput} use:dragScrub={{ step: 1, onInput: (v) => { customValue = String(v); emitValue(); } }} class="value-input" aria-label="Int value for {param.name}" />
    {:else if param.type === 'bool'}
      <input type="checkbox" checked={boolValue} on:change={handleBoolChange} aria-label="Bool value for {param.name}" />
    {/if}
  {:else if mode === 'preset'}
    <span class="preset-label">{presetExpression}</span>
  {/if}
</div>

{#if isVec && mode === 'custom'}
  <div class="vec-components">
    {#each { length: compCount } as _, i}
      <div class="vec-comp-row">
        <span class="comp-label">{labels[i]}</span>
        <select
          class="comp-mode-select"
          value={vecComponentModes[i]}
          on:change={(e) => handleComponentModeChange(i, e)}
          aria-label="{labels[i]} component mode for {param.name}"
        >
          <option value="custom">Custom</option>
          {#each componentPresets as preset}
            <option value="preset:{preset}">{preset}</option>
          {/each}
        </select>
        {#if vecComponentModes[i] === 'custom'}
          <input
            type="number"
            step="0.01"
            value={vecComponents[i]}
            on:input={(e) => handleVecInput(i, e)}
            use:dragScrub={{ step: 0.01, onInput: (v) => { vecComponents[i] = v; vecComponents = [...vecComponents]; emitValue(); } }}
            class="value-input vec-input"
            aria-label="{labels[i]} value"
          />
        {/if}
      </div>
    {/each}
    {#if param.type === 'vec3'}
      <input type="color" value={vecToHex(vecComponents)} on:input={handleColorPicker} class="color-picker" aria-label="Color picker for {param.name}" />
    {/if}
  </div>
{/if}

<style>
  .param-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 14px;
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

  .mode-select, .channel-select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 2px;
    padding: 2px 4px;
    font-size: 13px;
  }

  .value-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    padding: 2px 6px;
    font-size: 13px;
    width: 60px;
  }

  .vec-input {
    width: 50px;
  }

  .value-slider {
    width: 70px;
    height: 16px;
  }

  .color-picker {
    width: 26px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--vscode-input-border);
    cursor: pointer;
    margin-left: 26px;
  }

  .preset-label {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    color: var(--vscode-editor-foreground);
    opacity: 0.8;
  }

  .vec-components {
    padding-left: 6px;
    margin-bottom: 4px;
  }

  .vec-comp-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  .comp-label {
    font-weight: 600;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    min-width: 14px;
    text-align: center;
  }

  .comp-mode-select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 2px;
    padding: 2px 4px;
    font-size: 12px;
  }
</style>
