<script lang="ts">
  import { BufferConfig } from "../../BufferConfig";
  import type {
    BufferPass,
    ImagePass,
    ConfigInput,
  } from "@shader-studio/types";
  import ChannelPreview from "./ChannelPreview.svelte";
  import ChannelConfigModal from "./ChannelConfigModal.svelte";
  import PathInput from "./PathInput.svelte";

  export let bufferName: string;
  export let config: BufferPass | ImagePass;
  export let onUpdate: (
    bufferName: string,
    config: BufferPass | ImagePass,
  ) => void;
  export let getWebviewUri: (path: string) => string | undefined;
  export let isImagePass: boolean = false;
  export let suggestedPath: string = "";
  export let postMessage: ((msg: any) => void) | undefined = undefined;
  export let onMessage: ((handler: (event: MessageEvent) => void) => void) | undefined = undefined;
  import type { AudioVideoController } from "../../AudioVideoController";
  export let shaderPath: string = "";
  export let audioVideoController: AudioVideoController | undefined = undefined;
  export let globalMuted: boolean = false;

  let bufferConfig: BufferConfig;

  $: bufferConfig = new BufferConfig(bufferName, config, onUpdate);

  let currentPath = "path" in config ? config.path : "";
  $: currentPath = "path" in config ? config.path : "";

  // Modal state
  let activeModalChannel: string | null = null;
  let tempChannelInput: ConfigInput | undefined = undefined;

  function openChannelModal(channelName: string) {
    activeModalChannel = channelName;
    const currentInput = bufferConfig.getInputChannel(channelName);
    tempChannelInput = currentInput ? { ...currentInput } : undefined;
  }

  function closeChannelModal() {
    activeModalChannel = null;
    tempChannelInput = undefined;
  }

  function handleModalSave(channelName: string, input: ConfigInput) {
    if (input) {
      bufferConfig.updateInputChannel(channelName, input);
    }
    config = bufferConfig.getConfig();
  // Don't close modal - let user make multiple changes
  }

  function handleModalRemove(channelName: string) {
    bufferConfig.removeInputChannel(channelName);
    config = bufferConfig.getConfig();
    closeChannelModal(); // Close after removing
  }

  function handleAddChannel() {
    // Find next iChannel name not already shown
    const existing = new Set(channelNames);
    for (let i = 0; i < 16; i++) {
      const name = `iChannel${i}`;
      if (!existing.has(name)) {
        openChannelModal(name);
        return;
      }
    }
  }

  function handleSortChannels() {
    if (!config.inputs) {
      return;
    }
    const sorted: Record<string, ConfigInput> = {};
    Object.keys(config.inputs)
      .sort((a, b) => a.localeCompare(b))
      .forEach(key => {
        sorted[key] = config.inputs![key]!;
      });
    config = { ...config, inputs: sorted };
    onUpdate(bufferName, config);
  }

  function handleModalRename(oldName: string, newName: string) {
    bufferConfig.renameInputChannel(oldName, newName);
    config = bufferConfig.getConfig();
    activeModalChannel = newName;
  }


  // Show configured channels, pad with empty iChannel slots up to 4 total
  $: channelNames = (() => {
    const configKeys = Object.keys(config.inputs || {});
    if (configKeys.length >= 4) {
      return configKeys;
    }
    const pad: string[] = [];
    for (let i = 0; pad.length < 4 - configKeys.length && i < 16; i++) {
      const name = `iChannel${i}`;
      if (!configKeys.includes(name)) {
        pad.push(name);
      }
    }
    return [...configKeys, ...pad];
  })();

  let fileType: "glsl-common" | "glsl-buffer" = "glsl-buffer";
  $: fileType = bufferName === 'common' ? 'glsl-common' : 'glsl-buffer';
  $: validation = bufferConfig?.validate() || { isValid: true, errors: [] };
</script>

