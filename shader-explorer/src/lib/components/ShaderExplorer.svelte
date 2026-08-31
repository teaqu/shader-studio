<script lang="ts">
  import { onMount } from 'svelte';
  import { shadersStore } from '../stores/shaderStore';
  import ShaderCard from './ShaderCard.svelte';
  import type { ShaderFile } from '../types/ShaderFile';
  import {
    createShaderSearchScheduler,
    getVisibleShadersForSearch,
    isCurrentShaderSearchResult,
    type ShaderSearchResultsMessage,
  } from '../shaderSearch';

  interface Props {
    demoShaders?: ShaderFile[];
    demoVscodeApi?: { postMessage: (message: { type: string; path?: string; requestId?: number; [key: string]: unknown }) => void };
    selectedDemoShaderPath?: string;
    onDemoShaderSelect?: (shader: ShaderFile) => void;
    onDemoReset?: () => void;
  }

  let {
    demoShaders = undefined,
    demoVscodeApi = undefined,
    selectedDemoShaderPath = '',
    onDemoShaderSelect = (_shader: ShaderFile) => {},
    onDemoReset = () => {},
  }: Props = $props();

  let vscode: any = $state(null);
  let shaders = $state<ShaderFile[]>([]);
  let search = $state('');
  let searchResultPaths = $state<string[] | null>(null);
  let activeSearchRequestId = $state(0);
  let searchScheduler = $state<ReturnType<typeof createShaderSearchScheduler> | null>(null);
  let sortBy = $state<'name' | 'updated' | 'created'>('updated');
  let sortOrder = $state<'asc' | 'desc'>('desc');
  let currentPage = $state(1);
  let pageSize = $state(20);
  let cardSize = $state(200); // Card width in pixels (100-1000)
  // The demo lives in a narrow docked panel; rows retain the package's actual
  // cards while keeping the editor and preview usable.
  let layoutMode = $state<'grid' | 'row'>(demoShaders ? 'row' : 'grid');
  let showOptions = $state(false);
  let hideFailedShaders = $state(false);
  let openFilesOnSelect = $state(true);
  let failedShaders = $state(new Set<string>()); // Track failed shader paths
  let refreshKey = $state(0); // Only incremented on explicit refresh
  let refreshAll = $state(false); // Flag to force fresh rendering, ignoring cache
  let lastClickedPath = $state(''); // Track last clicked shader to remount its card
  let clickGeneration = $state(0); // Incremented on click to change the {#each} key
  let stateRestored = $state(false);

  // Persist state changes by sending to extension
  $effect(() => {
    const state = { sortBy, sortOrder, pageSize, cardSize, hideFailedShaders, openFilesOnSelect, layoutMode, showOptions };
    if (vscode && stateRestored) {
      vscode.postMessage({ type: 'saveState', state });
    }
  });


  let filteredShaders = $derived(getVisibleShadersForSearch({
    shaders,
    search,
    searchResultPaths,
    hideFailedShaders,
    failedShaderPaths: failedShaders,
    sortBy,
    sortOrder,
  }));

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

  $effect(() => {
    if (!searchScheduler || !stateRestored) {
      return;
    }

    if (!search.trim()) {
      activeSearchRequestId = 0;
      searchResultPaths = null;
      searchScheduler.dispose();
      return;
    }

    const requestId = searchScheduler.schedule(search);
    activeSearchRequestId = requestId ?? 0;

    return () => {
      searchScheduler?.dispose();
    };
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
    if (demoShaders) {
      vscode = demoVscodeApi;
      shaders = demoShaders;
      stateRestored = true;
      return;
    }
    if (typeof acquireVsCodeApi !== 'undefined') {
      vscode = acquireVsCodeApi();
      searchScheduler = createShaderSearchScheduler(message => vscode?.postMessage(message));
      
      // Request shader list from extension
      vscode.postMessage({ type: 'requestShaders' });

      // Listen for messages from extension
      window.addEventListener('message', handleMessage);

      return () => {
        window.removeEventListener('message', handleMessage);
        searchScheduler?.dispose();
      };
    } else {
      console.error('acquireVsCodeApi is not available');
    }
  });

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    
    switch (message.type) {
      case 'shadersUpdate':
        // Detect removed shaders — if one was deleted, activate the next one
        const oldList = shaders;
        const newList: ShaderFile[] = message.shaders || [];
        if (oldList.length > 0 && newList.length < oldList.length && vscode) {
          const newPaths = new Set(newList.map(s => s.path));
          const removed = oldList.find(s => !newPaths.has(s.path));
          if (removed) {
            const oldIdx = oldList.indexOf(removed);
            const next = newList[Math.min(oldIdx, newList.length - 1)];
            if (next) {
              vscode.postMessage({ type: 'activateShader', path: next.path });
            }
          }
        }
        shaders = newList;
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
          if (typeof message.savedState.openFilesOnSelect === 'boolean') {
            openFilesOnSelect = message.savedState.openFilesOnSelect;
          }
          if (message.savedState.layoutMode === 'grid' || message.savedState.layoutMode === 'row') {
            layoutMode = message.savedState.layoutMode;
          }
          if (typeof message.savedState.showOptions === 'boolean') {
            showOptions = message.savedState.showOptions;
          }
        }
        
        stateRestored = true;
        if (search.trim() && searchScheduler) {
          const requestId = searchScheduler.schedule(search);
          activeSearchRequestId = requestId ?? 0;
        }
        break;

      case 'shaderSearchResults':
        if (
          isCurrentShaderSearchResult(
            message as ShaderSearchResultsMessage,
            activeSearchRequestId,
            search,
          )
        ) {
          searchResultPaths = Array.isArray(message.paths) ? message.paths : [];
        }
        break;
    }
  }



  function openShader(shader: ShaderFile) {
    lastClickedPath = shader.path;
    clickGeneration++;
    if (demoShaders) {
      onDemoShaderSelect(shader);
      return;
    }
    vscode?.postMessage({
      type: openFilesOnSelect ? 'openShader' : 'activateShader',
      path: shader.path,
    });
  }

  function refreshShaders() {
    if (!vscode) {
      return;
    }
    
    failedShaders = new Set(); // Clear failed shaders list
    refreshAll = true; // Force components to ignore cache
    refreshKey++; // Force ShaderPreview components to remount and reload
    // Request fresh shader list from extension without cached thumbnails
    vscode.postMessage({ type: 'requestShaders', skipCache: true });
    
    // After shaders have had time to render and save thumbnails, 
    // request the list again WITH cache to restore cached state
    setTimeout(() => {
      if (vscode) {
        refreshAll = false; // Allow cache again
        vscode.postMessage({ type: 'requestShaders', skipCache: false });
      }
    }, 3000); // Wait 3 seconds for rendering to complete
  }

  function handleCompilationFailure(shader: ShaderFile) {
    failedShaders = new Set(failedShaders).add(shader.path);
  }

