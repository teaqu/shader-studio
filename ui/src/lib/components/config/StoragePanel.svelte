<svelte:options runes={true} />

<script lang="ts">
  import { tick } from 'svelte';
  import type { StorageBufferConfig } from '@shader-studio/types';
  import type { StorageBufferSnapshot } from '@shader-studio/types';
  import type { ConfigFieldErrors } from '../../config/ComputeConfigMutations';
  import StorageBufferEditor from './StorageBufferEditor.svelte';

  interface Props {
    storage: Record<string, StorageBufferConfig>;
    referencesFor: (name: string) => string[];
    onAdd: () => string | null;
    onApply: (originalName: string, name: string, declaration: StorageBufferConfig) => ConfigFieldErrors;
    onDelete: (name: string) => ConfigFieldErrors;
    onRead?: (name: string, start: number, count: number) => Promise<StorageBufferSnapshot>;
    onWrite?: (name: string, start: number, data: ArrayBuffer) => Promise<void>;
  }

  let { storage, referencesFor, onAdd, onApply, onDelete, onRead, onWrite }: Props = $props();
  let panel = $state<HTMLElement>();

  async function addStorage() {
    const name = onAdd();
    if (!name) {
      return;
    }
    await tick();
    panel?.querySelector<HTMLInputElement>(`[data-storage-name="${name}"] input`)?.focus();
  }
</script>

<section class="storage-panel" bind:this={panel} aria-label="Storage buffers">
  <div class="storage-header">
    <div>
      <h2>Storage</h2>
      <p>These declarations configure GPU storage buffers. Applying a size or type change recreates the buffer and clears its contents; this UI does not rewrite your Slang source.</p>
    </div>
    <button onclick={addStorage} aria-label="Add storage buffer">Add storage</button>
  </div>

  {#if Object.keys(storage).length === 0}
    <p class="empty">No storage buffers are configured.</p>
  {:else}
    <div class="storage-list">
      {#each Object.entries(storage) as [name, declaration] (name)}
        <StorageBufferEditor
          {name}
          {declaration}
          existingNames={Object.keys(storage)}
          referencedBy={referencesFor(name)}
          {onApply}
          {onDelete}
          {onRead}
          {onWrite}
          onDeleted={() => panel?.querySelector<HTMLButtonElement>('[aria-label="Add storage buffer"]')?.focus()}
        />
      {/each}
    </div>
  {/if}
</section>

<style>
  .storage-panel { display: flex; flex: 1; flex-direction: column; gap: 14px; overflow: auto; padding: 12px; }
  .storage-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  h2, p { margin: 0; }
  h2 { font-size: 14px; }
  p { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.4; }
  .storage-header p { margin-top: 4px; max-width: 620px; }
  .storage-list { display: grid; gap: 10px; }
  .empty { padding: 16px 0; }
</style>
