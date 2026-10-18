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
  const samplingId = $props.id();
  const input = $derived(tempInput?.type === "volume" ? tempInput : undefined);
</script>
<div class="channel-details-grid" class:has-preview={Boolean(input?.path)}>
<div class="channel-volume-settings">
<section class="channel-section" aria-label="Volume source">
<h3>Volume source</h3>
{#if postMessage}
  <AssetBrowser extensions={VOLUME_EXTENSIONS} {shaderPath} {postMessage} {onMessage} onSelect={onAssetSelect} selectedPath={input?.path || ""} />
{/if}
<PathInput value={input?.path || ""} placeholder="Path to volume .ktx2 file" fileType="volume" allowCreate={false} {shaderPath} {postMessage} {onMessage} onPathChange={onUpdatePath} />
<p class="channel-hint">KTX2 3D volumes &middot; R8 or RGBA8 &middot; uncompressed.</p>
</section>
<section class="channel-section channel-settings" aria-label="Sampling">
<h3>Sampling</h3>
<div class="input-row sampling-fields">
  <div class="input-group sampling-field">
    <label for={`${samplingId}-filter`}>Filter</label>
      <select id={`${samplingId}-filter`} class="input-select" value={input?.filter ?? "linear"} onchange={(e) => onUpdateFilter(e.currentTarget.value as "linear" | "nearest")}>
        <option value="linear">Linear (3D interpolation)</option>
        <option value="nearest">Nearest</option>
      </select>
  </div>
  <div class="input-group sampling-field">
    <label for={`${samplingId}-wrap`}>Wrap X / Y / Z</label>
      <select id={`${samplingId}-wrap`} class="input-select" value={input?.wrap ?? "repeat"} onchange={(e) => onUpdateWrap(e.currentTarget.value as "repeat" | "clamp")}>
        <option value="repeat">Repeat</option>
        <option value="clamp">Clamp</option>
      </select>
  </div>
</div>
</section>
</div>
{#if input?.path}
<section class="channel-section channel-preview-section" aria-label="Volume preview">
  <h3>Preview</h3>
  <VolumePreview path={input.resolved_path || getWebviewUri(input.path) || input.path} controls={true} />
</section>
{/if}
</div>
<style>
  .input-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: 12px; margin-top: 12px; }
  .input-group { min-width: 0; flex: 1; margin-bottom: 16px; }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
  .input-select:focus { outline: none; border-color: var(--vscode-focusBorder, #007acc); }
  .input-select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
</style>