</script>

<div class="shader-explorer" data-testid={demoShaders ? 'demo-shader-explorer' : undefined}>
  <div class="toolbar">
    {#if demoShaders}
      <div class="toolbar-actions demo-toolbar-actions" data-testid="demo-explorer-toolbar">
        <button class="icon-button" onclick={onDemoReset} title="Reset examples" aria-label="Reset examples">
          Reset
        </button>
      </div>
    {:else}
      <div class="toolbar-actions">
        <div class="search-container">
          <input
            type="text"
            bind:value={search}
            placeholder="Search shaders..."
            class="search-input"
          />
        </div>
        <button
          class="icon-button"
          onclick={() => layoutMode = layoutMode === 'grid' ? 'row' : 'grid'}
          title={layoutMode === 'grid' ? 'Row layout' : 'Grid layout'}
        >
          {layoutMode === 'grid' ? '☰' : '⊞'}
        </button>
        <button
          class="icon-button"
          onclick={() => vscode?.postMessage({ type: 'togglePanel' })}
          title="Show Panel"
          aria-label="Show Panel"
        >
          <svg class="panel-icon" viewBox="0 0 16 16" width="14" height="14">
            <path fill="currentColor" d="M2 2h12v12H2V2zm1 1v10h10V3H3z"/>
            <rect fill="currentColor" x="4.5" y="5" width="3" height="6"/>
            <rect fill="currentColor" x="8.5" y="5" width="3" height="3"/>
          </svg>
        </button>
        <button
          class="icon-button"
          onclick={() => vscode?.postMessage({ type: 'newShader' })}
          title="New Shader"
        >
          +
        </button>
        <button
          class="icon-button"
          onclick={() => showOptions = !showOptions}
          title="Options"
        >
          {showOptions ? '✕' : '⚙'}
        </button>
        <button class="icon-button" onclick={refreshShaders} title="Refresh">
          ↻
        </button>
        <div class="shader-count">
          {filteredShaders.length} shader{filteredShaders.length !== 1 ? 's' : ''}
        </div>
      </div>
      {#if showOptions}
      <div class="options-divider"></div>
      <div class="toolbar-actions">
        {#if layoutMode === 'grid'}
          <div class="card-size-control">
            <label for="card-size-slider" class="size-label">Size</label>
            <input
              id="card-size-slider"
              type="range"
              min="100"
              max="1000"
              step="10"
              bind:value={cardSize}
              class="card-size-slider"
              title={`${cardSize}px`}
            />
          </div>
        {/if}
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
        <label class="checkbox-control">
          <input type="checkbox" bind:checked={openFilesOnSelect} />
          <span class="checkbox-label">Open Files</span>
        </label>
      </div>
      {/if}
    {/if}
  </div>

  <div class="content">
    {#if filteredShaders.length === 0}
      <div class="empty-state">
        {#if shaders.length === 0}
          <div class="empty-icon">🎨</div>
          <h2>No Shaders Found</h2>
          <p>No GLSL or Slang shaders found in the workspace.</p>
        {:else}
          <div class="empty-icon">🔍</div>
          <h2>No Results</h2>
          <p>No shaders match your search.</p>
        {/if}
      </div>
    {:else}
      {#if totalPages > 1}
        <div class="pagination pagination-top">
          {@render pagination()}
        </div>
      {/if}
      <div
        class="shader-grid"
        class:row-mode={layoutMode === 'row'}
        style={layoutMode === 'grid'
          ? `grid-template-columns: repeat(auto-fill, minmax(min(${cardSize}px, 100%), 1fr))`
          : ''}
      >
        {#each paginatedShaders as shader (`${shader.path}-${refreshKey}-${shader.path === lastClickedPath ? clickGeneration : ''}`)}
          <ShaderCard
            {shader}
            {cardSize}
            {refreshAll}
            forceFresh={shader.path === lastClickedPath}
            {layoutMode}
            compact={Boolean(demoShaders)}
            selected={selectedDemoShaderPath === shader.path}
            vscodeApi={vscode}
            onOpen={() => openShader(shader)}
            onCompilationFailed={() => handleCompilationFailure(shader)}
          />
        {/each}
      </div>
      
{#snippet pagination()}
        <button
          class="page-button"
          onclick={prevPage}
          disabled={currentPage === 1}
        >
          ‹
        </button>

        {#if totalPages <= 5}
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
            <span class="page-ellipsis">…</span>
          {/if}

          {@const startPage = Math.max(2, currentPage - 1)}
          {@const endPage = Math.min(totalPages - 1, currentPage + 1)}
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
            <span class="page-ellipsis">…</span>
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
      {/snippet}
      {#if totalPages > 1}
        <div class="pagination">
          {@render pagination()}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .shader-explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background-color: var(--vscode-editor-background);
    align-items: stretch;
    flex-shrink: 0;
  }

  .toolbar-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
    width: 100%;
  }

  .search-container {
    flex: 1 1 120px;
    min-width: 120px;
    margin: 0;
    display: flex;
    align-items: center;
    max-width: unset;
  }

  .search-input {
    min-width: 0;
    flex: 1 1 auto;
    width: 100%;
    padding: 3px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    font-size: 12px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--vscode-focusBorder);
  }

  .icon-button {
    padding: 3px 6px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    line-height: 1;
  }

  .icon-button:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .panel-icon {
    display: block;
  }

  .options-divider {
    border-top: 1px solid var(--vscode-panel-border);
    margin: 2px -8px 6px -8px;
  }

  .sort-select,
  .page-size-select {
    padding: 3px 6px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px;
    font-size: 12px;
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
    gap: 4px;
  }

  .size-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
  }

  .card-size-slider {
    width: 80px;
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
    gap: 4px;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-control input[type="checkbox"] {
    cursor: pointer;
  }

  .checkbox-label {
    font-size: 11px;
    color: var(--vscode-foreground);
    white-space: nowrap;
  }

  .shader-count {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    white-space: nowrap;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .shader-grid {
    display: grid;
    gap: 8px;
  }

  .shader-grid.row-mode {
    display: flex;
    flex-direction: column;
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
    gap: 2px;
    justify-content: center;
    align-items: center;
    margin: 8px 0 8px 0;
    padding: 4px 0;
  }

  .pagination-top {
    margin-top: 0;
    margin-bottom: 8px;
  }

  .page-button {
    min-width: 24px;
    height: 24px;
    padding: 0 4px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
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
