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

  // Initialize temp input when modal opens
  $: if (isOpen) {
    tempInput = channelInput ? { ...channelInput } : undefined;
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

  function handleSave() {
    if (tempInput) {
      onSave(channelName, tempInput);
    }
  }

  function handleRemove() {
    onRemove(channelName);
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
  }

  function updateBufferSource(source: "BufferA" | "BufferB" | "BufferC" | "BufferD") {
    if (tempInput && tempInput.type === "buffer") {
      tempInput = {
        ...tempInput,
        source,
      };
    }
  }

  function updatePath(path: string) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = {
        ...tempInput,
        path,
      };
    }
  }

  function updateFilter(filter: "linear" | "nearest" | "mipmap") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = {
        ...tempInput,
        filter,
      };
    }
  }

  function updateWrap(wrap: "repeat" | "clamp") {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = {
        ...tempInput,
        wrap,
      };
    }
  }

  function updateVFlip(vflip: boolean) {
    if (tempInput && (tempInput.type === "texture" || tempInput.type === "video")) {
      tempInput = {
        ...tempInput,
        vflip,
      };
    }
  }

  function updateGrayscale(grayscale: boolean) {
    if (tempInput && tempInput.type === "texture") {
      tempInput = {
        ...tempInput,
        grayscale,
      };
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
          <ChannelPreview channelInput={tempInput} {getWebviewUri} />
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
        <button class="btn-secondary" on:click={onClose}>
          Cancel
        </button>
        <button class="btn-primary" on:click={handleSave} disabled={!tempInput}>
          Save
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-preview {
    width: 100%;
    max-width: 400px;
    margin: 0 auto 20px;
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
  .btn-secondary,
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

  .btn-primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground, #005a9e);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--vscode-button-secondaryBackground, #3c3c3c);
    color: var(--vscode-button-secondaryForeground, white);
  }

  .btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground, #4c4c4c);
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
