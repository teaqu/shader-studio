<script lang="ts">
  import { onMount } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import ChannelPreview from "./ChannelPreview.svelte";
  import AssetBrowser from "./AssetBrowser.svelte";
  import {
    TEXTURE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    AUDIO_EXTENSIONS,
    CUBEMAP_EXTENSIONS,
    VOLUME_EXTENSIONS,
  } from "../../constants/assetExtensions";

  export let isOpen: boolean;
  export let channelName: string;
  export let channelInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;
  export let onClose: () => void;
  export let onSave: (channelName: string, input: ConfigInput) => void;
  export let onRemove: (channelName: string) => void;
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let shaderPath: string = "";

  type TabName = "Misc" | "Textures" | "Cubemaps" | "Volumes" | "Videos" | "Music";
  const TABS: TabName[] = ["Misc", "Textures", "Cubemaps", "Volumes", "Videos", "Music"];

  let modalContent: HTMLElement;
  let tempInput: ConfigInput | undefined;
  let initializedWithInput: ConfigInput | undefined = undefined;
  let activeTab: TabName | null = null;

  // Map input types to tabs
  function typeToTab(type: string | undefined): TabName | null {
    switch (type) {
      case "buffer":
      case "keyboard":
        return "Misc";
      case "texture":
        return "Textures";
      case "video":
        return "Videos";
      default:
        return null;
    }
  }

  // Initialize temp input ONLY when modal first opens
  $: {
    if (isOpen) {
      if (channelInput !== initializedWithInput) {
        initializedWithInput = channelInput;
        if (channelInput) {
          tempInput = { ...channelInput };
          activeTab = typeToTab(channelInput.type);
        } else {
          tempInput = undefined;
          activeTab = null;
        }
      }
    } else {
      initializedWithInput = undefined;
      activeTab = null;
    }
  }

  // When parent config updates with resolved_path, merge it into tempInput
  $: if (isOpen && tempInput && channelInput && 'resolved_path' in channelInput) {
    const parentResolved = (channelInput as any).resolved_path;
    const parentPath = 'path' in channelInput ? channelInput.path : undefined;
    const tempPath = 'path' in tempInput ? tempInput.path : undefined;
    if (parentResolved && parentPath === tempPath && (tempInput as any).resolved_path !== parentResolved) {
      tempInput = { ...tempInput, resolved_path: parentResolved } as ConfigInput;
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".modal-content")) {
      onClose();
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && isOpen) {
      onClose();
    }
  }

  function handleRemove() {
    onRemove(channelName);
  }

  function autoSave() {
    if (tempInput) {
      onSave(channelName, tempInput);
    }
  }

  function selectTab(tab: TabName) {
    activeTab = tab;
    // If the current tempInput type doesn't match the tab, create a default
    const currentTab = typeToTab(tempInput?.type);
    if (currentTab !== tab) {
      switch (tab) {
        case "Misc":
          // Default to buffer when switching to Misc
          tempInput = { type: "buffer", source: "BufferA" };
          break;
        case "Textures":
          tempInput = { type: "texture", path: "" };
          break;
        case "Cubemaps":
          tempInput = { type: "texture", path: "" };
          break;
        case "Volumes":
          tempInput = { type: "texture", path: "" };
          break;
        case "Videos":
          tempInput = { type: "video", path: "" };
          break;
        case "Music":
          tempInput = { type: "video", path: "" };
          break;
      }
      autoSave();
    }
  }

  function updateInputType(newType: "buffer" | "texture" | "video" | "keyboard") {
    if (newType === "buffer") {
      tempInput = { type: "buffer", source: "BufferA" };
    } else if (newType === "texture") {
      tempInput = { type: "texture", path: "" };
    } else if (newType === "video") {
      tempInput = { type: "video", path: "" };
    } else {
      tempInput = { type: "keyboard" };
    }
    autoSave();
  }

  function updateBufferSource(source: "BufferA" | "BufferB" | "BufferC" | "BufferD") {
    if (tempInput && tempInput.type === "buffer") {
      tempInput = { ...tempInput, source };
      autoSave();
    }
  }

  function updatePath(path: string) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      const cleanPath = extractOriginalPath(path);
      const { resolved_path, ...rest } = tempInput as any;
      tempInput = { ...rest, path: cleanPath } as ConfigInput;
      autoSave();
    }
  }

  function extractOriginalPath(path: string): string {
    if (path.includes('vscode-resource') || path.includes('vscode-cdn')) {
      try {
        const match = path.match(/vscode-[^/]+\.net(\/.*?)(?:[?#]|$)/);
        if (match && match[1]) {
          return decodeURIComponent(match[1]);
        }
        const decoded = decodeURIComponent(path);
        const pathMatch = decoded.match(/([A-Za-z]:[\\\/]|\/)[^?#]*/);
        if (pathMatch) {
          return pathMatch[0];
        }
      } catch (e) {
        console.warn('Failed to extract path from webview URI:', e);
      }
    }
    return path;
  }

  function handleAssetSelect(path: string) {
    updatePath(path);
  }

  function updateFilter(filter: "linear" | "nearest" | "mipmap") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = { ...tempInput, filter };
      autoSave();
    }
  }

  function updateWrap(wrap: "repeat" | "clamp") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = { ...tempInput, wrap };
      autoSave();
    }
  }

  function updateVFlip(vflip: boolean) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = { ...tempInput, vflip };
      autoSave();
    }
  }

  function updateGrayscale(grayscale: boolean) {
    if (tempInput && tempInput.type === "texture") {
      tempInput = { ...tempInput, grayscale };
      autoSave();
    }
  }

  onMount(() => {
    if (isOpen && modalContent) {
      const firstInput = modalContent.querySelector("select, input") as HTMLElement;
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
      }
    }
  });
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if isOpen}
  <div
    class="modal-overlay"
    on:click={handleBackdropClick}
    on:keydown={handleKeyDown}
    role="presentation"
  >
    <div class="modal-content" bind:this={modalContent} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <!-- Modal Header -->
      <div class="modal-header">
        <h2 id="modal-title">Configure {channelName}</h2>
      </div>

      <!-- Tab Bar -->
      <div class="tab-bar" role="tablist">
        {#each TABS as tab}
          <button
            class="tab-btn"
            class:active={activeTab === tab}
            role="tab"
            aria-selected={activeTab === tab}
            on:click={() => selectTab(tab)}
          >
            {tab}
          </button>
        {/each}
      </div>

      <!-- Modal Body -->
      <div class="modal-body">
        {#if activeTab === null}
          <div class="tab-prompt">Select a category above to configure this channel.</div>
        {:else if activeTab === "Misc"}
          <!-- Misc: Buffer + Keyboard options -->
          <div class="misc-grid">
            <div class="misc-section-label">Buffer</div>
            <div class="misc-options">
              {#each ["BufferA", "BufferB", "BufferC", "BufferD"] as buf}
                <button
                  class="misc-card"
                  class:selected={tempInput?.type === "buffer" && tempInput.source === buf}
                  on:click={() => {
                    tempInput = { type: "buffer", source: buf };
                    autoSave();
                  }}
                >
                  <ChannelPreview channelInput={{ type: "buffer", source: buf }} {getWebviewUri} />
                  <div class="misc-card-label">{buf}</div>
                </button>
              {/each}
            </div>

            <div class="misc-section-label">Other</div>
            <div class="misc-options">
              <button
                class="misc-card"
                class:selected={tempInput?.type === "keyboard"}
                on:click={() => {
                  tempInput = { type: "keyboard" };
                  autoSave();
                }}
              >
                <ChannelPreview channelInput={{ type: "keyboard" }} {getWebviewUri} />
                <div class="misc-card-label">Keyboard</div>
              </button>
            </div>
          </div>

        {:else if activeTab === "Textures"}
          {#if postMessage}
            <AssetBrowser
              extensions={TEXTURE_EXTENSIONS}
              {shaderPath}
              {postMessage}
              onSelect={handleAssetSelect}
              selectedPath={(tempInput?.type === "texture" && tempInput.path) || ""}
            />
          {/if}

          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={(tempInput?.type === "texture" && tempInput.path) || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to texture file"
              class="input-text"
            />
          </div>

          {#if tempInput?.type === "texture"}
            <div class="input-row">
              <div class="input-group">
                <label for="filter-{channelName}">Filter:</label>
                <select
                  id="filter-{channelName}"
                  value={tempInput.filter || "mipmap"}
                  on:change={(e) => updateFilter(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="mipmap">Mipmap</option>
                  <option value="linear">Linear</option>
                  <option value="nearest">Nearest</option>
                </select>
              </div>

              <div class="input-group">
                <label for="wrap-{channelName}">Wrap:</label>
                <select
                  id="wrap-{channelName}"
                  value={tempInput.wrap || "repeat"}
                  on:change={(e) => updateWrap(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="repeat">Repeat</option>
                  <option value="clamp">Clamp</option>
                </select>
              </div>
            </div>

            <div class="input-row">
              <div class="input-group checkbox-group">
                <label for="vflip-{channelName}">
                  <input
                    id="vflip-{channelName}"
                    type="checkbox"
                    checked={tempInput.vflip ?? true}
                    on:change={(e) => updateVFlip(e.currentTarget.checked)}
                    class="input-checkbox"
                  />
                  Vertical Flip
                </label>
              </div>

              <div class="input-group checkbox-group">
                <label for="grayscale-{channelName}">
                  <input
                    id="grayscale-{channelName}"
                    type="checkbox"
                    checked={tempInput.grayscale ?? false}
                    on:change={(e) => updateGrayscale(e.currentTarget.checked)}
                    class="input-checkbox"
                  />
                  Grayscale
                </label>
              </div>
            </div>
          {/if}

        {:else if activeTab === "Cubemaps"}
          <div class="tab-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.36.2-.8.2-1.14 0l-7.9-4.44A.99.99 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.36-.2.8-.2 1.14 0l7.9 4.44c.32.17.53.5.53.88v9zM12 4.15L5 8.09v7.82l7 3.94 7-3.94V8.09l-7-3.94z"/></svg>
            <span>Cubemap support is in progress</span>
          </div>
          <div class="hidden-content" aria-hidden="true">
            {#if postMessage}
              <AssetBrowser
                extensions={CUBEMAP_EXTENSIONS}
                {shaderPath}
                {postMessage}
                onSelect={handleAssetSelect}
                selectedPath={(tempInput?.type === "texture" && tempInput.path) || ""}
              />
            {/if}

            <div class="input-group">
              <label for="path-{channelName}">Path:</label>
              <input
                id="path-{channelName}"
                type="text"
                value={(tempInput?.type === "texture" && tempInput.path) || ""}
                on:input={(e) => updatePath(e.currentTarget.value)}
                placeholder="Path to cubemap file"
                class="input-text"
              />
            </div>
          </div>

        {:else if activeTab === "Volumes"}
          <div class="tab-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.36.2-.8.2-1.14 0l-7.9-4.44A.99.99 0 0 1 3 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.36-.2.8-.2 1.14 0l7.9 4.44c.32.17.53.5.53.88v9zM12 4.15L5 8.09v7.82l7 3.94 7-3.94V8.09l-7-3.94z"/></svg>
            <span>Volume support is in progress</span>
          </div>
          <div class="hidden-content" aria-hidden="true">
            {#if postMessage}
              <AssetBrowser
                extensions={VOLUME_EXTENSIONS}
                {shaderPath}
                {postMessage}
                onSelect={handleAssetSelect}
                selectedPath={(tempInput?.type === "texture" && tempInput.path) || ""}
              />
            {/if}

            <div class="input-group">
              <label for="path-{channelName}">Path:</label>
              <input
                id="path-{channelName}"
                type="text"
                value={(tempInput?.type === "texture" && tempInput.path) || ""}
                on:input={(e) => updatePath(e.currentTarget.value)}
                placeholder="Path to volume file"
                class="input-text"
              />
            </div>
          </div>

        {:else if activeTab === "Videos"}
          {#if postMessage}
            <AssetBrowser
              extensions={VIDEO_EXTENSIONS}
              {shaderPath}
              {postMessage}
              onSelect={handleAssetSelect}
              selectedPath={(tempInput?.type === "video" && tempInput.path) || ""}
            />
          {/if}

          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={(tempInput?.type === "video" && tempInput.path) || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to video file or URL"
              class="input-text"
            />
          </div>

          {#if tempInput?.type === "video"}
            <div class="input-row">
              <div class="input-group">
                <label for="filter-{channelName}">Filter:</label>
                <select
                  id="filter-{channelName}"
                  value={tempInput.filter || "linear"}
                  on:change={(e) => updateFilter(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="linear">Linear</option>
                  <option value="nearest">Nearest</option>
                  <option value="mipmap">Mipmap</option>
                </select>
              </div>

              <div class="input-group">
                <label for="wrap-{channelName}">Wrap:</label>
                <select
                  id="wrap-{channelName}"
                  value={tempInput.wrap || "clamp"}
                  on:change={(e) => updateWrap(e.currentTarget.value as any)}
                  class="input-select"
                >
                  <option value="clamp">Clamp</option>
                  <option value="repeat">Repeat</option>
                </select>
              </div>
            </div>

            <div class="input-row">
              <div class="input-group checkbox-group">
                <label for="vflip-{channelName}">
                  <input
                    id="vflip-{channelName}"
                    type="checkbox"
                    checked={tempInput.vflip ?? true}
                    on:change={(e) => updateVFlip(e.currentTarget.checked)}
                    class="input-checkbox"
                  />
                  Vertical Flip
                </label>
              </div>
            </div>
          {/if}

        {:else if activeTab === "Music"}
          <div class="tab-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
            <span>Music support is in progress</span>
          </div>
          <div class="hidden-content" aria-hidden="true">
            {#if postMessage}
              <AssetBrowser
                extensions={AUDIO_EXTENSIONS}
                {shaderPath}
                {postMessage}
                onSelect={handleAssetSelect}
                selectedPath={(tempInput?.type === "video" && tempInput.path) || ""}
              />
            {/if}

            <div class="input-group">
              <label for="path-{channelName}">Path:</label>
              <input
                id="path-{channelName}"
                type="text"
                value={(tempInput?.type === "video" && tempInput.path) || ""}
                on:input={(e) => updatePath(e.currentTarget.value)}
                placeholder="Path to audio file"
                class="input-text"
              />
            </div>
          </div>
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        {#if channelInput}
          <button class="btn-remove" on:click={handleRemove}>
            Remove
          </button>
        {/if}
        <div class="footer-spacer"></div>
        <button class="btn-primary" on:click={onClose}>
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-content {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    max-width: 800px;
    width: 100%;
    max-height: 90vh;
    min-height: 500px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-editor-background, #1e1e1e);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--vscode-foreground, #cccccc);
  }

  .tab-bar {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background, #1e1e1e));
    height: 35px;
    flex-shrink: 0;
    overflow-x: auto;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    padding: 0 14px;
    background: var(--vscode-tab-inactiveBackground, transparent);
    border: none;
    border-right: 1px solid var(--vscode-tab-border, var(--vscode-panel-border, #3c3c3c));
    border-radius: 0;
    color: var(--vscode-tab-inactiveForeground, #888);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .tab-btn:hover {
    background: var(--vscode-tab-hoverBackground);
    color: var(--vscode-tab-hoverForeground, #cccccc);
  }

  .tab-btn:focus,
  .tab-btn:focus-visible,
  .tab-btn:active {
    outline: none;
    box-shadow: none;
  }

  .tab-btn.active {
    background: var(--vscode-tab-activeBackground, var(--vscode-editor-background, #1e1e1e));
    color: var(--vscode-tab-activeForeground, #cccccc);
    border-bottom: 1px solid var(--vscode-tab-activeBackground, var(--vscode-editor-background, #1e1e1e));
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    padding: 12px 20px;
    border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
    display: flex;
    gap: 8px;
    align-items: center;
    background: var(--vscode-editor-background, #1e1e1e);
  }

  .tab-prompt {
    text-align: center;
    padding: 32px 16px;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 14px;
  }

  .hidden-content {
    display: none;
  }

  .tab-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 16px;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 14px;
    opacity: 0.7;
  }

  /* Misc tab */
  .misc-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .misc-section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground, #888);
    letter-spacing: 0.5px;
    margin-top: 4px;
  }

  .misc-options {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }

  .misc-card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.15s ease;
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 0;
  }

  .misc-card:hover {
    border-color: var(--vscode-focusBorder, #007acc);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .misc-card.selected {
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
  }

  .misc-card-label {
    padding: 6px 4px;
    font-size: 11px;
    text-align: center;
    color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-tab-inactiveBackground, #2d2d2d);
    border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
  }

  /* Shared form styles */
  .input-row {
    display: flex;
    gap: 12px;
  }

  .input-row .input-group {
    flex: 1;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  .input-group label {
    font-size: 14px;
    font-weight: 500;
    color: var(--vscode-foreground, #cccccc);
  }

  .input-select,
  .input-text {
    padding: 8px 12px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    font-size: 14px;
  }

  .input-select:focus,
  .input-text:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .checkbox-group {
    flex-direction: row;
    align-items: center;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }

  .input-checkbox {
    cursor: pointer;
  }

  .footer-spacer {
    flex: 1;
  }

  .btn-primary,
  .btn-remove {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .btn-primary {
    background: var(--vscode-button-background, #007acc);
    color: var(--vscode-button-foreground, white);
  }

  .btn-primary:hover {
    background: var(--vscode-button-hoverBackground, #005a9e);
  }

  .btn-remove {
    background: transparent;
    color: var(--vscode-errorForeground, #f48771);
    border: 1px solid var(--vscode-errorForeground, #f48771);
  }

  .btn-remove:hover {
    background: var(--vscode-errorForeground, #f48771);
    color: white;
  }
</style>
