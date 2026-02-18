<script lang="ts">
  import { BufferConfig } from "../../BufferConfig";
  import type {
    BufferPass,
    ImagePass,
    ConfigInput,
  } from "@shader-studio/types";
  import ChannelPreview from "./ChannelPreview.svelte";
  import ChannelConfigModal from "./ChannelConfigModal.svelte";

  export let bufferName: string;
  export let config: BufferPass | ImagePass;
  export let onUpdate: (
    bufferName: string,
    config: BufferPass | ImagePass,
  ) => void;
  export let getWebviewUri: (path: string) => string | undefined;
  export let isImagePass: boolean = false;
  export let onCreateFile: ((bufferName: string) => void) | undefined = undefined;
  export let suggestedPath: string = "";

  let bufferConfig: BufferConfig;

  $: bufferConfig = new BufferConfig(bufferName, config, onUpdate);

  // Make the path reactive to prop changes, but not while user is actively editing
  let currentPath = "path" in config ? config.path : "";
  let pathInputFocused = false;
  $: if (!pathInputFocused) {
    currentPath = "path" in config ? config.path : "";
  }

  // Modal state
  let activeModalChannel: string | null = null;
  let tempChannelInput: ConfigInput | undefined = undefined;

  function updatePath(event: Event) {
    const target = event.target as HTMLInputElement;
    currentPath = target.value;
    bufferConfig.updatePath(target.value);
    config = bufferConfig.getConfig();
  }

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


  $: validation = bufferConfig?.validate() || { isValid: true, errors: [] };
</script>

<div class="buffer-config">
  <div class="buffer-details">
    {#if !isImagePass}
      <div class="config-item">
          <div class="input-group">
            <div class="input-row">
              <label for="path-{bufferName}">Path:</label>
              <input
                id="path-{bufferName}"
                type="text"
                value={currentPath}
                on:input={updatePath}
                on:focus={() => pathInputFocused = true}
                on:blur={() => pathInputFocused = false}
                class="config-input"
                class:error={!validation.isValid}
                placeholder="e.g., ./buffer.glsl"
              />
              {#if !currentPath && onCreateFile && suggestedPath}
                <button
                  class="create-file-btn"
                  on:click={() => onCreateFile && onCreateFile(bufferName)}
                >
                  Create {suggestedPath}
                </button>
              {/if}
            </div>
            <span class="input-note">Relative, absolute, or @/ for workspace root</span>
          </div>

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
      <div class="channels-grid">
        {#each ["iChannel0", "iChannel1", "iChannel2", "iChannel3"] as channelName}
          {@const input =
            config.inputs?.[channelName as keyof typeof config.inputs]}
          <div
            class="channel-box {input ? 'configured' : 'empty'}"
            on:click={() => openChannelModal(channelName)}
            on:keydown={(e) => e.key === 'Enter' && openChannelModal(channelName)}
            role="button"
            tabindex="0"
          >
            <ChannelPreview channelInput={input} {getWebviewUri} />

            <div class="channel-footer">
              <h4 class="channel-name">{channelName}</h4>
            </div>
          </div>
        {/each}
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

  .config-input {
    padding: 8px 12px;
    border: 1px solid var(--vscode-input-border, #ccc);
    border-radius: 4px;
    background: var(--vscode-input-background, #fff);
    color: var(--vscode-input-foreground, #333);
    font-size: 14px;
  }

  .config-input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .config-input.error {
    border-color: var(--vscode-inputValidation-errorBorder, #f44336);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .input-row .config-input {
    flex: 1;
  }

  .input-note {
    display: block;
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #666);
    font-style: italic;
    margin-top: 10px;
  }

  .channels-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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

  .create-file-btn {
    padding: 4px 12px;
    font-size: 13px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }

  .create-file-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }

</style>
