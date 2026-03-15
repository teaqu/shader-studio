<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import MiscTab from "./tabs/MiscTab.svelte";
  import TextureTab from "./tabs/TextureTab.svelte";
  import CubemapTab from "./tabs/CubemapTab.svelte";
  import VideoTab from "./tabs/VideoTab.svelte";
  import MusicTab from "./tabs/MusicTab.svelte";

  export let isOpen: boolean;
  export let channelName: string;
  export let channelInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;
  export let onClose: () => void;
  export let onSave: (channelName: string, input: ConfigInput) => void;
  export let onRemove: (channelName: string) => void;
  export let onRename: ((oldName: string, newName: string) => void) | undefined = undefined;
  export let existingChannelNames: string[] = [];
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;
  export let shaderPath: string = "";
  export let onVideoControl: ((path: string, action: string) => void) | undefined = undefined;
  export let getVideoState: ((path: string) => { paused: boolean; muted: boolean; currentTime: number; duration: number } | null) | undefined = undefined;
  export let onAudioControl: ((path: string, action: string) => void) | undefined = undefined;
  export let getAudioState: ((path: string) => { paused: boolean; muted: boolean; currentTime: number; duration: number } | null) | undefined = undefined;
  export let getAudioFFT: ((type: string, path?: string) => Uint8Array | null) | undefined = undefined;

  let editingName = false;
  let nameInput = "";
  let nameError = "";

  type TabName = "Misc" | "Textures" | "Cubemaps" | "Videos" | "Music";
  const TABS: TabName[] = ["Misc", "Textures", "Cubemaps", "Videos", "Music"];

  let modalContent: HTMLElement;
  let tempInput: ConfigInput | undefined;
  const UNINITIALIZED = Symbol();
  let initializedWithInput: ConfigInput | undefined | typeof UNINITIALIZED = UNINITIALIZED;
  let activeTab: TabName | null = null;

  // Map input types to tabs
  function typeToTab(type: string | undefined): TabName | null {
    switch (type) {
      case "buffer":
      case "keyboard":
        return "Misc";
      case "texture":
        return "Textures";
      case "cubemap":
        return "Cubemaps";
      case "video":
        return "Videos";
      case "audio":
        return "Music";
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
          activeTab = "Misc";
        }
      }
    } else {
      initializedWithInput = UNINITIALIZED;
      activeTab = null;
      editingName = false;
      nameError = "";
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

  async function startRename() {
    nameInput = channelName;
    nameError = "";
    editingName = true;
    await tick();
    const input = modalContent?.querySelector('.name-input') as HTMLInputElement;
    input?.focus();
    input?.select();
  }

  function cancelRename() {
    editingName = false;
    nameError = "";
  }

  function submitRename() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === channelName) {
      cancelRename();
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      nameError = "Must be a valid GLSL identifier";
      return;
    }
    if (existingChannelNames.includes(trimmed)) {
      nameError = "Name already in use";
      return;
    }
    if (onRename) {
      onRename(channelName, trimmed);
    }
    editingName = false;
    nameError = "";
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelRename();
    }
  }

  function autoSave() {
    if (tempInput) {
      onSave(channelName, tempInput);
    }
  }

  function selectTab(tab: TabName) {
    activeTab = tab;
    const currentTab = typeToTab(tempInput?.type);
    if (currentTab !== tab) {
      switch (tab) {
        case "Misc":
          tempInput = { type: "buffer", source: "BufferA" };
          break;
        case "Textures":
          tempInput = { type: "texture", path: "" };
          break;
        case "Cubemaps":
          tempInput = { type: "cubemap", path: "" };
          break;
        case "Videos":
          tempInput = { type: "video", path: "" };
          break;
        case "Music":
          tempInput = { type: "audio", path: "" };
          break;
      }
      autoSave();
    }
  }

  function updatePath(path: string) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video" || tempInput.type === "cubemap" || tempInput.type === "audio")) {
      const cleanPath = extractOriginalPath(path);
      const { resolved_path, startTime, endTime, ...rest } = tempInput as any;
      const isPathChange = 'path' in tempInput && (tempInput as any).path !== cleanPath;
      const preserveTimes = tempInput.type === "audio" && !isPathChange;
      const updated: any = { ...rest, path: cleanPath };
      if (preserveTimes) {
        if (startTime != null) updated.startTime = startTime;
        if (endTime != null) updated.endTime = endTime;
      }
      tempInput = updated as ConfigInput;
      autoSave();
      // If changing audio path while playing, auto-play the new song
      if (tempInput.type === "audio" && isPathChange && tempInput.path) {
        resumeAudioAfterSave();
      }
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

  let lastSelectedResolvedUri: string = '';

  function handleAssetSelect(path: string, resolvedUri?: string) {
    if (resolvedUri) {
      lastSelectedResolvedUri = resolvedUri;
    }
    updatePath(path);
  }

  function updateFilter(filter: "linear" | "nearest" | "mipmap") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video" || tempInput.type === "cubemap")) {
      tempInput = { ...tempInput, filter };
      autoSave();
    }
  }

  function updateWrap(wrap: "repeat" | "clamp") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video" || tempInput.type === "cubemap")) {
      tempInput = { ...tempInput, wrap };
      autoSave();
    }
  }

  function updateVFlip(vflip: boolean) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video" || tempInput.type === "cubemap")) {
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

  /** Resume audio after a config save that triggers a forceCleanup recompile */
  function resumeAudioAfterSave() {
    if (tempInput?.type === 'audio' && tempInput.path && onAudioControl) {
      const path = (tempInput as any).resolved_path
        || (getWebviewUri ? getWebviewUri(tempInput.path) : null)
        || lastSelectedResolvedUri
        || tempInput.path;
      setTimeout(() => onAudioControl!(path, 'play'), 500);
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
        {#if editingName}
          <div class="name-edit-row">
            <input
              type="text"
              bind:value={nameInput}
              on:keydown={handleNameKeydown}
              on:blur={submitRename}
              class="name-input"
              class:name-error={nameError}
            />
            {#if nameError}
              <span class="name-error-text">{nameError}</span>
            {/if}
          </div>
        {:else}
          <h2 id="modal-title" class="channel-title">
            <span>{channelName}</span>
            <button class="rename-btn" on:click|stopPropagation={startRename} title="Rename channel">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/>
              </svg>
            </button>
          </h2>
        {/if}
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
          <MiscTab
            {tempInput}
            {getWebviewUri}
            onSelect={(input) => { tempInput = input; autoSave(); }}
          />

        {:else if activeTab === "Textures"}
          <TextureTab
            {tempInput}
            {channelName}
            {shaderPath}
            {postMessage}
            {onMessage}
            onAssetSelect={handleAssetSelect}
            onUpdatePath={updatePath}
            onUpdateFilter={updateFilter}
            onUpdateWrap={updateWrap}
            onUpdateVFlip={updateVFlip}
            onUpdateGrayscale={updateGrayscale}
          />

        {:else if activeTab === "Cubemaps"}
          <CubemapTab
            {tempInput}
            {channelName}
            {shaderPath}
            {postMessage}
            {onMessage}
            onAssetSelect={handleAssetSelect}
            onUpdatePath={updatePath}
            onUpdateFilter={updateFilter}
            onUpdateWrap={updateWrap}
            onUpdateVFlip={updateVFlip}
          />

        {:else if activeTab === "Videos"}
          <VideoTab
            {tempInput}
            {channelName}
            {shaderPath}
            {postMessage}
            {onMessage}
            onAssetSelect={handleAssetSelect}
            onUpdatePath={updatePath}
            onUpdateFilter={updateFilter}
            onUpdateWrap={updateWrap}
            onUpdateVFlip={updateVFlip}
            {onVideoControl}
            {getVideoState}
          />

        {:else if activeTab === "Music"}
          <MusicTab
            {tempInput}
            {channelName}
            {shaderPath}
            {postMessage}
            {getWebviewUri}
            {lastSelectedResolvedUri}
            onAssetSelect={handleAssetSelect}
            onUpdatePath={updatePath}
            onUpdateTempInput={(input) => { tempInput = input; }}
            onAutoSave={autoSave}
            {onAudioControl}
            {getAudioState}
          />
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

  .channel-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rename-btn {
    display: flex;
    align-items: center;
    padding: 4px;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.6;
    transition: opacity 0.15s;
  }

  .rename-btn:hover {
    opacity: 1;
    color: var(--vscode-foreground, #cccccc);
  }

  .name-edit-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .name-input {
    font-size: 18px;
    font-weight: 600;
    padding: 4px 8px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-focusBorder, #007acc);
    border-radius: 4px;
    outline: none;
    font-family: inherit;
  }

  .name-input.name-error {
    border-color: var(--vscode-inputValidation-errorBorder, #f44336);
  }

  .name-error-text {
    font-size: 12px;
    color: var(--vscode-errorForeground, #f48771);
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
