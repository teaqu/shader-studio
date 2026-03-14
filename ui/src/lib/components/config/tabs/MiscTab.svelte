<script lang="ts">
  import type { ConfigInput } from "@shader-studio/types";
  import ChannelPreview from "../ChannelPreview.svelte";

  export let tempInput: ConfigInput | undefined;
  export let getWebviewUri: (path: string) => string | undefined;
  export let onSelect: (input: ConfigInput) => void;
</script>

<div class="misc-grid">
  <div class="misc-section-label">Buffer</div>
  <div class="misc-options">
    {#each ["BufferA", "BufferB", "BufferC", "BufferD"] as buf}
      <button
        class="misc-card"
        class:selected={tempInput?.type === "buffer" && tempInput.source === buf}
        on:click={() => onSelect({ type: "buffer", source: buf })}
      >
        <ChannelPreview channelInput={{ type: "buffer", source: buf }} {getWebviewUri} />
        <div class="misc-card-label">{buf}</div>
      </button>
    {/each}
  </div>

  <div class="misc-section-label">Other</div>
  <div class="misc-options">
    <button
      class="misc-card"
      class:selected={tempInput?.type === "keyboard"}
      on:click={() => onSelect({ type: "keyboard" })}
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
    grid-template-columns: repeat(4, 1fr);
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
