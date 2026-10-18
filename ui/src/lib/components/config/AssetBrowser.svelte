<script lang="ts">
  import VolumePreview from "./VolumePreview.svelte";
  import type { MessageEvent as ShaderMessage } from "@shader-studio/types";
  import { onMount, onDestroy, untrack } from "svelte";
  import type { WorkspaceFileInfo } from "@shader-studio/types";
  import {
    VOLUME_EXTENSIONS,
    AUDIO_EXTENSIONS,
    VIDEO_EXTENSIONS,
  } from "@shader-studio/types";
  import { getWaveformPeaks } from "../../util/waveformCache";
  import { getHostDefaultAssets, getHostAssetUploader } from "../../state/hostState.svelte";

  interface Props {
    extensions: string[];
    shaderPath: string;
    postMessage?: (msg: ShaderMessage) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
    onSelect: (path: string, resolvedUri?: string) => void;
    selectedPath?: string;
  }

  let {
    extensions,
    shaderPath,
    postMessage = undefined,
    onMessage = undefined,
    onSelect,
    selectedPath = "",
  }: Props = $props();

  const PAGE_SIZE = 8;

  function defaultAssets(): WorkspaceFileInfo[] {
    return getHostDefaultAssets().filter((asset) =>
      extensions.includes(asset.name.split(".").pop() ?? ""),
    );
  }

  let files: WorkspaceFileInfo[] = $state([]);
  let loading = $state(true);
  let searchQuery = $state("");
  let currentPage = $state(1);
  let loadingTimeout: ReturnType<typeof setTimeout> | undefined;
  let uploadInput = $state<HTMLInputElement>();
  let uploading = $state(false);
  let uploadError = $state('');
  const uploader = $derived(getHostAssetUploader());

  async function uploadFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const selection = Array.from(input.files ?? []);
    input.value = '';
    if (!selection.length || !uploader) {
      return;
    }
    uploadError = '';
    if (selection.some(file => !extensions.includes(file.name.split('.').pop()?.toLowerCase() ?? ''))) {
      uploadError = `Choose a supported asset: ${extensions.map(extension => `.${extension}`).join(', ')}.`;
      return;
    }
    uploading = true;
    try {
      const uploaded = await uploader(selection, shaderPath);
      files = [...files, ...uploaded];
      loading = false;
      clearLoadingTimeout();
      searchQuery = '';
      if (uploaded[0]) {
        handleSelect(uploaded[0]);
      }
    } catch (error) {
      uploadError = error instanceof Error ? error.message : 'Could not upload assets.';
    } finally {
      uploading = false;
    }
  }

  let filteredFiles = $derived(files.filter((file) => {
    if (!searchQuery) {
      return true;
    }
    const query = searchQuery.toLowerCase();
    return (
      file.name.toLowerCase().includes(query) ||
      file.workspacePath.toLowerCase().includes(query)
    );
  }));

  // Reset page when search changes
  $effect(() => {
    searchQuery; // track searchQuery
    untrack(() => {
      currentPage = 1;
    });
  });

  let totalPages = $derived(Math.ceil(filteredFiles.length / PAGE_SIZE));

  // Clamp page if it exceeds total
  $effect(() => {
    const tp = totalPages;
    untrack(() => {
      if (currentPage > tp && tp > 0) {
        currentPage = tp;
      }
    });
  });

  let paginatedFiles = $derived(filteredFiles.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  ));

  let sameDirFiles = $derived(paginatedFiles.filter((f) => f.isSameDirectory));
  let otherFiles = $derived(paginatedFiles.filter((f) => !f.isSameDirectory));

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    if (message?.type === "workspaceFiles") {
      files = [...defaultAssets(), ...message.payload.files];
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
    if (!selectedPath) {
      return false;
    }
    return (
      selectedPath === file.name ||
      selectedPath === file.workspacePath ||
      selectedPath === `./${file.name}`
    );
  }

  function getFileType(name: string): 'image' | 'video' | 'audio' | 'volume' {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (VOLUME_EXTENSIONS.includes(ext)) {
      return 'volume';
    }
    if (VIDEO_EXTENSIONS.includes(ext)) {
      return 'video';
    }
    if (AUDIO_EXTENSIONS.includes(ext)) {
      return 'audio';
    }
    return 'image';
  }

  function drawWaveform(canvas: HTMLCanvasElement, peaks: Float32Array) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const n = peaks.length;
    if (n === 0) {
      return;
    }
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
    <button class="refresh-btn" onclick={requestFiles} title="Refresh" aria-label="Refresh files">
      <i class="codicon codicon-refresh"></i>
    </button>
    {#if uploader}
      <button class="refresh-btn" title="Upload from device" disabled={uploading} onclick={() => uploadInput?.click()}>
        <i class="codicon codicon-cloud-upload" aria-hidden="true"></i> {uploading ? 'Uploading…' : 'Upload…'}
      </button>
      <input class="upload-input" aria-label="Upload assets" bind:this={uploadInput} type="file" multiple accept={extensions.map(extension => `.${extension}`).join(',')} onchange={uploadFiles} />
    {/if}
  </div>
  {#if uploadError}<p role="alert">{uploadError}</p>{/if}

  <div class="browser-content">
    {#if loading}
      <div class="browser-state">Loading files...</div>
    {:else if filteredFiles.length === 0}
      <div class="browser-state"><span>No files found</span><small>Use Select or enter a path below.</small></div>
    {:else}
      {#if sameDirFiles.length > 0}
        <div class="group-header">Same Folder</div>
        <div class="file-grid">
          {#each sameDirFiles as file}
            <button
              class="file-card"
              class:audio-card={getFileType(file.name) === 'audio'}
              class:selected={isSelected(file)}
              onclick={() => handleSelect(file)}
              title={file.name}
            >
              <div class="file-thumbnail" class:audio-thumbnail={getFileType(file.name) === 'audio'}>
                {#if getFileType(file.name) === 'video'}
                  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                  <video
                    src={file.thumbnailUri}
                    preload="metadata"
                    muted
                    loop
                    onmouseenter={(e) => e.currentTarget.play()}
                    onmouseleave={(e) => {
                      e.currentTarget.pause(); e.currentTarget.currentTime = 0;
                    }}
                  ></video>
                {:else if getFileType(file.name) === 'volume'}
                  <VolumePreview path={file.thumbnailUri} thumbnail={true} />
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
              onclick={() => handleSelect(file)}
              title={file.workspacePath}
            >
              <div class="file-thumbnail" class:audio-thumbnail={getFileType(file.name) === 'audio'}>
                {#if getFileType(file.name) === 'video'}
                  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                  <video
                    src={file.thumbnailUri}
                    preload="metadata"
                    muted
                    loop
                    onmouseenter={(e) => e.currentTarget.play()}
                    onmouseleave={(e) => {
                      e.currentTarget.pause(); e.currentTarget.currentTime = 0;
                    }}
                  ></video>
                {:else if getFileType(file.name) === 'volume'}
                  <VolumePreview path={file.thumbnailUri} thumbnail={true} />
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
            onclick={prevPage}
            disabled={currentPage === 1}
            aria-label="Previous page"
          >
            <i class="codicon codicon-chevron-left"></i>
          </button>

          {#if totalPages <= 7}
            {#each Array(totalPages) as _, i}
              <button
                class="page-button"
                class:active={currentPage === i + 1}
                onclick={() => goToPage(i + 1)}
              >
                {i + 1}
              </button>
            {/each}
          {:else}
            <button
              class="page-button"
              class:active={currentPage === 1}
              onclick={() => goToPage(1)}
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
                onclick={() => goToPage(pageNum)}
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
              onclick={() => goToPage(totalPages)}
            >
              {totalPages}
            </button>
          {/if}

          <button
            class="page-button"
            onclick={nextPage}
            disabled={currentPage === totalPages}
            aria-label="Next page"
          >
            <i class="codicon codicon-chevron-right"></i>
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .upload-input { display: none; }
  .asset-browser {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  .browser-toolbar {
    display: flex;
    gap: 6px;
  }

  .search-input {
    min-width: 0;
    flex: 1;
    padding: var(--shader-studio-control-padding);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: var(--shader-studio-control-radius);
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    font-size: var(--shader-studio-font-size);
    min-height: var(--shader-studio-control-height);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .search-input:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
}

  .refresh-btn {
    padding: var(--shader-studio-control-padding);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: var(--shader-studio-control-radius);
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-foreground, #cccccc);
    cursor: pointer;
    font-size: 16px;
    line-height: var(--shader-studio-control-line-height);
    min-height: var(--shader-studio-control-height);
  }

  .refresh-btn:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
  }

  .browser-content {
    max-height: 190px;
    overflow-y: auto;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    padding: 8px;
    background: var(--vscode-editor-background, #1e1e1e);
  }

  .browser-state {
    text-align: center;
    padding: 14px 8px;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 13px;
  }

  .browser-state small { display: block; margin-top: 4px; font-size: 12px; }

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
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 112px), 1fr));
    gap: 8px;
    margin-bottom: 0;
  }

  .file-card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: var(--shader-studio-control-radius);
    overflow: hidden;
    cursor: pointer;
    transition: all 0.15s ease;
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 0;
    text-align: center;
    min-height: var(--shader-studio-control-height);
  }

  .file-card:hover {
    border-color: var(--vscode-focusBorder, #007acc);
    background: var(--vscode-list-hoverBackground);
  }

  .file-card.selected {
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
  }

  .file-thumbnail {
    width: 100%;
    aspect-ratio: 4 / 3;
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
    object-fit: contain;
  }


  .audio-card {
    grid-column: 1 / -1;
  }

  .audio-thumbnail {
    aspect-ratio: auto;
    height: 48px;
  }

  .audio-waveform-thumbnail {
    width: 100%;
    height: 100%;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
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
    box-sizing: border-box;
    min-height: 38px;
    width: 100%;
    font-size: 12px;
    line-height: 15px;
    color: var(--vscode-foreground, #cccccc);
    white-space: normal;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
    height: var(--shader-studio-control-height);
    padding: var(--shader-studio-control-padding);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: var(--shader-studio-control-radius);
    cursor: pointer;
    font-size: var(--shader-studio-font-size);
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
    font-weight: 400;
  }

  .page-ellipsis {
    padding: 0 4px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
</style>
