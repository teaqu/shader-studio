<script lang="ts">
  import type { ConfigInput } from "@shader-studio/types";
  import type { AudioVideoController } from "../../../AudioVideoController";
  import { isVSCodeEnvironment } from "../../../transport/TransportFactory";
  import { tooltip } from "../../../actions/tooltip";
  import ChannelPreview from "../ChannelPreview.svelte";
  import ScreenControls from "../ScreenControls.svelte";

  interface Props {
    tempInput?: ConfigInput;
    audioVideoController?: AudioVideoController;
    getWebviewUri: (path: string) => string | undefined;
    onSelect: (input: ConfigInput) => void;
    availableBufferNames?: string[];
  }

  const MIN_BUFFERS = ["BufferA", "BufferB", "BufferC", "BufferD"];

  let {
    tempInput = undefined as ConfigInput | undefined,
    getWebviewUri,
    audioVideoController,
    onSelect,
    availableBufferNames = [],
  }: Props = $props();
  const captureUnavailable = isVSCodeEnvironment();
  function selectCapture(type: 'webcam' | 'screen') {
    if (!captureUnavailable) {
      onSelect({ type });
    }
  }

  const bufferList = $derived.by(() => {
    const all = new Set([...MIN_BUFFERS, ...availableBufferNames]);
    return [...all].sort();
  });

  function selectBuffer(source: string) {
    onSelect(tempInput?.type === "buffer"
      ? { ...tempInput, source }
      : { type: "buffer", source });
  }

  function updateBufferFilter(event: Event) {
    if (tempInput?.type !== "buffer") {
      return;
    }
    const filter = (event.currentTarget as HTMLSelectElement).value as "linear" | "nearest";
    onSelect({ ...tempInput, filter });
  }

  function updateBufferWrap(event: Event) {
    if (tempInput?.type !== "buffer") {
      return;
    }
    const wrap = (event.currentTarget as HTMLSelectElement).value as "repeat" | "clamp";
    onSelect({ ...tempInput, wrap });
  }

  function updateScreenFilter(event: Event) {
    if (tempInput?.type !== "screen") {
return;
}
    onSelect({ ...tempInput, filter: (event.currentTarget as HTMLSelectElement).value as "linear" | "nearest" | "mipmap" });
  }

  function updateScreenWrap(event: Event) {
    if (tempInput?.type !== "screen") {
return;
}
    onSelect({ ...tempInput, wrap: (event.currentTarget as HTMLSelectElement).value as "repeat" | "clamp" });
  }

  function updateScreenVFlip(event: Event) {
    if (tempInput?.type !== "screen") {
return;
}
    onSelect({ ...tempInput, vflip: (event.currentTarget as HTMLInputElement).checked });
  }
</script>

<div class="misc-grid">
  <div class="misc-section-label">Buffer</div>
  <div class="misc-options">
    {#each bufferList as buf}
      <button
        class="misc-card"
        class:selected={tempInput?.type === "buffer" && tempInput.source === buf}
        onclick={() => selectBuffer(buf)}
      >
        <ChannelPreview channelInput={{ type: "buffer", source: buf }} {getWebviewUri} />
        <div class="misc-card-label">{buf}</div>
      </button>
    {/each}
  </div>

  {#if tempInput?.type === "buffer"}
    <div class="buffer-sampling">
      <label for="buffer-filter">Filter:</label>
      <select id="buffer-filter" value={tempInput.filter ?? "linear"} onchange={updateBufferFilter}>
        <option value="linear">Linear</option>
        <option value="nearest">Nearest</option>
      </select>
      <label for="buffer-wrap">Wrap:</label>
      <select id="buffer-wrap" value={tempInput.wrap ?? "clamp"} onchange={updateBufferWrap}>
        <option value="clamp">Clamp</option>
        <option value="repeat">Repeat</option>
      </select>
    </div>
  {/if}

  <div class="misc-section-label">Other</div>
  <div class="misc-options">
    <button
      class="misc-card"
      class:selected={tempInput?.type === "keyboard"}
      onclick={() => onSelect({ type: "keyboard" })}
    >
      <ChannelPreview channelInput={{ type: "keyboard" }} {getWebviewUri} />
      <div class="misc-card-label">Keyboard</div>
    </button>
    <button class="misc-card" class:selected={tempInput?.type === "webcam"} aria-label="Webcam"
      aria-disabled={captureUnavailable}
      use:tooltip={captureUnavailable ? 'Webcam is unavailable in VS Code. Open Shader Studio in a browser to use this input.' : ''}
      onclick={() => selectCapture('webcam')}>
      <ChannelPreview channelInput={{ type: "webcam" }} {getWebviewUri} {audioVideoController} />
      <div class="misc-card-label">Webcam</div>
    </button>
    <button class="misc-card" class:selected={tempInput?.type === "screen"} aria-label="Screen"
      aria-disabled={captureUnavailable}
      use:tooltip={captureUnavailable ? 'Screen is unavailable in VS Code. Open Shader Studio in a browser to use this input.' : ''}
      onclick={() => selectCapture('screen')}>
      <ChannelPreview channelInput={{ type: "screen" }} {getWebviewUri} {audioVideoController} />
      <div class="misc-card-label">Screen</div>
    </button>
  </div>
  {#if !captureUnavailable && tempInput?.type === "webcam"}
    <p>Uses your default device. Allow access when prompted. If this host blocks capture,
      open Shader Studio in a browser on localhost or HTTPS. </p>
  {/if}
  {#if !captureUnavailable && tempInput?.type === "screen"}
    <ScreenControls {audioVideoController} />
    <div class="screen-sampling">
      <label for="screen-filter">Filter:</label>
      <select id="screen-filter" value={tempInput.filter ?? "linear"} onchange={updateScreenFilter}>
        <option value="linear">Linear</option>
        <option value="nearest">Nearest</option>
        <option value="mipmap">Mipmap</option>
      </select>
      <label for="screen-wrap">Wrap:</label>
      <select id="screen-wrap" value={tempInput.wrap ?? "clamp"} onchange={updateScreenWrap}>
        <option value="clamp">Clamp</option>
        <option value="repeat">Repeat</option>
      </select>
      <label for="screen-vflip"><input id="screen-vflip" type="checkbox" checked={tempInput.vflip ?? true} onchange={updateScreenVFlip} /> Flip vertically</label>
    </div>
  {/if}
</div>

<style>
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
    grid-template-columns: repeat(auto-fill, minmax(72px, 96px));
    gap: 8px;
    margin-bottom: 8px;
  }

  .buffer-sampling {
    display: grid;
    grid-template-columns: auto minmax(100px, 1fr);
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .screen-sampling {
    display: grid;
    grid-template-columns: auto minmax(100px, 1fr);
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .screen-sampling select,
  .buffer-sampling select {
    padding: 8px 12px;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 4px;
    background: var(--vscode-input-background, #2d2d2d);
    color: var(--vscode-input-foreground, #cccccc);
    font-size: 14px;
  }

  .screen-sampling select:focus,
  .buffer-sampling select:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .screen-sampling label:last-child { grid-column: 1 / -1; }

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

  .misc-card[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }

  .misc-card:not([aria-disabled="true"]):hover {
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
</style>
