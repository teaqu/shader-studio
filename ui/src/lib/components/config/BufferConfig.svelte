<svelte:options runes={true} />

<script lang="ts">
  import { BufferConfig as BufferConfigModel } from "../../BufferConfig";
  import type {
    BufferPass,
    ImagePass,
    ConfigInput,
    ResolutionSettings,
    BufferResolution,
    AspectRatioMode,
  } from "@shader-studio/types";
  import ChannelPreview from "./ChannelPreview.svelte";
  import ChannelConfigModal from "./ChannelConfigModal.svelte";
  import PathInput from "./PathInput.svelte";
  import type { AudioVideoController } from "../../AudioVideoController";

  type EditableConfig = BufferPass | ImagePass;

  type BufferConfigProps = {
    bufferName: string;
    config: EditableConfig;
    onUpdate: (bufferName: string, config: EditableConfig) => void;
    getWebviewUri: (path: string) => string | undefined;
    isImagePass?: boolean;
    suggestedPath?: string;
    postMessage?: (msg: any) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
    shaderPath?: string;
    audioVideoController?: AudioVideoController;
    globalMuted?: boolean;
  };

  let {
    bufferName,
    config,
    onUpdate,
    getWebviewUri,
    isImagePass = false,
    suggestedPath = "",
    postMessage = undefined,
    onMessage = undefined,
    shaderPath = "",
    audioVideoController = undefined,
    globalMuted = false,
  }: BufferConfigProps = $props();

  const IMAGE_SCALES = [0.25, 0.5, 1, 2, 4] as const;
  const BUFFER_SCALES = [0.25, 0.5, 1, 2, 4] as const;
  const ASPECT_MODES: AspectRatioMode[] = ['16:9', '4:3', '1:1', 'fill', 'auto'];

  const imageConfig = $derived(isImagePass ? (config as ImagePass) : undefined);
  const bufferPassConfig = $derived(!isImagePass ? (config as BufferPass) : undefined);
  const configModel = $derived(new BufferConfigModel(bufferName, config, onUpdate));
  const fileType = $derived(bufferName === 'common' ? 'glsl-common' as const : 'glsl-buffer' as const);
  const validation = $derived(configModel.validate() || { isValid: true, errors: [] });
  const configuredInputs = $derived(config.inputs || {});
  const imageResolution = $derived(imageConfig?.resolution);
  const imageScale = $derived(imageResolution?.scale ?? 1);
  const imageAspect = $derived(imageResolution?.aspectRatio ?? 'fill');
  const imageHasCustom = $derived(imageResolution?.customWidth !== undefined);
  const bufferResolution = $derived(bufferPassConfig?.resolution);
  const bufferMode = $derived.by(() => {
    if (!bufferResolution) {
      return 'none' as const;
    }
    if (bufferResolution.width !== undefined || bufferResolution.height !== undefined) {
      return 'fixed' as const;
    }
    if (bufferResolution.scale !== undefined) {
      return 'scale' as const;
    }
    return 'none' as const;
  });
  const channelNames = $derived.by(() => {
    const configKeys = Object.keys(configuredInputs);
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
  });

  let currentPath = $state("path" in config ? config.path : "");
  let activeModalChannel = $state<string | null>(null);
  let tempChannelInput = $state<ConfigInput | undefined>(undefined);
  let customWidthInput = $state<number | null>(null);
  let customHeightInput = $state<number | null>(null);
  let bufferWidthInput = $state('');
  let bufferHeightInput = $state('');

  $effect(() => {
    currentPath = "path" in config ? config.path : "";
  });

  $effect(() => {
    const res = imageResolution;
    customWidthInput = res?.customWidth !== undefined ? (Number(res.customWidth) || null) : null;
    customHeightInput = res?.customHeight !== undefined ? (Number(res.customHeight) || null) : null;
  });

  $effect(() => {
    const res = bufferResolution;
    bufferWidthInput = res?.width !== undefined ? String(res.width) : '';
    bufferHeightInput = res?.height !== undefined ? String(res.height) : '';
  });

  function updateConfig(nextConfig: EditableConfig) {
    config = nextConfig;
    onUpdate(bufferName, config);
  }

  function updateImageResolution(patch: Partial<ResolutionSettings>) {
    const current = imageConfig?.resolution ?? {};
    const next: ResolutionSettings = { ...current, ...patch };
    updateConfig({ ...imageConfig, resolution: next });
  }

  function updateBufferResolution(resolution: BufferResolution | undefined) {
    updateConfig({ ...bufferPassConfig, resolution });
  }

  function handlePathChange(path: string) {
    currentPath = path;
    configModel.updatePath(path);
    config = configModel.getConfig();
  }

  function openChannelModal(channelName: string) {
    activeModalChannel = channelName;
    const currentInput = configModel.getInputChannel(channelName);
    tempChannelInput = currentInput ? { ...currentInput } : undefined;
  }

  function closeChannelModal() {
    activeModalChannel = null;
    tempChannelInput = undefined;
  }

  function handleModalSave(channelName: string, input: ConfigInput) {
    if (input) {
      configModel.updateInputChannel(channelName, input);
    }
    config = configModel.getConfig();
  }

  function handleModalRemove(channelName: string) {
    configModel.removeInputChannel(channelName);
    config = configModel.getConfig();
    closeChannelModal();
  }

  function handleModalRename(oldName: string, newName: string) {
    configModel.renameInputChannel(oldName, newName);
    config = configModel.getConfig();
    activeModalChannel = newName;
  }

  function handleAddChannel() {
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
    if (Object.keys(configuredInputs).length === 0) {
      return;
    }

    const sorted: Record<string, ConfigInput> = {};
    Object.keys(configuredInputs)
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) => {
        sorted[key] = configuredInputs[key]!;
      });

    updateConfig({ ...config, inputs: sorted });
  }

  function handleImageScale(scale: number) {
    updateImageResolution({ scale });
  }

  function handleImageAspect(mode: AspectRatioMode) {
    if (imageHasCustom) {
      return;
    }
    updateImageResolution({ aspectRatio: mode });
  }

  function handleCustomResolution() {
    if (customWidthInput && customHeightInput) {
      updateImageResolution({
        customWidth: String(customWidthInput),
        customHeight: String(customHeightInput),
      });
    } else if (!customWidthInput && !customHeightInput) {
      updateImageResolution({ customWidth: undefined, customHeight: undefined });
    }
  }

  function handleClearCustomResolution() {
    customWidthInput = null;
    customHeightInput = null;
    updateImageResolution({ customWidth: undefined, customHeight: undefined });
  }

  function handleImageResetResolution() {
    const { resolution: _resolution, ...rest } = imageConfig ?? {};
    config = rest as ImagePass;
    customWidthInput = null;
    customHeightInput = null;
    onUpdate(bufferName, config);
  }

  function setBufferMode(mode: 'none' | 'fixed' | 'scale') {
    if (mode === 'none') {
      updateBufferResolution(undefined);
      return;
    }

    if (mode === 'fixed') {
      updateBufferResolution({ width: 512, height: 512 });
      bufferWidthInput = '512';
      bufferHeightInput = '512';
      return;
    }

    updateBufferResolution({ scale: 1 });
  }

  function handleBufferFixed() {
    const width = parseInt(bufferWidthInput, 10);
    const height = parseInt(bufferHeightInput, 10);
    if (!isNaN(width) && width > 0 && !isNaN(height) && height > 0) {
      updateBufferResolution({ width, height });
    }
  }

  function handleBufferScale(scale: number) {
    updateBufferResolution({ scale });
  }

  function handleBufferResetResolution() {
    updateBufferResolution(undefined);
  }
