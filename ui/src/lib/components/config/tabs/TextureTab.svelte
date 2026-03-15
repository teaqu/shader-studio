<script lang="ts">
  import type { ConfigInput } from "@shader-studio/types";
  import AssetBrowser from "../AssetBrowser.svelte";
  import { TEXTURE_EXTENSIONS } from "../../../constants/assetExtensions";

  export let tempInput: ConfigInput | undefined;
  export let channelName: string;
  export let shaderPath: string;
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;
  export let onAssetSelect: (path: string, resolvedUri?: string) => void;
  export let onUpdatePath: (path: string) => void;
  export let onUpdateFilter: (filter: "linear" | "nearest" | "mipmap") => void;
  export let onUpdateWrap: (wrap: "repeat" | "clamp") => void;
  export let onUpdateVFlip: (vflip: boolean) => void;
  export let onUpdateGrayscale: (grayscale: boolean) => void;
</script>

{#if postMessage}
  <AssetBrowser
    extensions={TEXTURE_EXTENSIONS}
    {shaderPath}
    {postMessage}
    {onMessage}
    onSelect={onAssetSelect}
    selectedPath={(tempInput?.type === "texture" && tempInput.path) || ""}
  />
{/if}

<div class="input-group">
  <label for="path-{channelName}">Path:</label>
  <input
    id="path-{channelName}"
    type="text"
    value={(tempInput?.type === "texture" && tempInput.path) || ""}
    on:input={(e) => onUpdatePath(e.currentTarget.value)}
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
        on:change={(e) => onUpdateFilter(e.currentTarget.value as "linear" | "nearest" | "mipmap")}
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
        on:change={(e) => onUpdateWrap(e.currentTarget.value as "repeat" | "clamp")}
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
          on:change={(e) => onUpdateVFlip(e.currentTarget.checked)}
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
          on:change={(e) => onUpdateGrayscale(e.currentTarget.checked)}
          class="input-checkbox"
        />
        Grayscale
      </label>
    </div>
  </div>
{/if}

<style>
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
</style>
