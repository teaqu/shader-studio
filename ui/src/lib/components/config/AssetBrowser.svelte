<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { WorkspaceFileInfo } from "@shader-studio/types";
  import { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from "../../constants/assetExtensions";
  import { getWaveformPeaks } from "../../util/waveformCache";

  export let extensions: string[];
  export let shaderPath: string;
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;
  export let onSelect: (path: string, resolvedUri?: string) => void;
  export let selectedPath: string = "";

  const PAGE_SIZE = 8;

  let files: WorkspaceFileInfo[] = [];
  let loading = true;
  let searchQuery = "";
  let currentPage = 1;
  let loadingTimeout: ReturnType<typeof setTimeout> | undefined;

  $: filteredFiles = files.filter((file) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      file.name.toLowerCase().includes(query) ||
      file.workspacePath.toLowerCase().includes(query)
    );
  });

  // Reset page when search changes
  $: if (searchQuery !== undefined) {
    currentPage = 1;
  }

  $: totalPages = Math.ceil(filteredFiles.length / PAGE_SIZE);

  // Clamp page if it exceeds total
  $: if (currentPage > totalPages && totalPages > 0) {
    currentPage = totalPages;
  }

  $: paginatedFiles = filteredFiles.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  $: sameDirFiles = paginatedFiles.filter((f) => f.isSameDirectory);
  $: otherFiles = paginatedFiles.filter((f) => !f.isSameDirectory);

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    if (message?.type === "workspaceFiles") {
      console.log('AssetBrowser: Received workspaceFiles response with', message.payload?.files?.length, 'files');
      files = message.payload.files;
      loading = false;
      clearLoadingTimeout();
    }
  }

  function clearLoadingTimeout() {
    if (loadingTimeout) {
      clearTimeout(loadingTimeout);
      loadingTimeout = undefined;
    }
  }

  function requestFiles() {
    loading = true;
    clearLoadingTimeout();
    if (postMessage) {
      console.log('AssetBrowser: Sending requestWorkspaceFiles for extensions:', extensions, 'shaderPath:', shaderPath);
      postMessage({
        type: "requestWorkspaceFiles",
        payload: { extensions, shaderPath },
      });
      // Fallback: if no response after 5s, show empty state
      loadingTimeout = setTimeout(() => {
        if (loading) {
          console.warn('AssetBrowser: Timed out waiting for workspaceFiles response');
          files = [];
          loading = false;
        }
      }, 5000);
    } else {
      console.warn('AssetBrowser: No postMessage function available');
      loading = false;
    }
  }

  function handleSelect(file: WorkspaceFileInfo) {
    if (file.isSameDirectory) {
      onSelect(file.name, file.thumbnailUri);
    } else {
      onSelect(file.workspacePath, file.thumbnailUri);
    }
  }

  function isSelected(file: WorkspaceFileInfo): boolean {
    if (!selectedPath) return false;
    return (
      selectedPath === file.name ||
      selectedPath === file.workspacePath ||
      selectedPath === `./${file.name}`
    );
  }

  function getFileType(name: string): 'image' | 'video' | 'audio' {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio';
    return 'image';
  }

  function drawWaveform(canvas: HTMLCanvasElement, peaks: Float32Array) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const n = peaks.length;
    if (n === 0) return;
    const centerY = h / 2;
    const amplitude = centerY * 0.85;

    // Draw mirrored smooth waveform (top half + bottom half)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();

    // Top edge (left to right)
    ctx.moveTo(0, centerY - peaks[0] * amplitude);
    for (let i = 1; i < n; i++) {
      const prevX = ((i - 1) / (n - 1)) * w;
      const x = (i / (n - 1)) * w;
      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(
        cpX, centerY - peaks[i - 1] * amplitude,
        cpX, centerY - peaks[i] * amplitude,
        x, centerY - peaks[i] * amplitude
      );
    }

    // Bottom edge (right to left, mirrored)
    for (let i = n - 1; i >= 1; i--) {
      const nextX = (i / (n - 1)) * w;
      const x = ((i - 1) / (n - 1)) * w;
      const cpX = (nextX + x) / 2;
      ctx.bezierCurveTo(
        cpX, centerY + peaks[i] * amplitude,
        cpX, centerY + peaks[i - 1] * amplitude,
        x, centerY + peaks[i - 1] * amplitude
      );
    }

    ctx.closePath();
    ctx.fill();
  }

  function waveformAction(canvas: HTMLCanvasElement, uri: string) {
    let cancelled = false;
    getWaveformPeaks(uri).then(peaks => {
      if (!cancelled && peaks) {
        drawWaveform(canvas, peaks);
      }
    });
    return {
      update(newUri: string) {
        cancelled = false;
        getWaveformPeaks(newUri).then(peaks => {
          if (!cancelled && peaks) {
            drawWaveform(canvas, peaks);
          }
        });
      },
      destroy() {
        cancelled = true;
      }
    };
  }

  function nextPage() {
    if (currentPage < totalPages) currentPage++;
  }

  function prevPage() {
    if (currentPage > 1) currentPage--;
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages) currentPage = page;
  }

  onMount(() => {
    if (onMessage) {
      onMessage(handleMessage);
    } else {
      window.addEventListener("message", handleMessage);
    }
    requestFiles();
  });

  onDestroy(() => {
    if (!onMessage) {
      window.removeEventListener("message", handleMessage);
    }
    clearLoadingTimeout();
  });
