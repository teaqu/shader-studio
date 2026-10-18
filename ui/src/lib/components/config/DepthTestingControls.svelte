<svelte:options runes={true} />
<script lang="ts">
  import type { DepthSettings, DepthCompareFunction } from '@shader-studio/types';
  interface Props {
    bufferName: string;
    depth: Required<DepthSettings>;
    onChange: (settings: DepthSettings) => void;
  }
  let { bufferName, depth, onChange }: Props = $props();
</script>

<div class="config-item depth-settings-section">
  <h3 class="section-title">Depth testing</h3>
  <div class="resolution-row">
    <label class="resolution-label" for="depth-test-{bufferName}">Depth test</label>
    <input
      id="depth-test-{bufferName}"
      type="checkbox"
      checked={depth.test}
      onchange={(event) => onChange({ test: (event.currentTarget as HTMLInputElement).checked })}
    />
  </div>
  <div class="resolution-row">
    <label class="resolution-label" for="depth-write-{bufferName}">Depth write</label>
    <input
      id="depth-write-{bufferName}"
      type="checkbox"
      checked={depth.write}
      onchange={(event) => onChange({ write: (event.currentTarget as HTMLInputElement).checked })}
    />
  </div>
  <div class="resolution-row">
    <label class="resolution-label" for="depth-compare-{bufferName}">Compare</label>
    <select
      id="depth-compare-{bufferName}"
      value={depth.compare}
      disabled={!depth.test}
      onchange={(event) => onChange({ compare: (event.currentTarget as HTMLSelectElement).value as DepthCompareFunction })}
    >
      <option value="never">Never</option>
      <option value="less">Less</option>
      <option value="equal">Equal</option>
      <option value="less-equal">Less or equal</option>
      <option value="greater">Greater</option>
      <option value="not-equal">Not equal</option>
      <option value="greater-equal">Greater or equal</option>
      <option value="always">Always</option>
    </select>
  </div>
</div>

<style>
  .config-item { display: flex; flex-direction: column; gap: 12px; }
  .section-title {
    margin: 0 0 8px; padding-bottom: 6px; font-size: 13px; font-weight: 600;
    color: var(--vscode-foreground, #ccc);
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
  }
  .resolution-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .resolution-label {
    font-size: 11px; color: var(--vscode-descriptionForeground, #888);
    min-width: 48px; flex-shrink: 0;
  }
  select {
    padding: var(--shader-studio-control-padding); color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
    border-radius: var(--shader-studio-control-radius); font-size: var(--shader-studio-font-size); outline: none; min-height: var(--shader-studio-control-height);
  }
  select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  select:focus { border-color: var(--vscode-focusBorder, #007acc); }
</style>
