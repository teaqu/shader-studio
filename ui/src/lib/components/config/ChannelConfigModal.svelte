<script lang="ts">
  import { onMount } from "svelte";
  import type { ConfigInput } from "@shader-studio/types";
  import ChannelPreview from "./ChannelPreview.svelte";

  export let isOpen: boolean;
  export let channelName: string;
  export let channelInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;
  export let onClose: () => void;
  export let onSave: (channelName: string, input: ConfigInput) => void;
  export let onRemove: (channelName: string) => void;

  let modalContent: HTMLElement;
  let tempInput: ConfigInput | undefined;
  let initializedWithInput: ConfigInput | undefined = undefined;

  // Initialize temp input ONLY when modal first opens
  // Don't update if modal is already open and user is editing
  $: {
    if (isOpen) {
      // Only initialize if this is a new modal session
      // (channelInput changed or modal just opened)
      if (channelInput !== initializedWithInput) {
        initializedWithInput = channelInput;
        if (channelInput) {
          tempInput = { ...channelInput };
          // Note: Don't transform paths here - show exactly what's in the config
          // The config should contain the original user-entered paths
        } else {
          tempInput = undefined;
        }
      }
    } else {
      // Reset when modal closes
      initializedWithInput = undefined;
    }
  }

  // When parent config updates with resolved_path, merge it into tempInput
  // without resetting user edits (e.g. after autoSave round-trip to extension)
  // Only apply if paths match - prevents old resolved_path from being re-applied
  // after user changes the path to something different
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

  // Auto-save helper - calls onSave whenever tempInput changes
  function autoSave() {
    if (tempInput) {
      onSave(channelName, tempInput);
    }
  }

  function updateInputType(newType: "buffer" | "texture" | "video" | "keyboard") {
    if (newType === "buffer") {
      tempInput = {
        type: "buffer",
        source: "BufferA",
      };
    } else if (newType === "texture") {
      tempInput = {
        type: "texture",
        path: "",
      };
    } else if (newType === "video") {
      tempInput = {
        type: "video",
        path: "",
      };
    } else {
      tempInput = {
        type: "keyboard",
      };
    }
    autoSave();
  }

  function updateBufferSource(source: "BufferA" | "BufferB" | "BufferC" | "BufferD") {
    if (tempInput && tempInput.type === "buffer") {
      tempInput = {
        ...tempInput,
        source,
      };
      autoSave();
    }
  }

  function updatePath(path: string) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      // Ensure we don't save webview URIs - extract original path if needed
      const cleanPath = extractOriginalPath(path);
      // Clear resolved_path so preview re-resolves for the new path
      const { resolved_path, ...rest } = tempInput as any;
      tempInput = {
        ...rest,
        path: cleanPath,
      } as ConfigInput;
      autoSave();
    }
  }

  // Extract original file path from webview URI if present
  function extractOriginalPath(path: string): string {
    // If path is a webview URI, extract the original file path
    if (path.includes('vscode-resource') || path.includes('vscode-cdn')) {
      try {
        // Webview URIs typically have format: https://...vscode-...net/actual/file/path
        // Extract everything after the domain
        const match = path.match(/vscode-[^/]+\.net(\/.*?)(?:[?#]|$)/);
        if (match && match[1]) {
          // Decode any URL encoding
          return decodeURIComponent(match[1]);
        }

        // Fallback: try to find a file path pattern (starts with / or C:/)
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

  function updateFilter(filter: "linear" | "nearest" | "mipmap") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = {
        ...tempInput,
        filter,
      };
      autoSave();
    }
  }

  function updateWrap(wrap: "repeat" | "clamp") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = {
        ...tempInput,
        wrap,
      };
      autoSave();
    }
  }

  function updateVFlip(vflip: boolean) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = {
        ...tempInput,
        vflip,
      };
      autoSave();
    }
  }

  function updateGrayscale(grayscale: boolean) {
    if (tempInput && tempInput.type === "texture") {
      tempInput = {
        ...tempInput,
        grayscale,
      };
      autoSave();
    }
  }

  onMount(() => {
    // Focus first input when modal opens
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

      <!-- Modal Body -->
      <div class="modal-body">
        <!-- Preview -->
        <div class="modal-preview">
          {#key tempInput?.type === 'texture' ? tempInput?.path : tempInput?.type}
            <ChannelPreview channelInput={tempInput} {getWebviewUri} />
          {/key}
        </div>

        <!-- Type Selector -->
        <div class="input-group">
          <label for="type-{channelName}">Type:</label>
          <select
            id="type-{channelName}"
            value={tempInput?.type || ""}
            on:change={(e) => updateInputType(e.currentTarget.value as any)}
            class="input-select"
          >
            <option value="">-- Select Type --</option>
            <option value="buffer">Buffer</option>
            <option value="texture">Texture</option>
            <option value="video">Video</option>
            <option value="keyboard">Keyboard</option>
          </select>
        </div>

        <!-- Type-specific configuration -->
        {#if tempInput?.type === "buffer"}
          <div class="input-group">
            <label for="source-{channelName}">Source:</label>
            <select
              id="source-{channelName}"
              value={tempInput.source}
              on:change={(e) => updateBufferSource(e.currentTarget.value as any)}
              class="input-select"
            >
              <option value="BufferA">BufferA</option>
              <option value="BufferB">BufferB</option>
              <option value="BufferC">BufferC</option>
              <option value="BufferD">BufferD</option>
            </select>
          </div>
        {/if}

        {#if tempInput?.type === "texture"}
          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={tempInput.path || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to texture file"
              class="input-text"
            />
          </div>

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

        {#if tempInput?.type === "video"}
          <div class="input-group">
            <label for="path-{channelName}">Path:</label>
            <input
              id="path-{channelName}"
              type="text"
              value={tempInput.path || ""}
              on:input={(e) => updatePath(e.currentTarget.value)}
              placeholder="Path to video file or URL"
              class="input-text"
            />
          </div>

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

        {#if tempInput?.type === "keyboard"}
          <div class="input-note">
            Keyboard input provides key states to the shader via the iChannel texture.
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
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
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

  .modal-preview {
    width: 120px;
    margin: 0 auto 16px;
  }

  .input-note {
    font-size: 14px;
    color: var(--vscode-descriptionForeground, #888);
    font-style: italic;
    padding: 12px;
    background: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.1));
    border-left: 3px solid var(--vscode-textBlockQuote-border, #888);
    border-radius: 4px;
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
