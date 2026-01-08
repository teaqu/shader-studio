<script lang="ts">
  import { onMount } from 'svelte';
  import { shadersStore, searchQuery } from '../stores/shaderStore';
  import ShaderCard from './ShaderCard.svelte';
  import type { ShaderFile } from '../types/ShaderFile';

  let vscode: any;
  let shaders = $state<ShaderFile[]>([]);
  let search = $state('');
  let sortBy = $state<'name' | 'updated' | 'created'>('updated');
  let sortOrder = $state<'asc' | 'desc'>('desc');
  let currentPage = $state(1);
  let pageSize = 100;

  let filteredShaders = $derived.by(() => {
    let filtered: ShaderFile[];
    
    if (!search.trim()) {
      filtered = [...shaders];
    } else {
      const query = search.toLowerCase();
      filtered = shaders.filter(shader => 
        shader.name.toLowerCase().includes(query) ||
        shader.relativePath.toLowerCase().includes(query)
      );
    }

    // Sort the filtered results
    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'updated') {
        const aTime = a.modifiedTime || 0;
        const bTime = b.modifiedTime || 0;
        comparison = bTime - aTime;
      } else if (sortBy === 'created') {
        const aTime = a.createdTime || 0;
        const bTime = b.createdTime || 0;
        comparison = bTime - aTime;
      }
      return sortOrder === 'asc' ? -comparison : comparison;
    });

    return filtered;
  });

  let paginatedShaders = $derived.by(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredShaders.slice(startIndex, endIndex);
  });

  let totalPages = $derived(Math.ceil(filteredShaders.length / pageSize));

  // Reset to page 1 when search or sort changes
  $effect(() => {
    search;
    sortBy;
    sortOrder;
    currentPage = 1;
  });

  // Reset to page 1 if current page exceeds total pages
  $effect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      currentPage = 1;
    }
  });

  function toggleSortOrder() {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
  }

  function nextPage() {
    if (currentPage < totalPages) {
      currentPage++;
    }
  }

  function prevPage() {
    if (currentPage > 1) {
      currentPage--;
    }
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages) {
      currentPage = page;
    }
  }

  onMount(() => {
    console.log('ShaderBrowser mounted');
    if (typeof acquireVsCodeApi !== 'undefined') {
      vscode = acquireVsCodeApi();
      console.log('VS Code API acquired');
      
      // Request shader list from extension
      vscode.postMessage({ type: 'requestShaders' });
      console.log('Requested shaders from extension');

      // Listen for messages from extension
      window.addEventListener('message', handleMessage);

      return () => {
        window.removeEventListener('message', handleMessage);
      };
    } else {
      console.error('acquireVsCodeApi is not available');
    }
  });

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    console.log('Received message:', message);
    
    switch (message.type) {
      case 'shadersUpdate':
        console.log('Updating shaders:', message.shaders);
        shaders = message.shaders || [];
        shadersStore.set(shaders);
        break;
    }
  }



  function openShader(shader: ShaderFile) {
    vscode?.postMessage({
      type: 'openShader',
      path: shader.path,
      configPath: shader.configPath
    });
  }

  function openConfig(shader: ShaderFile) {
    if (shader.configPath) {
      vscode?.postMessage({
        type: 'openConfig',
        path: shader.configPath
      });
    }
  }

  function createConfig(shader: ShaderFile) {
    vscode?.postMessage({
      type: 'createConfig',
      shaderPath: shader.path
    });
  }

  function refreshShaders() {
    vscode?.postMessage({ type: 'requestShaders' });
  }
</script>

