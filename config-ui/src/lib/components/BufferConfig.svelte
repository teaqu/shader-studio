<script lang="ts">
  import { BufferConfig } from "../BufferConfig";
  import type {
    BufferPass,
    ImagePass,
    ConfigInput,
  } from "../types/ShaderConfig";

  export let bufferName: string;
  export let config: BufferPass | ImagePass;
  export let onUpdate: (
    bufferName: string,
    config: BufferPass | ImagePass,
  ) => void;
  export let isImagePass: boolean = false;

  let bufferConfig: BufferConfig;

  $: bufferConfig = new BufferConfig(bufferName, config, onUpdate);

  // Make the path reactive to prop changes
  $: currentPath = "path" in config ? config.path : "";

  function updatePath(event: Event) {
    const target = event.target as HTMLInputElement;
    currentPath = target.value;
    bufferConfig.updatePath(target.value);
    config = bufferConfig.getConfig();
  }

  function addSpecificChannel(channel: string) {
    const newInput: ConfigInput = {
      type: "buffer",
      source: "BufferA",
    };
    bufferConfig.addInputChannel(channel, newInput);
    config = bufferConfig.getConfig();
  }

  function removeInputChannel(channel: string) {
    bufferConfig.removeInputChannel(channel);
    config = bufferConfig.getConfig();
  }

  function updateInputType(channel: string, e: Event) {
    const target = e.target as HTMLSelectElement;
    if (target && bufferConfig) {
      const newType = target.value as "buffer" | "texture" | "video" | "keyboard";

      // default values
      if (newType === "buffer") {
        bufferConfig.updateInputChannelPartial(channel, {
          type: "buffer",
          source: "BufferA",
        });
      } else if (newType === "texture") {
        bufferConfig.updateInputChannelPartial(channel, {
          type: "texture",
          path: "",
        });
      } else if (newType === "video") {
        bufferConfig.updateInputChannelPartial(channel, {
          type: "video",
          path: "",
        });
      } else {
        bufferConfig.updateInputChannelPartial(channel, {
          type: "keyboard",
        });
      }

      config = bufferConfig.getConfig();
    }
  }

  function updateInputSource(channel: string, e: Event) {
    const target = e.target as HTMLSelectElement;
    if (target && bufferConfig) {
      bufferConfig.updateInputChannelPartial(channel, {
        type: "buffer",
        source: target.value as "BufferA" | "BufferB" | "BufferC" | "BufferD",
      });
      config = bufferConfig.getConfig();
    }
  }

  function updateInputPath(channel: string, e: Event) {
    const target = e.target as HTMLInputElement;
    if (target && bufferConfig) {
      const currentInput = bufferConfig.getInputChannel(channel);
      if (currentInput && (currentInput.type === "texture" || currentInput.type === "video")) {
        bufferConfig.updateInputChannelPartial(channel, {
          ...currentInput,
          path: target.value,
        });
        config = bufferConfig.getConfig();
      }
    }
  }

  function updateTextureFilter(channel: string, e: Event) {
    const target = e.target as HTMLSelectElement;
    if (target && bufferConfig) {
      const currentInput = bufferConfig.getInputChannel(channel);
      if (currentInput && (currentInput.type === "texture" || currentInput.type === "video")) {
        bufferConfig.updateInputChannelPartial(channel, {
          ...currentInput,
          filter: target.value as "linear" | "nearest" | "mipmap" | undefined,
        });
        config = bufferConfig.getConfig();
      }
    }
  }

  function updateTextureWrap(channel: string, e: Event) {
    const target = e.target as HTMLSelectElement;
    if (target && bufferConfig) {
      const currentInput = bufferConfig.getInputChannel(channel);
      if (currentInput && (currentInput.type === "texture" || currentInput.type === "video")) {
        bufferConfig.updateInputChannelPartial(channel, {
          ...currentInput,
          wrap: target.value as "repeat" | "clamp" | undefined,
        });
        config = bufferConfig.getConfig();
      }
    }
  }

  function updateTextureVFlip(channel: string, e: Event) {
    const target = e.target as HTMLInputElement;
    if (target && bufferConfig) {
      const currentInput = bufferConfig.getInputChannel(channel);
      if (currentInput && (currentInput.type === "texture" || currentInput.type === "video")) {
        bufferConfig.updateInputChannelPartial(channel, {
          ...currentInput,
          vflip: target.checked,
        });
        config = bufferConfig.getConfig();
      }
    }
  }

  function updateTextureGrayscale(channel: string, e: Event) {
    const target = e.target as HTMLInputElement;
    if (target && bufferConfig) {
      const currentInput = bufferConfig.getInputChannel(channel);
      if (currentInput && currentInput.type === "texture") {
        bufferConfig.updateInputChannelPartial(channel, {
          ...currentInput,
          grayscale: target.checked,
        });
        config = bufferConfig.getConfig();
      }
    }
  }

  $: validation = bufferConfig?.validate() || { isValid: true, errors: [] };
