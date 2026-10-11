<script lang="ts">
  import { getFileSelection, finishFileSelection } from './state/fileSelectionState.svelte';
  const request = $derived(getFileSelection());
  let filter = $state('');
  const files = $derived(request?.paths.filter(path => path.toLowerCase().includes(filter.toLowerCase())) ?? []);
  function finish(path: string | null) {
    finishFileSelection(path);
    filter = '';
  }
  function handleKeydown(event: KeyboardEvent) {
    if (request && event.key === 'Escape') {
      finish(null);
    }
  }
</script>
<svelte:window onkeydown={handleKeydown} />
{#if request}
  <div class="overlay" role="presentation">
    <div role="dialog" aria-modal="true" aria-label="Select workspace file" class="picker" tabindex="-1">
      <h2>Select workspace file</h2>
      <input aria-label="Filter files" placeholder="Filter files…" bind:value={filter} />
      <div class="files">
        {#each files as path}<button class="file" onclick={() => finish(path)}>{path}</button>{/each}
      </div>
      {#if !files.length}<p>No matching workspace files. Import a file into the workspace or create one.</p>{/if}
      <button onclick={() => finish(null)}>Cancel</button>
    </div>
  </div>
{/if}
<style>
  .overlay { position: fixed; inset: 0; z-index: 10000; background: #0008; display: grid; place-items: center; }
  .picker { width: min(520px, 90vw); padding: 20px; border: 1px solid var(--vscode-panel-border, #444); border-radius: 8px; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-foreground, #ccc); }
  h2 { margin-top: 0; font-size: 18px; }
  input { box-sizing: border-box; width: 100%; margin-bottom: 12px; padding: 8px; }
  input, button { color: var(--vscode-input-foreground, #ccc); background: var(--vscode-input-background, #333); border: 1px solid var(--vscode-panel-border, #444); border-radius: 4px; }
  button { padding: 8px 12px; cursor: pointer; }
  .files { max-height: 50vh; overflow: auto; display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .file { text-align: left; }
  button:hover { border-color: var(--vscode-focusBorder, #007acc); }
</style>
