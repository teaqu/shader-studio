<script lang="ts">
  import type { Snippet } from '../types/Snippet';
  import SnippetPreview from './SnippetPreview.svelte';

  let { snippet, cardSize = 280, onInsert, onEdit, onDelete, onViewDetail }: {
    snippet: Snippet;
    cardSize?: number;
    onInsert?: (snippet: Snippet) => void;
    onEdit?: (snippet: Snippet) => void;
    onDelete?: (snippet: Snippet) => void;
    onViewDetail?: (snippet: Snippet) => void;
  } = $props();

  let copied = $state(false);

  function handleCardClick(e: MouseEvent) {
    // Don't open detail if clicking on action buttons
    if ((e.target as HTMLElement).closest('.card-actions')) return;
    onViewDetail?.(snippet);
  }

  async function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(snippet.body.join('\n'));
      copied = true;
      setTimeout(() => copied = false, 2000);
    } catch {}
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="snippet-card"
  onclick={handleCardClick}
  onkeydown={(e) => { if (e.key === 'Enter') onViewDetail?.(snippet); }}
  tabindex="0"
  role="button"
>
  <div class="card-preview">
    {#key snippet.body.join('\n')}
      <SnippetPreview
        {snippet}
        width={cardSize}
        height={Math.round(cardSize * 9 / 16)}
      />
    {/key}
  </div>

  <div class="card-info">
    <div class="card-name" title={snippet.name}>{snippet.name}</div>
    <code class="card-prefix">{snippet.prefix}</code>
    {#if snippet.description}
      <div class="card-description" title={snippet.description}>{snippet.description}</div>
    {/if}

    <div class="card-actions">
      <button class="action-btn insert-btn" onclick={(e) => { e.stopPropagation(); onInsert?.(snippet); }} title="Insert snippet">
        Insert
      </button>
      <button class="action-btn copy-btn" onclick={handleCopy} title="Copy code to clipboard">
        {copied ? 'Copied!' : 'Copy'}
      </button>
      {#if snippet.isCustom}
        <button class="action-btn edit-btn" onclick={(e) => { e.stopPropagation(); onEdit?.(snippet); }} title="Edit snippet">
          Edit
        </button>
        <button class="action-btn delete-btn" onclick={(e) => { e.stopPropagation(); onDelete?.(snippet); }} title="Delete snippet">
          Delete
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .snippet-card {
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 6px;
    overflow: hidden;
    background: var(--vscode-editor-background, #1e1e1e);
    transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
    display: flex;
    flex-direction: column;
    cursor: pointer;
  }

  .snippet-card:hover {
    border-color: var(--vscode-focusBorder, #007fd4);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .snippet-card:focus-visible {
    outline: 2px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -2px;
  }

  .card-preview {
    overflow: hidden;
    flex-shrink: 0;
    aspect-ratio: 16 / 9;
  }

  .card-info {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-prefix {
    display: inline-block;
    font-size: 11px;
    color: var(--vscode-textLink-foreground, #3794ff);
    background: var(--vscode-badge-background, #333);
    padding: 1px 6px;
    border-radius: 3px;
    align-self: flex-start;
  }

  .card-description {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }

  .card-actions {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }

  .action-btn {
    padding: 3px 8px;
    font-size: 11px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    cursor: pointer;
    color: var(--vscode-button-foreground, #fff);
  }

  .insert-btn {
    background: var(--vscode-button-background, #0e639c);
  }

  .insert-btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .copy-btn {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }

  .copy-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  .edit-btn {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
  }

  .edit-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  .delete-btn {
    background: transparent;
    color: var(--vscode-errorForeground, #f48771);
    border-color: var(--vscode-errorForeground, #f48771);
  }

  .delete-btn:hover {
    background: var(--vscode-errorForeground, #f48771);
    color: #fff;
  }
</style>