</script>

<div class="asset-browser">
  <div class="browser-toolbar">
    <input
      type="text"
      class="search-input"
      placeholder="Search files..."
      bind:value={searchQuery}
    />
    <button class="refresh-btn" on:click={requestFiles} title="Refresh">
      &#x21bb;
    </button>
  </div>

  <div class="browser-content">
    {#if loading}
      <div class="browser-state">Loading files...</div>
    {:else if filteredFiles.length === 0}
      <div class="browser-state">No files found</div>
    {:else}
      {#if sameDirFiles.length > 0}
        <div class="group-header">Same Folder</div>
        <div class="file-grid">
          {#each sameDirFiles as file}
            <button
              class="file-card"
              class:audio-card={getFileType(file.name) === 'audio'}
              class:selected={isSelected(file)}
              on:click={() => handleSelect(file)}
              title={file.name}
            >
              <div class="file-thumbnail" class:audio-thumbnail={getFileType(file.name) === 'audio'}>
                {#if getFileType(file.name) === 'video'}
                  <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                  <video
                    src={file.thumbnailUri}
                    preload="metadata"
                    muted
                    loop
                    on:mouseenter={(e) => e.currentTarget.play()}
                    on:mouseleave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                  ></video>
                {:else if getFileType(file.name) === 'audio'}
                  <div class="audio-waveform-thumbnail">
                    <canvas
                      class="waveform-canvas"
                      width="240"
                      height="80"
                      use:waveformAction={file.thumbnailUri}
                    ></canvas>
                  </div>
                {:else}
                  <img
                    src={file.thumbnailUri}
                    alt={file.name}
                    loading="lazy"
                  />
                {/if}
              </div>
              <div class="file-name">{file.name}</div>
            </button>
          {/each}
        </div>
      {/if}

      {#if otherFiles.length > 0}
        {#if sameDirFiles.length > 0}
          <div class="group-header">Workspace</div>
        {/if}
        <div class="file-grid">
          {#each otherFiles as file}
            <button
              class="file-card"
              class:audio-card={getFileType(file.name) === 'audio'}
              class:selected={isSelected(file)}
              on:click={() => handleSelect(file)}
              title={file.workspacePath}
            >
              <div class="file-thumbnail" class:audio-thumbnail={getFileType(file.name) === 'audio'}>
                {#if getFileType(file.name) === 'video'}
                  <!-- svelte-ignore a11y-mouse-events-have-key-events -->
                  <video
                    src={file.thumbnailUri}
                    preload="metadata"
                    muted
                    loop
                    on:mouseenter={(e) => e.currentTarget.play()}
                    on:mouseleave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                  ></video>
                {:else if getFileType(file.name) === 'audio'}
                  <div class="audio-waveform-thumbnail">
                    <canvas
                      class="waveform-canvas"
                      width="240"
                      height="80"
                      use:waveformAction={file.thumbnailUri}
                    ></canvas>
                  </div>
                {:else}
                  <img
                    src={file.thumbnailUri}
                    alt={file.name}
                    loading="lazy"
                  />
                {/if}
              </div>
              <div class="file-name">{file.name}</div>
            </button>
          {/each}
        </div>
      {/if}

      {#if totalPages > 1}
        <div class="pagination">
          <button
            class="page-button"
            on:click={prevPage}
            disabled={currentPage === 1}
          >
            &#x2039;
          </button>

          {#if totalPages <= 7}
            {#each Array(totalPages) as _, i}
              <button
                class="page-button"
                class:active={currentPage === i + 1}
                on:click={() => goToPage(i + 1)}
              >
                {i + 1}
              </button>
            {/each}
          {:else}
            <button
              class="page-button"
              class:active={currentPage === 1}
              on:click={() => goToPage(1)}
            >
              1
            </button>

            {#if currentPage > 3}
              <span class="page-ellipsis">...</span>
            {/if}

            {@const startPage = Math.max(2, Math.min(currentPage - 1, totalPages - 3))}
            {@const endPage = Math.min(totalPages - 1, Math.max(currentPage + 1, 4))}
            {#each Array(endPage - startPage + 1) as _, i}
              {@const pageNum = startPage + i}
              <button
                class="page-button"
                class:active={currentPage === pageNum}
                on:click={() => goToPage(pageNum)}
              >
                {pageNum}
              </button>
            {/each}

            {#if currentPage < totalPages - 2}
              <span class="page-ellipsis">...</span>
            {/if}

            <button
              class="page-button"
              class:active={currentPage === totalPages}
              on:click={() => goToPage(totalPages)}
            >
              {totalPages}
            </button>
          {/if}

          <button
            class="page-button"
            on:click={nextPage}
            disabled={currentPage === totalPages}
          >
            &#x203a;
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .asset-browser {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .browser-toolbar {
    display: flex;
    gap: 6px;
  }

  .search-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    font-size: 13px;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .refresh-btn {
    padding: 6px 10px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-foreground, #cccccc);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }

  .refresh-btn:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
  }

  .browser-content {
    overflow-y: auto;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    padding: 8px;
    background: var(--vscode-editor-background, #1e1e1e);
  }

  .browser-state {
    text-align: center;
    padding: 24px;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 13px;
  }

  .group-header {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground, #888);
    margin: 8px 0 4px;
    letter-spacing: 0.5px;
  }

  .group-header:first-child {
    margin-top: 0;
  }

  .file-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 8px;
    margin-bottom: 8px;
  }

  .file-card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.15s ease;
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 0;
    text-align: center;
  }

  .file-card:hover {
    border-color: var(--vscode-focusBorder, #007acc);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .file-card.selected {
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
  }

  .file-thumbnail {
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    background: rgba(127, 127, 127, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .file-thumbnail img,
  .file-thumbnail video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .media-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--vscode-descriptionForeground, #888);
  }

  .audio-card {
    grid-column: span 2;
  }

  .audio-thumbnail {
    aspect-ratio: auto;
    height: 48px;
  }

  .audio-waveform-thumbnail {
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .waveform-canvas {
    width: 100%;
    height: 100%;
  }

  .file-name {
    padding: 4px 6px;
    font-size: 11px;
    color: var(--vscode-foreground, #cccccc);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Pagination */
  .pagination {
    display: flex;
    gap: 4px;
    justify-content: center;
    align-items: center;
    margin-top: 8px;
    padding: 8px 0 0;
  }

  .page-button {
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
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
    font-size: 12px;
  }
</style>