</script>

<div class="buffer-config">
  <h2 class="buffer-name">{bufferName}</h2>

  <div class="buffer-details">
    {#if !isImagePass}
      <div class="config-item">
        <div class="input-group">
          <label for="path-{bufferName}">Path:</label>
          <input
            id="path-{bufferName}"
            type="text"
            value={currentPath}
            on:input={updatePath}
            class="config-input"
            class:error={!validation.isValid}
            placeholder="e.g., ./buffer.glsl, @/shaders/buffer.glsl, or C:\path\to\buffer.glsl"
          />
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
      <div class="section-header">
        <h3>Input Channels</h3>
      </div>

      <div class="channels-grid">
        {#each ["iChannel0", "iChannel1", "iChannel2", "iChannel3"] as channelName}
          {@const input =
            config.inputs?.[channelName as keyof typeof config.inputs]}
          <div class="channel-box {input ? 'configured' : 'empty'}">
            <div class="channel-header">
              <h4 class="channel-name">{channelName}</h4>
              {#if input}
                <button
                  class="remove-channel-btn"
                  on:click={() => removeInputChannel(channelName)}
                  title="Remove {channelName}"
                >
                  ×
                </button>
              {:else if bufferConfig && bufferConfig.getAvailableChannels().includes(channelName)}
                <button
                  class="add-channel-btn"
                  on:click={() => addSpecificChannel(channelName)}
                  title="Add {channelName}"
                >
                  +
                </button>
              {/if}
            </div>
            
            {#if input}
              <div class="channel-config">
                <div class="input-group">
                  <label for="type-{channelName}">Type:</label>
                  <select
                    id="type-{channelName}"
                    value={input.type}
                    on:change={(e) => updateInputType(channelName, e)}
                    class="input-select"
                  >
                    <option value="buffer">Buffer</option>
                    <option value="texture">Texture</option>
                    <option value="video">Video</option>
                    <option value="keyboard">Keyboard</option>
                  </select>
                </div>

                {#if input.type === "buffer"}
                  <div class="input-group">
                    <label for="source-{channelName}">Source:</label>
                    <select
                      id="source-{channelName}"
                      value={input.source}
                      on:change={(e) => updateInputSource(channelName, e)}
                      class="input-select"
                      required
                    >
                      <option value="">None</option>
                      <option value="BufferA">BufferA</option>
                      <option value="BufferB">BufferB</option>
                      <option value="BufferC">BufferC</option>
                      <option value="BufferD">BufferD</option>
                    </select>
                  </div>
                {/if}

                {#if input.type === "texture"}
                  <div class="input-group">
                    <label for="path-{channelName}">Path:</label>
                    <input
                      id="path-{channelName}"
                      type="text"
                      value={input.path || ""}
                      on:input={(e) => updateInputPath(channelName, e)}
                      placeholder="Path to texture file"
                      class="input-text"
                    />
                  </div>

                  <div class="input-group">
                    <label for="filter-{channelName}">Filter:</label>
                    <select
                      id="filter-{channelName}"
                      value={input.filter || "mipmap"}
                      on:change={(e) => updateTextureFilter(channelName, e)}
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
                      value={input.wrap || "repeat"}
                      on:change={(e) => updateTextureWrap(channelName, e)}
                      class="input-select"
                    >
                      <option value="repeat">Repeat</option>
                      <option value="clamp">Clamp</option>
                    </select>
                  </div>

                  <div class="input-group">
                    <label for="vflip-{channelName}">Vertical Flip:</label>
                    <input
                      id="vflip-{channelName}"
                      type="checkbox"
                      checked={input.vflip ?? true}
                      on:change={(e) => updateTextureVFlip(channelName, e)}
                      class="input-checkbox"
                    />
                  </div>

                  <div class="input-group">
                    <label for="grayscale-{channelName}">Grayscale:</label>
                    <input
                      id="grayscale-{channelName}"
                      type="checkbox"
                      checked={input.grayscale ?? false}
                      on:change={(e) => updateTextureGrayscale(channelName, e)}
                      class="input-checkbox"
                    />
                  </div>
                {/if}

                {#if input.type === "video"}
                  <div class="input-group">
                    <label for="path-{channelName}">Path:</label>
                    <input
                      id="path-{channelName}"
                      type="text"
                      value={input.path || ""}
                      on:input={(e) => updateInputPath(channelName, e)}
                      placeholder="Path to video file or URL"
                      class="input-text"
                    />
                  </div>

                  <div class="input-group">
                    <label for="filter-{channelName}">Filter:</label>
                    <select
                      id="filter-{channelName}"
                      value={input.filter || "linear"}
                      on:change={(e) => updateTextureFilter(channelName, e)}
                      class="input-select"
                    >
                      <option value="linear">Linear</option>
                      <option value="nearest">Nearest</option>
                      <option value="mipmap">Mipmap</option>
                    </select>
                  </div>

                  <div class="input-group">
                    <label for="wrap-{channelName}">Wrap:</label>
                    <select
                      id="wrap-{channelName}"
                      value={input.wrap || "clamp"}
                      on:change={(e) => updateTextureWrap(channelName, e)}
                      class="input-select"
                    >
                      <option value="clamp">Clamp</option>
                      <option value="repeat">Repeat</option>
                    </select>
                  </div>

                  <div class="input-group">
                    <label for="vflip-{channelName}">Vertical Flip:</label>
                    <input
                      id="vflip-{channelName}"
                      type="checkbox"
                      checked={input.vflip ?? true}
                      on:change={(e) => updateTextureVFlip(channelName, e)}
                      class="input-checkbox"
                    />
                  </div>
                {/if}

                {#if input.type === "keyboard"}
                  <div class="input-note">
                    Keyboard input configured
                  </div>
                {/if}
              </div>
            {:else}
              <div class="empty-channel">
                <p>Not configured</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
    {/if}
  </div>
</div>

<style>
  .buffer-name {
    margin-top: 0;
  }
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

  .input-note {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #666);
    font-style: italic;
  }

  .input-text,
  .input-select {
    padding: 8px 12px;
    border: 1px solid var(--vscode-input-border, #ccc);
    border-radius: 4px;
    background: var(--vscode-input-background, #fff);
    color: var(--vscode-input-foreground, #333);
    font-size: 14px;
    width: 100%;
  }

  .input-text:focus,
  .input-select:focus {
    outline: none;
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .input-checkbox {
    margin-right: 8px;
  }

  .channels-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-top: 16px;
  }

  .channel-box {
    background: var(--vscode-editor-background, #ffffff);
    border: 1px solid var(--vscode-panel-border, #e0e0e0);
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    transition: all 0.2s ease;
    min-height: 200px;
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
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  }

  .channel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--vscode-tab-inactiveBackground, #f8f8f8);
    border-bottom: 1px solid var(--vscode-panel-border, #e0e0e0);
  }

  .channel-name {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--vscode-tab-activeForeground, #333);
  }

  .add-channel-btn,
  .remove-channel-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.2s ease;
  }

  .add-channel-btn {
    color: var(--vscode-button-foreground, #007acc);
    opacity: 0.7;
  }

  .add-channel-btn:hover {
    opacity: 1;
    background: var(--vscode-button-secondaryHoverBackground, rgba(0, 122, 204, 0.1));
  }

  .remove-channel-btn {
    color: var(--vscode-errorForeground, #f44336);
    opacity: 0.7;
  }

  .remove-channel-btn:hover {
    opacity: 1;
    background: var(--vscode-errorForeground, #f44336);
    color: white;
  }

  .channel-config {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .empty-channel {
    padding: 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground, #666);
  }

  .empty-channel p {
    margin: 0;
    font-style: italic;
  }

</style>
