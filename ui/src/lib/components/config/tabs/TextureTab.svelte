<script lang="ts">
  import type { MessageEvent as ShaderMessage } from "@shader-studio/types";
  import type { ConfigInput } from "@shader-studio/types";
  import AssetBrowser from "../AssetBrowser.svelte";
  import PathInput from "../PathInput.svelte";
  import { TEXTURE_EXTENSIONS } from "@shader-studio/types";

  export let tempInput: ConfigInput | undefined;
  export let channelName: string;
  export let shaderPath: string;
  export let postMessage: ((msg: ShaderMessage) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;
  export let onAssetSelect: (path: string, resolvedUri?: string) => void;
  export let onUpdatePath: (path: string) => void;
  export let onUpdateFilter: (filter: "linear" | "nearest" | "mipmap") => void;
  export let onUpdateWrap: (wrap: "repeat" | "clamp") => void;
  export let onUpdateVFlip: (vflip: boolean) => void;
  export let onUpdateGrayscale: (grayscale: boolean) => void;
</script>

<section class="channel-section" aria-label="Texture source">
<h3>Texture source</h3>
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

<PathInput
  value={(tempInput?.type === "texture" && tempInput.path) || ""}
  placeholder="Path to texture file"
  fileType="texture"
  allowCreate={false}
  {shaderPath}
  {postMessage}
  {onMessage}
  onPathChange={onUpdatePath}
/>
</section>

{#if tempInput?.type === "texture"}
<section class="channel-section channel-settings" aria-label="Sampling">
<h3>Sampling</h3>
  <div class="input-row sampling-fields">
    <div class="input-group sampling-field">
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

    <div class="input-group sampling-field">
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

  <div class="input-row sampling-options">
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
</section>
{/if}

<style>
  .input-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
    gap: 12px;
    margin-top: 12px;
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
    font-size: var(--shader-studio-label-size);
    font-weight: 500;
    color: var(--vscode-foreground, #cccccc);
  }

  .input-select {
    min-width: 0;
    width: 100%;
    padding: var(--shader-studio-control-padding);
    border: 1px solid var(--vscode-dropdown-border, #3c3c3c);
    border-radius: var(--shader-studio-control-radius);
    background: var(--vscode-dropdown-background, #2d2d2d);
    color: var(--vscode-dropdown-foreground, #cccccc);
    font-size: var(--shader-studio-font-size);
    min-height: var(--shader-studio-control-height);
  }

  .input-select:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .input-select:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
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
