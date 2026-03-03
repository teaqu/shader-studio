<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet, SnippetCategory } from '../types/Snippet';
  import { CATEGORY_ORDER, CATEGORY_LABELS } from '../types/Snippet';
  import CategoryAccordion from './CategoryAccordion.svelte';
  import AddSnippetModal from './AddSnippetModal.svelte';
  import SnippetDetailModal from './SnippetDetailModal.svelte';

  let vscode: VsCodeApi | null = $state(null);
  let snippets: Snippet[] = $state([]);
  let search: string = $state('');
  let openCategories: Set<SnippetCategory> = $state(new Set(CATEGORY_ORDER));
  let showAddModal: boolean = $state(false);
  let editingSnippet: Snippet | null = $state(null);
  let detailSnippet: Snippet | null = $state(null);
  let cardSize: number = $state(280);
  let stateRestored: boolean = $state(false);
  let cardSizeTimeout: ReturnType<typeof setTimeout> | null = null;

  const filteredSnippets = $derived.by(() => {
    if (!search.trim()) return snippets;
    const q = search.toLowerCase();
    return snippets.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.prefix.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });

  const categorizedSnippets = $derived.by(() => {
    const map = new Map<SnippetCategory, Snippet[]>();
    for (const cat of CATEGORY_ORDER) {
      const catSnippets = filteredSnippets.filter(s => s.category === cat);
      if (catSnippets.length > 0) {
        map.set(cat, catSnippets);
      }
    }
    return map;
  });

  onMount(() => {
    try {
      vscode = acquireVsCodeApi();
    } catch {
      // Not in VS Code webview (dev mode)
      console.log('Not in VS Code webview');
      return;
    }

    vscode.postMessage({ type: 'requestSnippets' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case 'snippetsUpdate':
          snippets = message.snippets;
          if (message.savedState) {
            restoreState(message.savedState);
          }
          stateRestored = true;
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  });

  function restoreState(state: any) {
    if (state.cardSize != null) cardSize = state.cardSize;
    if (state.openCategories != null) {
      openCategories = new Set(state.openCategories);
    }
    if (state.search != null) search = state.search;
  }

  function saveState() {
    if (!vscode || !stateRestored) return;
    vscode.postMessage({
      type: 'saveState',
      state: {
        cardSize,
        openCategories: [...openCategories],
        search,
      }
    });
  }

  function toggleCategory(cat: SnippetCategory) {
    const next = new Set(openCategories);
    if (next.has(cat)) {
      next.delete(cat);
    } else {
      next.add(cat);
    }
    openCategories = next;
    saveState();
  }

  function handleCardSizeChange(e: Event) {
    cardSize = parseInt((e.target as HTMLInputElement).value);
    if (cardSizeTimeout) clearTimeout(cardSizeTimeout);
    cardSizeTimeout = setTimeout(() => saveState(), 500);
  }

  function handleSearchInput(e: Event) {
    search = (e.target as HTMLInputElement).value;
    saveState();
  }

  function handleInsert(snippet: Snippet) {
    if (!vscode) return;
    vscode.postMessage({
      type: 'insertSnippet',
      body: [...snippet.body],
    });
  }

  function handleEdit(snippet: Snippet) {
    editingSnippet = snippet;
    showAddModal = true;
  }

  function handleDelete(snippet: Snippet) {
    if (!vscode) return;
    vscode.postMessage({
      type: 'deleteCustomSnippet',
      name: snippet.name,
    });
  }

  function handleAddNew() {
    editingSnippet = null;
    showAddModal = true;
  }

  function handleViewDetail(snippet: Snippet) {
    detailSnippet = snippet;
  }

  function handleCloseDetail() {
    detailSnippet = null;
  }

  function handleSave(data: { name: string; prefix: string; description: string; body: string[]; example?: string[]; oldName?: string }) {
    if (!vscode) return;

    if (data.oldName) {
      vscode.postMessage({
        type: 'updateCustomSnippet',
        oldName: data.oldName,
        name: data.name,
        prefix: data.prefix,
        description: data.description,
        body: [...data.body],
        example: data.example ? [...data.example] : undefined,
      });
    } else {
      vscode.postMessage({
        type: 'saveCustomSnippet',
        name: data.name,
        prefix: data.prefix,
        description: data.description,
        body: [...data.body],
        example: data.example ? [...data.example] : undefined,
      });
    }

    showAddModal = false;
    editingSnippet = null;
  }

  function handleCancelModal() {
    showAddModal = false;
    editingSnippet = null;
  }
</script>

<div class="snippet-library">
  <div class="toolbar">
    <div class="toolbar-left">
      <input
        type="text"
        class="search-input"
        placeholder="Search snippets..."
        value={search}
        oninput={handleSearchInput}
      />
    </div>
    <div class="toolbar-right">
      <label class="size-control">
        <span class="size-label">Size</span>
        <input
          type="range"
          min="150"
          max="500"
          value={cardSize}
          oninput={handleCardSizeChange}
        />
      </label>
      <button class="add-btn" onclick={handleAddNew}>
        + Add Snippet
      </button>
    </div>
  </div>

  <div class="categories">
    {#each CATEGORY_ORDER as cat (cat)}
      {#if categorizedSnippets.has(cat)}
        <CategoryAccordion
          category={cat}
          label={CATEGORY_LABELS[cat]}
          snippets={categorizedSnippets.get(cat)!}
          isOpen={openCategories.has(cat)}
          onToggle={() => toggleCategory(cat)}
          {cardSize}
          onInsert={handleInsert}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onViewDetail={handleViewDetail}
          onAdd={cat === 'custom' ? handleAddNew : undefined}
        />
      {/if}
    {/each}
  </div>

  {#if filteredSnippets.length === 0}
    <div class="empty-state">
      {#if search}
        <p>No snippets match "{search}"</p>
      {:else}
        <p>No snippets found</p>
      {/if}
    </div>
  {/if}
</div>

<AddSnippetModal
  isOpen={showAddModal}
  {editingSnippet}
  onSave={handleSave}
  onCancel={handleCancelModal}
/>

<SnippetDetailModal
  snippet={detailSnippet}
  onClose={handleCloseDetail}
  onInsert={handleInsert}
/>

<style>
  .snippet-library {
    min-height: 100vh;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vscode-panel-border, #444);
    background: var(--vscode-sideBar-background, #252526);
    flex-wrap: wrap;
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .toolbar-left {
    flex: 1;
    min-width: 200px;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .search-input {
    width: 100%;
    padding: 5px 10px;
    font-size: 13px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .size-control {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .size-label {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #888);
  }

  .size-control input[type="range"] {
    width: 100px;
  }

  .add-btn {
    padding: 5px 12px;
    font-size: 12px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }

  .add-btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .categories {
    padding-top: 4px;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 14px;
  }
</style>
