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
      const newType = target.value as "buffer" | "texture" | "keyboard";

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
      if (currentInput && currentInput.type === "texture") {
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
      if (currentInput && currentInput.type === "texture") {
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
      if (currentInput && currentInput.type === "texture") {
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
      if (currentInput && currentInput.type === "texture") {
        bufferConfig.updateInputChannelPartial(channel, {
          ...currentInput,
          vflip: target.checked,
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

    <div class="config-item">
      <div class="section-header">
        <h3>Input Channels</h3>
        {#if bufferConfig && bufferConfig.getAvailableChannels().length > 0}
          <div class="add-channel-dropdown">
            <button class="action-btn"> + Add Channel </button>
            <div class="dropdown-content">
              {#each bufferConfig.getAvailableChannels() as channel}
                <button
                  class="dropdown-item"
                  on:click={() => addSpecificChannel(channel)}
                >
                  {channel}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <p class="item-count">
        {bufferConfig?.getInputChannelCount() || 0} channels configured
      </p>

      <div class="item-list">
        {#each ["iChannel0", "iChannel1", "iChannel2", "iChannel3"] as channelName}
          {@const input =
            config.inputs?.[channelName as keyof typeof config.inputs]}
          {#if input}
            <div class="item-card">
              <div class="item-header">
                <span class="item-name">{channelName}</span>
                <button
                  class="remove-btn"
                  on:click={() => removeInputChannel(channelName)}
                  title="Remove {channelName}"
                >
                  ×
                </button>
              </div>

              <div class="item-config">
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
                      value={input.path}
                      on:input={(e) => updateInputPath(channelName, e)}
                      class="input-text"
                      placeholder="e.g., ./texture.png, @/assets/tex.png, or C:\path\to\tex.png"
                      required
                    />
                    <span class="input-note">Relative, absolute, or @/ for workspace root</span>
                  </div>

                  <div class="input-group">
                    <label for="filter-{channelName}">Filter:</label>
                    <select
                      id="filter-{channelName}"
                      value={input.filter || "mipmap"}
                      on:change={(e) => updateTextureFilter(channelName, e)}
                      class="input-select"
                    >
                      <option value="mipmap">Mipmap (default)</option>
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
                      <option value="repeat">Repeat (default)</option>
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
                    <span class="checkbox-label"
                      >Flip texture vertically (default: checked)</span
                    >
                  </div>
                {/if}

                {#if input.type === "keyboard"}
                  <div class="input-group">
                    <span class="input-note"
                      >Keyboard input (no additional configuration needed)</span
                    >
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/each}

        {#if (bufferConfig?.getInputChannelCount() || 0) === 0}
          <div class="empty-state">
            <p>No input channels configured</p>
            <p class="hint">
              Add channels to connect this buffer to other buffers or textures
            </p>
          </div>
        {/if}
      </div>
    </div>
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

  .add-channel-dropdown {
    position: relative;
    display: inline-block;
  }

  .add-channel-dropdown:hover .dropdown-content {
    display: block;
  }

  .dropdown-content {
    display: none;
    position: absolute;
    right: 0;
    top: 100%;
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    min-width: 120px;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--vscode-dropdown-foreground);
    font-size: 13px;
  }

  .dropdown-item:hover {
    background: var(--vscode-list-hoverBackground);
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

  .checkbox-label {
    font-size: 14px;
    color: var(--vscode-input-foreground, #333);
  }
</style>
