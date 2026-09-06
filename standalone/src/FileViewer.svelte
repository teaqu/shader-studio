<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { WebTransport } from './WebTransport';
  import { requestEditor } from './state/shellState.svelte';

  interface Props {
    transport?: WebTransport;
  }

  let { transport }: Props = $props();

  interface FileRow {
    path: string;
    name: string;
    directory: string;
  }

  let files = $state<FileRow[]>([]);
  let loadError = $state('');
  let cleanup: (() => void) | null = null;

  function toRow(path: string): FileRow {
    const name = path.slice(path.lastIndexOf('/') + 1) || path;
    const directory = path.slice(0, path.lastIndexOf('/')) || '/';
    return { path, name, directory };
  }

  async function refresh(): Promise<void> {
    if (!transport) {
      return;
    }
    try {
      const listed = await transport.listWorkspaceFiles();
      files = listed.map((file) => toRow(file.path)).sort((a, b) => a.path.localeCompare(b.path));
      loadError = '';
    } catch {
      loadError = 'Could not list workspace files.';
    }
  }

  function openFile(path: string): void {
    requestEditor(path);
  }

  onMount(() => {
    void refresh();
    if (transport) {
      cleanup = transport.onWorkspaceChange(() => {
        void refresh();
      });
    }
  });

  onDestroy(() => {
    cleanup?.();
    cleanup = null;
  });
</script>

<div class="file-viewer" data-testid="file-viewer">
  <div class="file-viewer-header">
    <strong>Files</strong>
    <span class="file-count" aria-label={`${files.length} files`}>{files.length}</span>
  </div>
  {#if loadError}
    <p role="alert">{loadError}</p>
  {:else if files.length === 0}
    <p class="empty-note">No files in this workspace yet.</p>
  {:else}
    <ul class="file-list">
      {#each files as file (file.path)}
        <li>
          <button type="button" class="file-row" title={file.path} onclick={() => openFile(file.path)}>
            <span class="file-name">{file.name}</span>
            <span class="file-dir">{file.directory}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .file-viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
  .file-viewer-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .file-count { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .empty-note { padding: 8px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .file-list { list-style: none; margin: 0; padding: 4px; overflow-y: auto; }
  .file-row { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; border: 0; border-radius: 4px; background: transparent; color: var(--vscode-foreground); cursor: pointer; padding: 4px 8px; text-align: left; font: inherit; }
  .file-row:hover { background: var(--vscode-list-hoverBackground); }
  .file-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .file-dir { font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
</style>
