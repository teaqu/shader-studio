<script lang="ts">
  import type { BufferOutputFormat } from '@shader-studio/types';
  interface Props { value: BufferOutputFormat; onchange: (event: Event) => void; }
  let { value, onchange }: Props = $props();
</script>
<label class="format-row">Output format
  <select aria-label="Output format" {value} {onchange}>
    <option value="auto">Auto (32-bit preferred)</option>
    <option value="rgba16float">RGBA 16-bit float</option>
    <option value="rgba32float">RGBA 32-bit float</option>
  </select>
</label>
<style>
  .format-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--vscode-foreground, #ccc); font-size: 13px; }
  select { background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c)); padding: 6px; border-radius: 4px; }
</style>
