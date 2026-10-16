<svelte:options runes={true} />
<script lang="ts">
  import type { ConfigInput, MessageEvent as ShaderMessage } from "@shader-studio/types";
  import { VOLUME_EXTENSIONS } from "@shader-studio/types";
  import AssetBrowser from "../AssetBrowser.svelte";
  import PathInput from "../PathInput.svelte";
  import VolumePreview from "../VolumePreview.svelte";
  interface Props {
    tempInput?: ConfigInput;
    shaderPath: string;
    postMessage?: (message: ShaderMessage) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
    getWebviewUri: (path: string) => string | undefined;
    onAssetSelect: (path: string, resolvedUri?: string) => void;
    onUpdatePath: (path: string) => void;
    onUpdateFilter: (filter: "linear" | "nearest") => void;
    onUpdateWrap: (wrap: "repeat" | "clamp") => void;
  }
  let { tempInput, shaderPath, postMessage, onMessage, getWebviewUri, onAssetSelect, onUpdatePath, onUpdateFilter, onUpdateWrap }: Props = $props();
  const input = $derived(tempInput?.type === "volume" ? tempInput : undefined);
</script>
{#if postMessage}
  <AssetBrowser extensions={VOLUME_EXTENSIONS} {shaderPath} {postMessage} {onMessage} onSelect={onAssetSelect} selectedPath={input?.path || ""} />
{/if}
<PathInput value={input?.path || ""} placeholder="Path to volume .ktx2 file" fileType="volume" allowCreate={false} {shaderPath} {postMessage} {onMessage} onPathChange={onUpdatePath} />
<div class="input-row">
  <div class="input-group">
    <label>Filter
      <select class="input-select" value={input?.filter ?? "linear"} onchange={(e) => onUpdateFilter(e.currentTarget.value as "linear" | "nearest")}>
        <option value="linear">Linear (3D interpolation)</option>
        <option value="nearest">Nearest</option>
      </select>
    </label>
  </div>
  <div class="input-group">
    <label>Wrap X / Y / Z
      <select class="input-select" value={input?.wrap ?? "repeat"} onchange={(e) => onUpdateWrap(e.currentTarget.value as "repeat" | "clamp")}>
        <option value="repeat">Repeat</option>
        <option value="clamp">Clamp</option>
      </select>
    </label>
  </div>
</div>
<p>Supported: KTX2 3D volumes · R8 or RGBA8 · uncompressed.</p>
{#if input?.path}
  <VolumePreview path={input.resolved_path || getWebviewUri(input.path) || input.path} controls={true} />
{/if}
<style>
  .input-row { display: flex; gap: 12px; }
  .input-group { flex: 1; margin-bottom: 16px; }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    font-weight: 500;
    color: var(--vscode-foreground, #cccccc);
  }
  .input-select {
    padding: 8px 12px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    font-size: 14px;
  }
  .input-select:focus { outline: none; border-color: var(--vscode-focusBorder, #007acc); }
  p { color: var(--vscode-descriptionForeground, #999999); }
</style>
