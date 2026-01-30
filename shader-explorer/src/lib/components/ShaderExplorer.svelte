<script lang="ts">
  import { onMount } from 'svelte';
  import { shadersStore } from '../stores/shaderStore';
  import ShaderCard from './ShaderCard.svelte';
  import type { ShaderFile } from '../types/ShaderFile';

  let vscode: any = $state(null);
  let shaders = $state<ShaderFile[]>([]);
  let search = $state('');
  let sortBy = $state<'name' | 'updated' | 'created'>('updated');
  let sortOrder = $state<'asc' | 'desc'>('desc');
  let currentPage = $state(1);
  let pageSize = $state(20);
  let cardSize = $state(280); // Card width in pixels (200-500)
  let hideFailedShaders = $state(false);
  let failedShaders = $state(new Set<string>()); // Track failed shader paths
  let refreshKey = $state(0); // Only incremented on explicit refresh
  let forceFresh = $state(false); // Flag to force fresh rendering, ignoring cache
  let stateRestored = $state(false);

  // Persist state changes by sending to extension
  $effect(() => {
    const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders };
    if (vscode && stateRestored) {
      vscode.postMessage({ type: 'saveState', state });
    }
  });

  // Debounced refresh when card size changes
  let cardSizeRefreshTimeout: number | null = null;
  let initialCardSizeSet = false;
  $effect(() => {
    // Track cardSize to create dependency
    cardSize;
    
    // Clear existing timeout
    if (cardSizeRefreshTimeout !== null) {
      window.clearTimeout(cardSizeRefreshTimeout);
    }
    
    // Only trigger refresh after initial state restoration is complete
    if (stateRestored && initialCardSizeSet) {
      cardSizeRefreshTimeout = window.setTimeout(() => {
        refreshShaders();
      }, 500); // 500ms debounce
    }
    
    // Mark that initial cardSize has been set after state restoration
    if (stateRestored) {
      initialCardSizeSet = true;
    }
    
    return () => {
      if (cardSizeRefreshTimeout !== null) {
        window.clearTimeout(cardSizeRefreshTimeout);
      }
    };
  });

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

    // Filter out failed shaders if hideFailedShaders is enabled
    if (hideFailedShaders) {
      filtered = filtered.filter(shader => !failedShaders.has(shader.path));
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
    pageSize;
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
    console.log('ShaderExplorer mounted');
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
        
        if (message.savedState) {
          if (message.savedState.sortBy) sortBy = message.savedState.sortBy;
          if (message.savedState.sortOrder) sortOrder = message.savedState.sortOrder;
          if (message.savedState.pageSize) pageSize = message.savedState.pageSize;
          if (message.savedState.cardSize && typeof message.savedState.cardSize === 'number') {
            cardSize = message.savedState.cardSize;
          }
          if (typeof message.savedState.hideFailedShaders === 'boolean') {
            hideFailedShaders = message.savedState.hideFailedShaders;
          }
        }
        
        stateRestored = true;
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
    if (!vscode) {
      return;
    }
    
    failedShaders = new Set(); // Clear failed shaders list
    forceFresh = true; // Force components to ignore cache
    refreshKey++; // Force ShaderPreview components to remount and reload
    // Request fresh shader list from extension without cached thumbnails
    vscode.postMessage({ type: 'requestShaders', skipCache: true });
    
    // After shaders have had time to render and save thumbnails, 
    // request the list again WITH cache to restore cached state
    setTimeout(() => {
      if (vscode) {
        forceFresh = false; // Allow cache again
        vscode.postMessage({ type: 'requestShaders', skipCache: false });
      }
    }, 3000); // Wait 3 seconds for rendering to complete
  }

  function handleCompilationFailure(shader: ShaderFile) {
    failedShaders = new Set(failedShaders).add(shader.path); // Create new Set to trigger reactivity
  }
</script>

<div class="shader-explorer">
  <div class="toolbar">
    <div class="toolbar-actions">
      <div class="search-container">
        <input 
          type="text" 
          bind:value={search} 
          placeholder="Search shaders..." 
          class="search-input"
        />
      </div>
      <div class="card-size-control">
        <label for="card-size-slider" class="size-label">Card Size</label>
        <input 
          id="card-size-slider"
          type="range" 
          min="200" 
          max="1000" 
          step="20"
          bind:value={cardSize}
          class="card-size-slider"
          title={`${cardSize}px`}
        />
      </div>
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
      <select class="page-size-select" bind:value={pageSize}>
        <option value={10}>Show 10</option>
        <option value={20}>Show 20</option>
        <option value={30}>Show 30</option>
        <option value={50}>Show 50</option>
        <option value={100}>Show 100</option>
      </select>
      <label class="checkbox-control">
        <input type="checkbox" bind:checked={hideFailedShaders} />
        <span class="checkbox-label">Hide Failed</span>
      </label>
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
      <div class="shader-grid" style="grid-template-columns: repeat(auto-fill, minmax({cardSize}px, 1fr));">
        {#each paginatedShaders as shader (`${shader.path}-${refreshKey}`)}
          <ShaderCard 
            {shader}
            {cardSize}
            {forceFresh}
            vscodeApi={vscode}
            onOpen={() => openShader(shader)}
            onOpenConfig={() => openConfig(shader)}
            onCreateConfig={() => createConfig(shader)}
            onCompilationFailed={() => handleCompilationFailure(shader)}
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
  .shader-explorer {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background-color: var(--vscode-editor-background);
    align-items: stretch;
  }

  .toolbar-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    width: 100%;
  }
  .toolbar-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    width: 100%;
  }

  .search-container {
    flex: 1 1 180px;
    min-width: 180px;
    margin: 0 8px;
    display: flex;
    align-items: center;
    max-width: unset;
  }

  .search-input {
    min-width: 0;
    flex: 1 1 auto;
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

  .card-size-control {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .size-label {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }

  .card-size-slider {
    width: 120px;
    height: 4px;
    background: var(--vscode-input-background);
    border-radius: 2px;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }

  .card-size-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: var(--vscode-button-background);
    border-radius: 50%;
    cursor: pointer;
  }

  .card-size-slider::-webkit-slider-thumb:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .card-size-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: var(--vscode-button-background);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .card-size-slider::-moz-range-thumb:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .card-size-slider:focus::-webkit-slider-thumb {
    box-shadow: 0 0 0 2px var(--vscode-focusBorder);
  }

  .card-size-slider:focus::-moz-range-thumb {
    box-shadow: 0 0 0 2px var(--vscode-focusBorder);
  }

  .checkbox-control {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-control input[type="checkbox"] {
    cursor: pointer;
  }

  .checkbox-label {
    font-size: 12px;
    color: var(--vscode-foreground);
    white-space: nowrap;
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