<div class="shader-browser">
  <div class="toolbar">
    <div class="search-container">
      <input 
        type="text" 
        bind:value={search} 
        placeholder="Search shaders..." 
        class="search-input"
      />
    </div>
    <div class="toolbar-actions">
      <select class="sort-select" bind:value={sortBy}>
        <option value="name">Name</option>
        <option value="updated">Updated</option>
        <option value="created">Created</option>
      </select>
      <button 
        class="icon-button sort-order-button" 
        onclick={toggleSortOrder} 
        title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
      >
        {sortOrder === 'asc' ? '↑' : '↓'}
      </button>
      <button class="icon-button" onclick={refreshShaders} title="Refresh">
        ↻
      </button>
      <div class="shader-count">
        {filteredShaders.length} shader{filteredShaders.length !== 1 ? 's' : ''}
      </div>
    </div>
  </div>

  <div class="content">
    {#if filteredShaders.length === 0}
      <div class="empty-state">
        {#if shaders.length === 0}
          <div class="empty-icon">🎨</div>
          <h2>No Shaders Found</h2>
          <p>No .glsl or .frag files found in the workspace.</p>
        {:else}
          <div class="empty-icon">🔍</div>
          <h2>No Results</h2>
          <p>No shaders match your search.</p>
        {/if}
      </div>
    {:else}
      <div class="shader-grid">
        {#each paginatedShaders as shader (shader.path)}
          <ShaderCard 
            {shader}
            vscodeApi={vscode}
            on:open={() => openShader(shader)}
            on:openConfig={() => openConfig(shader)}
            on:createConfig={() => createConfig(shader)}
          />
        {/each}
      </div>
      
      {#if totalPages > 1}
        <div class="pagination">
          <button 
            class="page-button" 
            onclick={prevPage}
            disabled={currentPage === 1}
          >
            ‹
          </button>
          
          {#if totalPages <= 7}
            {#each Array(totalPages) as _, i}
              <button 
                class="page-button {currentPage === i + 1 ? 'active' : ''}"
                onclick={() => goToPage(i + 1)}
              >
                {i + 1}
              </button>
            {/each}
          {:else}
            <button 
              class="page-button {currentPage === 1 ? 'active' : ''}"
              onclick={() => goToPage(1)}
            >
              1
            </button>
            
            {#if currentPage > 3}
              <span class="page-ellipsis">...</span>
            {/if}
            
            {@const startPage = Math.max(2, Math.min(currentPage - 2, totalPages - 4))}
            {@const endPage = Math.min(totalPages - 1, Math.max(currentPage + 2, 5))}
            {#each Array(endPage - startPage + 1) as _, i}
              {@const pageNum = startPage + i}
              <button 
                class="page-button {currentPage === pageNum ? 'active' : ''}"
                onclick={() => goToPage(pageNum)}
              >
                {pageNum}
              </button>
            {/each}
            
            {#if currentPage < totalPages - 2}
              <span class="page-ellipsis">...</span>
            {/if}
            
            <button 
              class="page-button {currentPage === totalPages ? 'active' : ''}"
              onclick={() => goToPage(totalPages)}
            >
              {totalPages}
            </button>
          {/if}
          
          <button 
            class="page-button" 
            onclick={nextPage}
            disabled={currentPage === totalPages}
          >
            ›
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .shader-browser {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    gap: 12px;
    padding: 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background-color: var(--vscode-editor-background);
    align-items: center;
  }

  .search-container {
    flex: 1;
  }

  .search-input {
    width: 100%;
    padding: 6px 12px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    font-size: 13px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--vscode-focusBorder);
  }

  .toolbar-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .icon-button {
    padding: 6px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
  }

  .icon-button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .sort-select,
  .page-size-select {
    padding: 6px 12px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    outline: none;
  }

  .sort-select:focus,
  .page-size-select:focus {
    border-color: var(--vscode-focusBorder);
  }

  .shader-count {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    white-space: nowrap;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .shader-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 32px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }

  .empty-icon {
    font-size: 64px;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  .empty-state h2 {
    margin: 0 0 8px 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .empty-state p {
    margin: 0;
    font-size: 14px;
  }

  .pagination {
    display: flex;
    gap: 4px;
    justify-content: center;
    align-items: center;
    margin-top: 24px;
    padding: 16px 0;
  }

  .page-button {
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .page-button:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .page-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-button.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-weight: 600;
  }

  .page-ellipsis {
    padding: 0 4px;
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
  }
</style>