<div class="buffer-config">
  <div class="buffer-details">
    {#if !isImagePass}
      <div class="config-item">
        <PathInput
          value={currentPath}
          onPathChange={(v) => {
            currentPath = v; bufferConfig.updatePath(v); config = bufferConfig.getConfig(); 
          }}
          hasError={!validation.isValid}
          note="Relative, absolute, or @ for workspace root"
          placeholder={suggestedPath || (bufferName === 'common' ? 'e.g., ./common.glsl' : 'e.g., ./buffer.glsl')}
          {fileType}
          {shaderPath}
          {suggestedPath}
          {postMessage}
          {onMessage}
        />

        {#if !validation.isValid}
          <div class="validation-errors">
            {#each validation.errors as error}
              <p class="error-message">{error}</p>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if bufferName !== "common"}
      <div class="config-item">
        {#if Object.keys(config.inputs || {}).length > 1}
          <div class="channels-toolbar">
            <button
              class="sort-btn"
              on:click={handleSortChannels}
              title="Sort channels alphabetically"
            >
              <i class="codicon codicon-sort-precedence"></i>
              Sort A-Z
            </button>
          </div>
        {/if}
        <div class="channels-grid">
          {#each channelNames as channelName}
            {@const input =
              config.inputs?.[channelName]}
            <div
              class="channel-box {input ? 'configured' : 'empty'}"
              on:click={() => openChannelModal(channelName)}
              on:keydown={(e) => e.key === 'Enter' && openChannelModal(channelName)}
              role="button"
              tabindex="0"
            >
              <ChannelPreview channelInput={input} {getWebviewUri} {audioVideoController} {globalMuted} />

              <div class="channel-footer">
                <h4 class="channel-name">{channelName}</h4>
              </div>
            </div>
          {/each}
          {#if channelNames.length < 16}
            <div
              class="channel-box empty add-channel"
              on:click={handleAddChannel}
              on:keydown={(e) => e.key === 'Enter' && handleAddChannel()}
              role="button"
              tabindex="0"
            >
              <div class="add-channel-content">
                <span class="add-icon">+</span>
              </div>
              <div class="channel-footer">
                <h4 class="channel-name">Add Channel</h4>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<ChannelConfigModal
  isOpen={activeModalChannel !== null}
  channelName={activeModalChannel || ''}
  channelInput={tempChannelInput}
  {getWebviewUri}
  onClose={closeChannelModal}
  onSave={handleModalSave}
  onRemove={handleModalRemove}
  onRename={handleModalRename}
  existingChannelNames={Object.keys(config.inputs || {})}
  {postMessage}
  {onMessage}
  {shaderPath}
  {audioVideoController}
/>

<style>
  .buffer-config {
    padding: 0;
  }

  .buffer-details {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .config-item {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .channels-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 200px));
    gap: 16px;
  }

  .channel-box {
    background: var(--vscode-editor-background, #ffffff);
    border: 1px solid var(--vscode-panel-border, #e0e0e0);
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    transition: all 0.2s ease;
    cursor: pointer;
    display: flex;
    flex-direction: column;
  }

  .channel-box.configured {
    border-color: var(--vscode-focusBorder, #007acc);
    box-shadow: 0 2px 12px rgba(0, 123, 255, 0.15);
  }

  .channel-box.empty {
    opacity: 0.7;
    border-style: dashed;
  }

  .channel-box:hover {
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    transform: translateY(-2px);
  }

  .channel-box:focus {
    outline: 2px solid var(--vscode-focusBorder, #007acc);
    outline-offset: 2px;
  }

  .channel-footer {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 12px 16px;
    background: var(--vscode-tab-inactiveBackground, #f8f8f8);
    border-top: 1px solid var(--vscode-panel-border, #e0e0e0);
    margin-top: auto;
  }

  .channel-name {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-tab-activeForeground, #333);
  }

  .channels-toolbar {
    display: flex;
    justify-content: flex-end;
  }

  .sort-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 12px;
    background: none;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    transition: all 0.15s;
  }

  .sort-btn:hover {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .add-channel-content {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 16 / 9;
    background: var(--vscode-editor-background, #1e1e1e);
  }

  .add-icon {
    font-size: 32px;
    color: var(--vscode-descriptionForeground, #888);
    font-weight: 300;
  }

  .add-channel:hover .add-icon {
    color: var(--vscode-focusBorder, #007acc);
  }


</style>
