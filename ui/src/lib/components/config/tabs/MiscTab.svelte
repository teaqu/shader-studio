<script lang="ts">
  import type { ConfigInput } from "@shader-studio/types";
  import ChannelPreview from "../ChannelPreview.svelte";

  interface Props {
    tempInput?: ConfigInput;
    getWebviewUri: (path: string) => string | undefined;
    onSelect: (input: ConfigInput) => void;
    availableBufferNames?: string[];
    renderOutputCounts?: Record<string, number>;
    computeOutputLayerCounts?: Record<string, number>;
  }

  const MIN_BUFFERS = ["BufferA", "BufferB", "BufferC", "BufferD"];

  let {
    tempInput = undefined as ConfigInput | undefined,
    getWebviewUri,
    onSelect,
    availableBufferNames = [],
    renderOutputCounts = {},
    computeOutputLayerCounts = {},
  }: Props = $props();

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

  const selectedRenderOutputCount = $derived(
    tempInput?.type === "buffer" ? (renderOutputCounts[tempInput.source] ?? 1) : 1,
  );
  const selectedIsCompute = $derived(
    tempInput?.type === "buffer" && computeOutputLayerCounts[tempInput.source] !== undefined,
  );
  const selectedComputeLayerCount = $derived(
    tempInput?.type === "buffer" ? (computeOutputLayerCounts[tempInput.source] ?? 1) : 1,
  );

  function updateBufferOutput(event: Event) {
    if (tempInput?.type !== "buffer") {
return;
}
    const output = Number((event.currentTarget as HTMLSelectElement).value);
    onSelect({ ...tempInput, ...(output === 0 ? { output: undefined } : { output }) });
  }

  function updateBufferLayer(event: Event) {
    if (tempInput?.type !== "buffer") {
return;
}
    const layer = Number((event.currentTarget as HTMLSelectElement).value);
    onSelect({ ...tempInput, ...(layer === 0 ? { layer: undefined } : { layer }) });
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
      {#if !selectedIsCompute && selectedRenderOutputCount > 1}
        <label for="buffer-output">Output:</label>
        <select id="buffer-output" aria-label="Buffer output" value={tempInput.output ?? 0} onchange={updateBufferOutput}>
          {#each Array(selectedRenderOutputCount) as _, output}
            <option value={output}>Output {output}</option>
          {/each}
        </select>
      {/if}
      {#if selectedIsCompute && selectedComputeLayerCount > 1}
        <label for="buffer-layer">Layer:</label>
        <select id="buffer-layer" aria-label="Compute output layer" value={tempInput.layer ?? 0} onchange={updateBufferLayer}>
          {#each Array(selectedComputeLayerCount) as _, layer}
            <option value={layer}>Layer {layer}</option>
          {/each}
        </select>
      {/if}
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
  </div>
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
</style>
