<script lang="ts">
  import PathInput from './PathInput.svelte';

  export let filename: string;
  export let uniforms: { name: string; type: string }[] = [];
  export let uniformValues: Record<string, number | number[] | boolean> = {};
  export let uniformActualFps: Record<string, number> = {};
  export let pollingFps: number = 30;
  export let actualFps: number = 0;
  export let onPollingFpsChange: ((fps: number) => void) | undefined = undefined;
  export let onPathChange: ((path: string) => void) | undefined = undefined;
  export let suggestedPath: string = '';
  export let fileExists: boolean = true;
  export let shaderPath: string = '';
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;

  let showUniformFps = false;

  function formatValue(val: number | number[] | boolean | undefined): string {
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

  const POLLING_PRESETS = [
    { label: '1fps', fps: 1 },
    { label: '30fps', fps: 30 },
    { label: '60fps', fps: 60 },
    { label: '120fps', fps: 120 },
  ];

  let localFps = pollingFps;
  $: localFps = pollingFps;

  function handleSliderInput(e: Event) {
    localFps = parseInt((e.target as HTMLInputElement).value);
  }

  function handleSliderCommit(e: Event) {
    const fps = parseInt((e.target as HTMLInputElement).value);
    onPollingFpsChange?.(fps);
  }

  function setPreset(fps: number) {
    localFps = fps;
    onPollingFpsChange?.(fps);
  }

</script>

<div class="script-tab-content">
  <PathInput
    value={filename}
    placeholder={suggestedPath || 'e.g., ./uniforms.ts'}
    {onPathChange}
    {fileExists}
    fileType="script"
    {shaderPath}
    suggestedPath={suggestedPath}
    {postMessage}
    {onMessage}
  />

  {#if uniforms.length > 0}
    <div class="uniforms-section">
      <div class="uniforms-header">
        <span class="section-label">Uniforms</span>
        <label class="fps-toggle">
          <input type="checkbox" bind:checked={showUniformFps} />
          show fps
        </label>
      </div>
      <div class="uniforms-list" class:show-fps={showUniformFps}>
        {#each uniforms as u}
          <div class="uniform-row">
            <span class="uniform-type">{u.type}</span>
            <span class="uniform-name">{u.name}</span>
            <span class="uniform-value">{formatValue(uniformValues[u.name])}</span>
            {#if showUniformFps}
              <span class="uniform-fps">{uniformActualFps[u.name] ?? 0}fps</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="uniforms-empty">No uniforms detected</div>
  {/if}

  <div class="polling-section">
    <div class="polling-header">
      <span class="section-label">Max Polling Rate</span>
      <span class="polling-value">{localFps}fps <span class="actual-fps">({actualFps}fps)</span></span>
    </div>
    <div class="polling-control">
      <input
        type="range"
        min="1"
        max="120"
        step="1"
        value={localFps}
        on:input={handleSliderInput}
        on:change={handleSliderCommit}
        class="polling-slider"
      />
      <div class="polling-presets">
        {#each POLLING_PRESETS as preset}
          <button
            class="preset-btn"
            class:active={localFps === preset.fps}
            on:click={() => setPreset(preset.fps)}
          >
            {preset.label}
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .script-tab-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground, rgba(255, 255, 255, 0.5));
  }

  .uniforms-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .uniforms-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .fps-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, rgba(255, 255, 255, 0.5));
    cursor: pointer;
    user-select: none;
  }

  .fps-toggle input[type="checkbox"] {
    margin: 0;
    cursor: pointer;
  }

  .uniforms-list {
    display: grid;
    grid-template-columns: 72px 1fr auto;
    gap: 2px 0;
  }

  .uniforms-list.show-fps {
    grid-template-columns: 72px 1fr auto auto;
  }

  .uniform-fps {
    color: var(--vscode-symbolIcon-numberForeground, var(--vscode-descriptionForeground));
    font-size: 11px;
    text-align: right;
    white-space: nowrap;
    padding-left: 6px;
  }

  .uniform-row {
    display: contents;
  }

  .uniform-row span {
    padding: 3px 8px;
    background: var(--vscode-editor-lineHighlightBackground, rgba(255, 255, 255, 0.06));
    border-top: 1px solid var(--vscode-editor-lineHighlightBorder, transparent);
    border-bottom: 1px solid var(--vscode-editor-lineHighlightBorder, transparent);
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .uniform-row span:first-child {
    border-left: 1px solid var(--vscode-editor-lineHighlightBorder, transparent);
    border-radius: 3px 0 0 3px;
  }

  .uniform-row span:last-child {
    border-right: 1px solid var(--vscode-editor-lineHighlightBorder, transparent);
    border-radius: 0 3px 3px 0;
  }

  .uniform-type {
    color: var(--vscode-symbolIcon-typeParameterForeground, var(--vscode-descriptionForeground));
    font-size: 11px;
  }

  .uniform-name {
    color: var(--vscode-editor-foreground, var(--vscode-foreground));
  }

  .uniform-value {
    color: var(--vscode-symbolIcon-numberForeground, var(--vscode-descriptionForeground));
    font-size: 11px;
    text-align: right;
    white-space: nowrap;
  }

  .uniforms-empty {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }

  .polling-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .polling-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .polling-value {
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-foreground, rgba(255, 255, 255, 0.8));
  }

  .actual-fps {
    color: var(--vscode-descriptionForeground, rgba(255, 255, 255, 0.45));
  }

  .polling-control {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .polling-slider {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--vscode-scrollbarSlider-background, rgba(255, 255, 255, 0.15));
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .polling-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vscode-button-background, #0078d4);
    cursor: pointer;
  }

  .polling-presets {
    display: flex;
    gap: 4px;
  }

  .preset-btn {
    flex: 1;
    padding: 3px 6px;
    font-size: 10px;
    border: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-descriptionForeground, rgba(255, 255, 255, 0.6));
    cursor: pointer;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .preset-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    color: var(--vscode-foreground, #ccc);
  }

  .preset-btn.active {
    background: var(--vscode-button-background, #0078d4);
    color: var(--vscode-button-foreground, #fff);
    border-color: var(--vscode-button-background, #0078d4);
  }
</style>
