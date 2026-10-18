<script lang="ts">
  import type { MessageEvent as ShaderMessage } from "@shader-studio/types";
  import type { ConfigInput } from "@shader-studio/types";
  import AssetBrowser from "../AssetBrowser.svelte";
  import PathInput from "../PathInput.svelte";
  import { CUBEMAP_EXTENSIONS } from "@shader-studio/types";

  interface Props {
    tempInput?: ConfigInput;
    channelName: string;
    shaderPath: string;
    postMessage?: (msg: ShaderMessage) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
    onAssetSelect: (path: string, resolvedUri?: string) => void;
    onUpdatePath: (path: string) => void;
    onUpdateFilter: (filter: "linear" | "nearest" | "mipmap") => void;
    onUpdateWrap: (wrap: "repeat" | "clamp") => void;
    onUpdateVFlip: (vflip: boolean) => void;
  }

  let {
    tempInput = undefined as ConfigInput | undefined,
    channelName,
    shaderPath,
    postMessage = undefined as ((msg: ShaderMessage) => void) | undefined,
    onMessage = undefined as ((handler: (event: MessageEvent) => void) => void) | undefined,
    onAssetSelect,
    onUpdatePath,
    onUpdateFilter,
    onUpdateWrap,
    onUpdateVFlip,
  }: Props = $props();
</script>

<section class="channel-section" aria-label="Cubemap source">
<h3>Cubemap source</h3>
{#if postMessage}
  <AssetBrowser
    extensions={CUBEMAP_EXTENSIONS}
    {shaderPath}
    {postMessage}
    {onMessage}
    onSelect={onAssetSelect}
    selectedPath={(tempInput?.type === "cubemap" && tempInput.path) || ""}
  />
{/if}

<PathInput
  value={(tempInput?.type === "cubemap" && tempInput.path) || ""}
  placeholder="Path to cubemap cross-pattern image"
  fileType="cubemap"
  allowCreate={false}
  {shaderPath}
  {postMessage}
  {onMessage}
  onPathChange={onUpdatePath}
/>
<p class="channel-hint">Choose an image containing the six cubemap faces in a cross layout.</p>
</section>

{#if tempInput?.type === "cubemap"}
<section class="channel-section channel-settings" aria-label="Sampling">
<h3>Sampling</h3>
  <div class="input-row sampling-fields">
    <div class="input-group sampling-field">
      <label for="filter-{channelName}">Filter:</label>
      <select
        id="filter-{channelName}"
        value={tempInput.filter || "mipmap"}
        onchange={(e) => onUpdateFilter(e.currentTarget.value as "linear" | "nearest" | "mipmap")}
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
        value={tempInput.wrap || "clamp"}
        onchange={(e) => onUpdateWrap(e.currentTarget.value as "repeat" | "clamp")}
        class="input-select"
      >
        <option value="clamp">Clamp</option>
        <option value="repeat">Repeat</option>
      </select>
    </div>
  </div>

  <div class="input-row sampling-options">
    <div class="input-group checkbox-group">
      <label for="vflip-{channelName}">
        <input
          id="vflip-{channelName}"
          type="checkbox"
          checked={tempInput.vflip ?? false}
          onchange={(e) => onUpdateVFlip(e.currentTarget.checked)}
          class="input-checkbox"
        />
        Vertical Flip
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
