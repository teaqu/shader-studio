<svelte:options runes={true} />

<script lang="ts">
  import { getViewerSession } from '@shader-studio/ui/lib/state/viewerSession.svelte';
  import type { FileRevision } from './FileHistory';
  import type { WebTransport } from './WebTransport';

  interface Props {
    transport: WebTransport;
  }

  let { transport }: Props = $props();

  const PAGE_SIZE = 20;

  const session = $derived(getViewerSession());
  const activePath = $derived(session?.shaderPath ?? '');
  let revisions = $state<FileRevision[]>([]);
  let error = $state('');
  let restoringId = $state<string | null>(null);
  let clearing = $state(false);
  let page = $state(0);
  let lastPath = '';

  const pageCount = $derived(Math.max(1, Math.ceil(revisions.length / PAGE_SIZE)));
  const visibleRevisions = $derived(revisions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));

  async function refresh(): Promise<void> {
    try {
      revisions = activePath ? await transport.listFileRevisions(activePath) : [];
      if (activePath !== lastPath) {
        lastPath = activePath;
        page = 0;
      }
      page = Math.min(page, pageCount - 1);
      error = '';
    } catch {
      error = 'Could not load file history.';
    }
  }

  async function restore(revision: FileRevision): Promise<void> {
    restoringId = revision.id;
    error = '';
    try {
      const restored = await transport.restoreFileRevision(revision.path, revision.id);
      if (restored) {
        await refresh();
      } else {
        error = 'That revision is no longer available.';
      }
    } catch {
      error = 'Could not restore that revision.';
    } finally {
      restoringId = null;
    }
  }

  async function clearHistory(): Promise<void> {
    if (!activePath || clearing) {
      return;
    }
    error = '';
    clearing = true;
    try {
      await transport.clearFileHistory(activePath);
      await refresh();
    } catch {
      error = 'Could not clear file history.';
    } finally {
      clearing = false;
    }
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  $effect(() => {
    // Follow the active file as the previewed shader changes.
    void activePath;
    void refresh();
    return transport.onHistoryChange(() => void refresh());
  });
</script>

<div class="file-history" data-testid="file-history">
  <div class="history-hint">Edits are snapshotted in this browser. Restoring snapshots your current contents first, so a restore can be undone.</div>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if !activePath}
    <p class="history-empty">Open a file to see its edit history.</p>
  {:else}
    <div class="history-header">
      <span class="history-path">{activePath}</span>
      {#if revisions.length > 0}
        <button
          type="button"
          disabled={clearing}
          onclick={() => void clearHistory()}
        >
          {clearing ? 'Clearing…' : 'Clear history'}
        </button>
      {/if}
    </div>
    {#if revisions.length === 0}
      <p class="history-empty">No revisions for this file yet. History appears after you edit it.</p>
    {:else}
      <ol class="history-list">
        {#each visibleRevisions as revision (revision.id)}
          <li class="history-item">
            <span class="history-meta">{formatTimestamp(revision.timestamp)} · {revision.size} chars</span>
            <button
              type="button"
              disabled={restoringId === revision.id}
              onclick={() => void restore(revision)}
            >
              {restoringId === revision.id ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        {/each}
      </ol>
      {#if pageCount > 1}
        <div class="history-pager">
          <button type="button" disabled={page === 0} onclick={() => (page -= 1)}>Newer</button>
          <span class="history-page">Page {page + 1} of {pageCount}</span>
          <button type="button" disabled={page === pageCount - 1} onclick={() => (page += 1)}>Older</button>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .file-history {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 0;
    padding: 8px 10px;
    overflow-y: auto;
    color: var(--vscode-foreground);
  }

  .history-hint, .history-empty {
    margin: 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .history-path {
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-header button {
    flex-shrink: 0;
    padding: 3px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 11px;
  }

  .history-header button:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
  }

  .history-header button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .history-list {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
  }

  .history-meta {
    font-size: 11px;
  }

  .history-item button {
    padding: 3px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 11px;
  }

  .history-item button:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
  }

  .history-item button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .history-pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .history-page {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .history-pager button {
    padding: 3px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 11px;
  }

  .history-pager button:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
  }

  .history-pager button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
