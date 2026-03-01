<script lang="ts">
  import type { Snippet, SnippetCategory } from '../types/Snippet';
  import SnippetCard from './SnippetCard.svelte';

  let { category, label, snippets, isOpen, onToggle, cardSize = 280, onInsert, onEdit, onDelete, onViewDetail, onAdd }: {
    category: SnippetCategory;
    label: string;
    snippets: Snippet[];
    isOpen: boolean;
    onToggle: () => void;
    cardSize?: number;
    onInsert?: (snippet: Snippet) => void;
    onEdit?: (snippet: Snippet) => void;
    onDelete?: (snippet: Snippet) => void;
    onViewDetail?: (snippet: Snippet) => void;
    onAdd?: () => void;
  } = $props();
</script>

<div class="category-accordion">
  <div class="accordion-header" role="button" tabindex="0" onclick={onToggle} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}>
    <span class="chevron" class:open={isOpen}></span>
    <span class="category-name">{label}</span>
    <span class="count-badge">{snippets.length}</span>
    {#if category === 'custom' && onAdd}
      <button
        class="add-btn"
        onclick={(e) => { e.stopPropagation(); onAdd?.(); }}
        title="Add custom snippet"
      >+</button>
    {/if}
  </div>

  {#if isOpen}
    <div class="accordion-body">
      {#if category === 'custom'}
        <div class="custom-path-info">
          Stored in: <code>.vscode/glsl-snippets.code-snippets</code>
        </div>
      {/if}
      <div class="snippet-grid" style="--card-size: {cardSize}px">
        {#each snippets as snippet (snippet.prefix)}
          <SnippetCard
            {snippet}
            {cardSize}
            {onInsert}
            {onEdit}
            {onDelete}
            {onViewDetail}
          />
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .category-accordion {
    margin-bottom: 2px;
  }

  .accordion-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: var(--vscode-sideBar-background, #252526);
    border: none;
    cursor: pointer;
    color: var(--vscode-foreground, #ccc);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
  }

  .accordion-header:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
  }

  .chevron {
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid var(--vscode-foreground, #ccc);
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    transition: transform 0.15s;
    flex-shrink: 0;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .category-name {
    flex: 1;
  }

  .count-badge {
    font-size: 11px;
    color: var(--vscode-badge-foreground, #fff);
    background: var(--vscode-badge-background, #4d4d4d);
    padding: 1px 6px;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
  }

  .add-btn {
    width: 22px;
    height: 22px;
    border: 1px solid var(--vscode-button-background, #0e639c);
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-button-background, #0e639c);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .add-btn:hover {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
  }

  .accordion-body {
    padding: 12px;
  }

  .custom-path-info {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    margin-bottom: 8px;
    padding: 4px 8px;
    background: var(--vscode-textBlockQuote-background, #222);
    border-radius: 3px;
  }

  .custom-path-info code {
    font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
    color: var(--vscode-textLink-foreground, #3794ff);
  }

  .snippet-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--card-size), 1fr));
    gap: 12px;
  }
</style>