</script>

<div class="buffer-config">
  <div class="buffer-details">
    {#if !isImagePass}
      <div class="config-item">
        <PathInput
          value={currentPath}
          onPathChange={handlePathChange}
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
        {#if !isImagePass}<h3 class="section-title">Channels</h3>{/if}
        {#if Object.keys(configuredInputs).length > 1}
          <div class="channels-toolbar">
            <button
              class="sort-btn"
              onclick={handleSortChannels}
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
              onclick={() => openChannelModal(channelName)}
              onkeydown={(e) => e.key === 'Enter' && openChannelModal(channelName)}
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
              onclick={handleAddChannel}
              onkeydown={(e) => e.key === 'Enter' && handleAddChannel()}
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

    {#if isImagePass}
      <div class="config-item resolution-section">
        <h3 class="section-title">Resolution</h3>
        <div class="resolution-row">
          <span class="resolution-label">Scale</span>
          <div class="preset-buttons">
            {#each IMAGE_SCALES as s}
              <button
                class="preset-btn {imageScale === s ? 'active' : ''}"
                onclick={() => handleImageScale(s)}
              >{s}x</button>
            {/each}
          </div>
          <button class="reset-btn" onclick={handleImageResetResolution}>Reset</button>
        </div>
        <div class="resolution-row">
          <span class="resolution-label">Aspect</span>
          <div class="preset-buttons">
            {#each ASPECT_MODES as mode}
              <button
                class="preset-btn {imageAspect === mode ? 'active' : ''}"
                disabled={imageHasCustom}
                onclick={() => handleImageAspect(mode)}
              >{mode}</button>
            {/each}
          </div>
        </div>
        <div class="resolution-row">
          <span class="resolution-label">Custom</span>
          <div class="custom-inputs">
            <input
              class="dim-input"
              type="number"
              placeholder="W"
              min="1"
              step="1"
              bind:value={customWidthInput}
              oninput={handleCustomResolution}
            />
            <span class="dim-sep">×</span>
            <input
              class="dim-input"
              type="number"
              placeholder="H"
              min="1"
              step="1"
              bind:value={customHeightInput}
              oninput={handleCustomResolution}
            />
            {#if imageHasCustom}
              <button class="preset-btn clear-custom-btn" onclick={handleClearCustomResolution}>Clear</button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if !isImagePass && bufferName !== "common"}
      <div class="config-item resolution-section">
        <h3 class="section-title">Resolution</h3>
        <div class="resolution-row">
          <span class="resolution-label">Resolution</span>
          <div class="preset-buttons">
            <button class="preset-btn {bufferMode === 'none' ? 'active' : ''}" onclick={() => setBufferMode('none')}>Inherit</button>
            <button class="preset-btn {bufferMode === 'fixed' ? 'active' : ''}" onclick={() => setBufferMode('fixed')}>Fixed px</button>
            <button class="preset-btn {bufferMode === 'scale' ? 'active' : ''}" onclick={() => setBufferMode('scale')}>Scale</button>
          </div>
          <button class="reset-btn" onclick={handleBufferResetResolution}>Reset</button>
        </div>
        {#if bufferMode === 'fixed'}
          <div class="resolution-row">
            <span class="resolution-label">Size</span>
            <div class="custom-inputs">
              <input
                class="dim-input"
                type="number"
                placeholder="Width"
                bind:value={bufferWidthInput}
                onchange={handleBufferFixed}
              />
              <span class="dim-sep">×</span>
              <input
                class="dim-input"
                type="number"
                placeholder="Height"
                bind:value={bufferHeightInput}
                onchange={handleBufferFixed}
              />
            </div>
          </div>
        {:else if bufferMode === 'scale'}
          <div class="resolution-row">
            <span class="resolution-label">Scale</span>
            <div class="preset-buttons">
              {#each BUFFER_SCALES as s}
                <button
                  class="preset-btn {bufferResolution?.scale === s ? 'active' : ''}"
                  onclick={() => handleBufferScale(s)}
                >{s}x</button>
              {/each}
            </div>
          </div>
        {/if}
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
  existingChannelNames={Object.keys(configuredInputs)}
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

  .section-title {
    margin: 0 0 8px 0;
    padding-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground, #cccccc);
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
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

  .resolution-section {
    gap: 8px;
  }

  .resolution-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .resolution-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    min-width: 48px;
    flex-shrink: 0;
  }

  .preset-buttons {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .preset-btn {
    padding: 3px 8px;
    font-size: 11px;
    background: none;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    transition: all 0.15s;
  }

  .preset-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  .preset-btn:hover:not(:disabled) {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .preset-btn.active {
    background: var(--vscode-focusBorder, #007acc);
    border-color: var(--vscode-focusBorder, #007acc);
    color: #fff;
  }

  .custom-inputs {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dim-input {
    width: 80px;
    padding: 3px 6px;
    font-size: 11px;
    background: var(--vscode-input-background, #3c3c3c);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-input-foreground, #cccccc);
    outline: none;
  }

  .dim-input:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }

  .dim-sep {
    font-size: 12px;
    color: var(--vscode-descriptionForeground, #888);
  }

  .reset-btn {
    margin-left: auto;
    padding: 3px 8px;
    font-size: 11px;
    background: none;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .reset-btn:hover {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
  }

</style>
