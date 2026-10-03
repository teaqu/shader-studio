<svelte:options runes={true} />

<script lang="ts">
  import { ConfigValidator } from "@shader-studio/rendering";
  import { BufferConfig as BufferConfigModel } from "../../BufferConfig";
  import type {
    BufferPass,
    ImagePass,
    ConfigInput,
    ResolutionSettings,
    BufferResolution,
    AspectRatioMode,
    FileDialogFileType,
    GeometryType,
    ComputePass,
    ShaderLanguageId,
    BufferOutputFormat,
    ShaderEntryPoint,
  } from "@shader-studio/types";
  import { SHADER_LANGUAGES, shaderLanguageForPath, vertexPassKey } from "@shader-studio/types";
  import ChannelListItem from "./ChannelListItem.svelte";
  import ChannelConfigModal from "./ChannelConfigModal.svelte";
  import ComputePassControls from "./ComputePassControls.svelte";
  import RenderEntryPointControls from "./RenderEntryPointControls.svelte";
  import PathInput from "./PathInput.svelte";
  import { getEditorOverlayVisible, setEditorOverlayVisible, setOverlayActiveFile } from "../../state/editorOverlayState.svelte";
  import { getCurrentEditorSource } from "../../state/currentEditorSourceState.svelte";
  import type { AudioVideoController } from "../../AudioVideoController";
  import { listGlbMeshNames } from "../../../../../rendering/src/preview3d/GltfMeshLoader";

  type EditableConfig = BufferPass | ImagePass | ComputePass;

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
    availableBufferNames?: string[];
    language?: ShaderLanguageId;
    passType?: 'render' | 'compute';
    storageNames?: string[];
    entryPointNames?: string[];
    renderEntryPoints?: ShaderEntryPoint[];
    maxColorAttachments?: number;
    maxColorAttachmentBytesPerSample?: number;
    renderOutputCounts?: Record<string, number>;
    computeOutputLayerCounts?: Record<string, number>;
    onComputeCommit?: (nextConfig: ComputePass) => Record<string, string>;
    onOpenInNewTab?: (name: string, mode: "active" | "beside") => void;
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
    availableBufferNames = [],
    language = 'glsl',
    passType = 'render',
    storageNames = [],
    entryPointNames = [],
    renderEntryPoints = [],
    maxColorAttachments = 8,
    maxColorAttachmentBytesPerSample = 32,
    renderOutputCounts = {},
    computeOutputLayerCounts = {},
    onComputeCommit = undefined,
    onOpenInNewTab = () => {},
  }: BufferConfigProps = $props();

  const IMAGE_SCALES = [0.25, 0.5, 1, 2, 4] as const;
  const BUFFER_SCALES = [0.25, 0.5, 1, 2, 4] as const;
  const ASPECT_MODES: AspectRatioMode[] = ['16:9', '4:3', '1:1', 'fill', 'auto'];

  const imageConfig = $derived(isImagePass ? (config as ImagePass) : undefined);
  const bufferPassConfig = $derived(!isImagePass ? (config as BufferPass) : undefined);
  const renderPassConfig = $derived(passType === 'render' ? (config as BufferPass | ImagePass) : undefined);
  const configModel = $derived(new BufferConfigModel(bufferName, config, onUpdate));
  const fileType: FileDialogFileType = $derived(
    passType === 'compute'
      ? `${language}-compute` as const
      : bufferName === 'common'
      ? `${language}-common` as const
      : `${language}-buffer` as const,
  );
  const validation = $derived(configModel.validate() || { isValid: true, errors: [] });
  const configuredInputs = $derived(config.inputs || {});
  const imageResolution = $derived(imageConfig?.resolution);
  const imageScale = $derived(imageResolution?.scale ?? 1);
  const imageAspect = $derived(imageResolution?.aspectRatio ?? 'fill');
  const imageHasCustom = $derived(imageResolution?.width !== undefined && imageResolution?.height !== undefined);
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
  const configuredChannelNames = $derived(Object.keys(configuredInputs));
  const vertexExtension = $derived(SHADER_LANGUAGES[language].extensions[0]);
  const vertexSuggestedPath = $derived(`${shaderPath.replace(/\.[^.]+$/, '')}.${bufferName.toLowerCase()}.vert.${vertexExtension}`);
  const vertexFileType = $derived(`${language}-vertex` as const);
  const hasNativeEntryPoint = $derived(
    renderPassConfig?.entryPoints?.vertex !== undefined || renderPassConfig?.entryPoints?.fragment !== undefined,
  );
  const hasNativeTemplate = $derived(renderPassConfig?.entryPoints !== undefined);
  const hasNativeVertex = $derived(renderPassConfig?.entryPoints?.vertex !== undefined);
  const hasNativeFragment = $derived(renderPassConfig?.entryPoints?.fragment !== undefined);
  // Omitted outputs means the standard one-target render pass. It remains
  // editable here without serialising an invalid empty output list.
  const renderOutputs = $derived(bufferPassConfig?.outputs?.length ? bufferPassConfig.outputs : [{}]);
  const outputFormatBytes = $derived.by(() => {
    const format = bufferPassConfig?.outputFormat ?? 'auto';
    return format === 'rgba16float' ? 8 : 16;
  });
  const effectiveOutputLimit = $derived(Math.max(1, Math.min(
    maxColorAttachments,
    Math.floor(maxColorAttachmentBytesPerSample / outputFormatBytes),
  )));
  const isWebGpuLanguage = $derived(SHADER_LANGUAGES[language].engine === 'webgpu');
  const canInsert = $derived(isWebGpuLanguage && hasNativeTemplate);
  const currentEditorSourcePath = $derived(getCurrentEditorSource(shaderPath));
  const insertionSourcePath = $derived(
    currentEditorSourcePath && shaderLanguageForPath(currentEditorSourcePath) === language
      ? currentEditorSourcePath
      : ('path' in config && config.path ? config.path : shaderPath),
  );
  let modelSelectionPending = $state(false);
  const modelGeometry = $derived(config.geometry?.type === 'model'
    ? config.geometry
    : modelSelectionPending ? { type: 'model' as const, path: '' } : undefined);
  const modelUrl = $derived(modelGeometry?.resolved_path ?? (modelGeometry ? getWebviewUri(modelGeometry.path) : undefined));

  let currentPath = $state("path" in config ? config.path : "");
  let activeModalChannel = $state<string | null>(null);
  let tempChannelInput = $state<ConfigInput | undefined>(undefined);
  let widthInput = $state<number | null>(null);
  let heightInput = $state<number | null>(null);
  let bufferWidthInput = $state('');
  let bufferHeightInput = $state('');
  let modelMeshNames = $state<string[]>([]);
  let modelMeshLoading = $state(false);
  let modelMeshError = $state<string | null>(null);

  $effect(() => {
    currentPath = "path" in config ? config.path : "";
  });

  $effect(() => {
    const path = modelGeometry?.path;
    if (!path) {
      modelMeshNames = [];
      modelMeshError = null;
      modelMeshLoading = false;
      return;
    }
    if (!modelUrl) {
      modelMeshNames = [];
      modelMeshError = null;
      modelMeshLoading = true;
      return;
    }
    let cancelled = false;
    modelMeshLoading = true;
    modelMeshError = null;
    fetch(modelUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load model (${response.status})`);
        }
        return response.arrayBuffer();
      })
      .then((data) => listGlbMeshNames(new Uint8Array(data)))
      .then((names) => {
        if (!cancelled) {
          modelMeshNames = names;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          modelMeshError = error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          modelMeshLoading = false;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const res = imageResolution;
    widthInput = res?.width !== undefined ? (Number(res.width) || null) : null;
    heightInput = res?.height !== undefined ? (Number(res.height) || null) : null;
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
    const next = { ...current, ...patch } as ResolutionSettings;
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

  /** Persist a mute toggle from the channel list row (outside the modal). */
  function handleChannelMuteUpdate(channelName: string, muted: boolean) {
    const currentInput = configuredInputs[channelName];
    if (!currentInput || (currentInput.type !== 'video' && currentInput.type !== 'audio')) {
      return;
    }
    configModel.updateInputChannel(channelName, { ...currentInput, muted });
    config = configModel.getConfig();
  }

  function handleModalRename(oldName: string, newName: string) {
    configModel.renameInputChannel(oldName, newName);
    config = configModel.getConfig();
    activeModalChannel = newName;
  }

  function handleAddChannel() {
    const existing = new Set(configuredChannelNames);
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
    if (widthInput && heightInput) {
      const { aspectRatio: _aspectRatio, ...current } = imageConfig?.resolution ?? {};
      updateConfig({
        ...imageConfig,
        resolution: {
          ...current,
          width: Math.round(widthInput),
          height: Math.round(heightInput),
        },
      });
    } else if (!widthInput && !heightInput) {
      const { width: _width, height: _height, ...resolution } = imageConfig?.resolution ?? {};
      updateConfig({ ...imageConfig, resolution });
    }
  }

  function handleClearCustomResolution() {
    widthInput = null;
    heightInput = null;
    const { width: _width, height: _height, ...resolution } = imageConfig?.resolution ?? {};
    updateConfig({ ...imageConfig, resolution });
  }

  function handleImageResetResolution() {
    const { resolution: _resolution, ...rest } = imageConfig ?? {};
    config = rest as ImagePass;
    widthInput = null;
    heightInput = null;
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

  function handleGeometryChange(type: GeometryType) {
    if (passType === 'compute') {
      return;
    }
    const renderConfig = config as BufferPass | ImagePass;
    if (type === 'fullscreen') {
      modelSelectionPending = false;
      const { geometry: _geometry, ...next } = renderConfig;
      updateConfig(next);
      return;
    }
    if (type === 'model') {
      modelSelectionPending = true;
      return;
    }
    modelSelectionPending = false;
    updateConfig({ ...renderConfig, geometry: { type } });
  }

  function handleModelPathChange(path: string) {
    if (passType === 'compute') {
      return;
    }
    const renderConfig = config as BufferPass | ImagePass;
    if (!path) {
      modelSelectionPending = true;
      const { geometry: _geometry, ...next } = renderConfig;
      updateConfig(next);
      return;
    }
    modelSelectionPending = false;
    updateConfig({ ...renderConfig, geometry: { type: 'model', path, ...(modelGeometry?.mesh ? { mesh: modelGeometry.mesh } : {}) } });
  }

  function handleModelMeshChange(event: Event) {
    if (passType === 'compute') {
      return;
    }
    const renderConfig = config as BufferPass | ImagePass;
    const mesh = (event.currentTarget as HTMLInputElement).value.trim();
    updateConfig({ ...renderConfig, geometry: { type: 'model', path: modelGeometry?.path ?? '', ...(mesh ? { mesh } : {}) } });
  }

  function handleVertexPathChange(path: string) {
    if (passType === 'compute') {
      return;
    }
    const renderConfig = config as BufferPass | ImagePass;
    if (path.trim() === '') {
      const { vertex: _vertex, ...next } = renderConfig;
      updateConfig(next);
      return;
    }
    updateConfig({ ...renderConfig, vertex: path });
  }

  function handleOutputFormat(event: Event) {
    const outputFormat = (event.currentTarget as HTMLSelectElement).value as BufferOutputFormat;
    updateConfig({ ...config, outputFormat } as EditableConfig);
  }

  function openVertexShaderInOverlay() {
    if (!config.vertex) {
      return;
    }
    if (getEditorOverlayVisible()) {
      setOverlayActiveFile(vertexPassKey(bufferName));
    } else {
      onOpenInNewTab(config.vertex, "active");
    }
  }

  function applyCreatedSource(result: {
    path: string;
    entryPoints?: { vertex?: string; fragment?: string; compute?: string };
    entryPoint?: string;
    authoringMode?: 'hooks' | 'native';
  }) {
    if (passType === 'compute') {
      const { entryPoint: _legacyEntryPoint, ...canonicalPass } = config as ComputePass;
      updateConfig({
        ...canonicalPass,
        path: result.path,
        ...(result.entryPoints?.compute || result.entryPoint
          ? { entryPoints: { compute: result.entryPoints?.compute ?? result.entryPoint } }
          : {}),
      });
      return;
    }
    updateConfig({
      ...config,
      ...(result.path ? { path: result.path } : {}),
      ...(result.authoringMode === 'native' || result.entryPoints ? { entryPoints: result.entryPoints ?? {} } : {}),
    } as EditableConfig);
  }

  function updateOutputs(outputs: { name?: string }[]) {
    updateConfig({ ...(config as BufferPass), outputs } as EditableConfig);
  }

  function addOutput() {
    if (renderOutputs.length < effectiveOutputLimit) {
      updateOutputs([...renderOutputs, {}]);
    }
  }

  function removeOutput() {
    if (renderOutputs.length > 1) {
      updateOutputs(renderOutputs.slice(0, -1));
    }
  }

  function renameOutput(index: number, name: string) {
    updateOutputs(renderOutputs.map((output, current) => current === index ? (name ? { name } : {}) : output));
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
          placeholder={suggestedPath || (bufferName === 'common'
            ? `e.g., ./common.${SHADER_LANGUAGES[language].extensions[0]}`
            : `e.g., ./buffer.${SHADER_LANGUAGES[language].extensions[0]}`)}
          {fileType}
          {shaderPath}
          {suggestedPath}
          {postMessage}
          {onMessage}
          sourcePath={insertionSourcePath}
          authoringMode={passType === 'compute' || hasNativeTemplate ? 'native' : 'hooks'}
          passName={bufferName}
          outputCount={passType === 'render' && hasNativeTemplate ? renderOutputs.length : undefined}
          allowInsert={canInsert || (passType === 'compute' && isWebGpuLanguage)}
          onCreated={applyCreatedSource}
        />

        {#if passType === 'compute' && onComputeCommit}
          <ComputePassControls
            pass={config as ComputePass}
            {storageNames}
            channelNames={configuredChannelNames}
            {entryPointNames}
            onCommit={onComputeCommit}
          />
        {/if}

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
        {#if configuredChannelNames.length > 0}
          <div class="channel-list">
            {#each configuredChannelNames as channelName}
              <ChannelListItem
                {channelName}
                channelInput={configuredInputs[channelName]!}
                {getWebviewUri}
                {audioVideoController}
                onUpdateMuted={(muted) => handleChannelMuteUpdate(channelName, muted)}
                onEdit={() => openChannelModal(channelName)}
                onRemove={() => handleModalRemove(channelName)}
              />
            {/each}
          </div>
        {/if}
        <div class="channel-list-footer">
          {#if configuredChannelNames.length > 1}
            <button class="sort-btn" onclick={handleSortChannels} title="Sort channels alphabetically">
              <i class="codicon codicon-sort-precedence"></i>
              Sort A-Z
            </button>
          {/if}
          {#if configuredChannelNames.length < ConfigValidator.getChannelLimit()}
            <button class="add-channel-btn" onclick={handleAddChannel}>
              + Add Channel
            </button>
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
          <span class="resolution-label">Fixed</span>
          <div class="custom-inputs">
            <input
              class="dim-input"
              type="number"
              placeholder="W"
              min="1"
              step="1"
              bind:value={widthInput}
              oninput={handleCustomResolution}
            />
            <span class="dim-sep">×</span>
            <input
              class="dim-input"
              type="number"
              placeholder="H"
              min="1"
              step="1"
              bind:value={heightInput}
              oninput={handleCustomResolution}
            />
            {#if imageHasCustom}
              <button class="preset-btn clear-custom-btn" onclick={handleClearCustomResolution}>Clear</button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if !isImagePass && bufferName !== "common" && passType !== 'compute'}
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

    {#if bufferName !== "common" && passType !== 'compute'}
      <div class="config-item geometry-section">
        <h3 class="section-title">Geometry</h3>
        <select
          aria-label="Geometry"
          value={modelGeometry ? "model" : config.geometry?.type ?? "fullscreen"}
          onchange={(event) => handleGeometryChange((event.currentTarget as HTMLSelectElement).value as GeometryType)}
        >
          <option value="fullscreen">Fullscreen</option>
          <option value="plane">Plane</option>
          <option value="cube">Cube</option>
          <option value="sphere">Sphere</option>
          <option value="model">GLB model</option>
        </select>
        {#if modelGeometry}
          <PathInput
            label="Model file:"
            inputId="model-path-input"
            value={modelGeometry.path}
            onPathChange={handleModelPathChange}
            fileType="model"
            allowCreate={false}
            {shaderPath}
            {postMessage}
            {onMessage}
          />
          <label class="mesh-name" for="mesh-name">Mesh</label>
          <select id="mesh-name" class="config-input" value={modelGeometry.mesh ?? modelMeshNames[0] ?? ''} onchange={handleModelMeshChange} disabled={modelMeshLoading}>
            {#if modelMeshLoading}
              <option value="">Loading meshes…</option>
            {:else if modelMeshNames.length > 0}
              {#each modelMeshNames as name}
                <option value={name}>{name}</option>
              {/each}
            {:else}
              <option value={modelGeometry.mesh ?? ''}>{modelGeometry.mesh || 'First mesh'}</option>
            {/if}
          </select>
          {#if modelMeshError}<span class="input-note">{modelMeshError}</span>{/if}
        {/if}
      </div>
      {#if !(isWebGpuLanguage && hasNativeVertex)}
        <div class="config-item">
          <h3 class="section-title vertex-shader-title" ondblclick={openVertexShaderInOverlay}>Vertex shader</h3>
          <PathInput
            value={config.vertex ?? ""}
            onPathChange={handleVertexPathChange}
            fileType={vertexFileType}
            suggestedPath={vertexSuggestedPath}
            {shaderPath}
            {postMessage}
            {onMessage}
          />
        </div>
      {/if}
    {/if}
    {#if !isImagePass && bufferName !== "common"}
      <div class="config-item">
        <div class="resolution-row">
          <label class="resolution-label" for="output-format-{bufferName}">Output format</label>
          <select
            id="output-format-{bufferName}"
            aria-label="Output format"
            value={'outputFormat' in config ? config.outputFormat ?? 'auto' : 'auto'}
            onchange={handleOutputFormat}
          >
            <option value="auto">Auto (32-bit preferred)</option>
            <option value="rgba16float">RGBA 16-bit float</option>
            <option value="rgba32float">RGBA 32-bit float</option>
          </select>
        </div>
      </div>
    {/if}
    {#if !isImagePass && passType === 'render' && isWebGpuLanguage && hasNativeTemplate}
      <div class="config-item">
        <h3 class="section-title">Outputs</h3>
        {#each renderOutputs as output, index}
          <div class="output-row">
            <span>Output {index}</span>
            <input aria-label={`Output ${index} name`} value={output.name ?? ''} placeholder="Optional name" oninput={(event) => renameOutput(index, event.currentTarget.value)} />
          </div>
        {/each}
        <div class="output-actions">
          <button type="button" onclick={addOutput} disabled={renderOutputs.length >= effectiveOutputLimit}>Add output</button>
          <button type="button" onclick={removeOutput} disabled={renderOutputs.length <= 1}>Remove last</button>
        </div>
        <p class="input-note">This device allows up to {effectiveOutputLimit} outputs with this format.</p>
      </div>
    {/if}
    {#if passType === 'render' && isWebGpuLanguage}
      <div class="config-item">
        <RenderEntryPointControls
          pass={config as BufferPass | ImagePass}
          entryPoints={renderEntryPoints}
          {language}
          onCommit={(nextPass) => updateConfig(nextPass)}
        />
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
  {availableBufferNames}
  {renderOutputCounts}
  {computeOutputLayerCounts}
/>

<style>
  .buffer-config {
    padding: 0;
  }

  .buffer-details {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 32px;
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
  .output-row, .output-actions { display: flex; align-items: center; gap: 8px; }
  .output-row input { flex: 1; min-width: 0; }

  .channel-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .channel-list-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }

  .add-channel-btn {
    padding: 5px 12px;
    font-size: 12px;
    background: none;
    border: 1px dashed var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-descriptionForeground, #888);
    cursor: pointer;
    transition: all 0.15s;
  }

  .add-channel-btn:hover {
    color: var(--vscode-foreground, #cccccc);
    border-color: var(--vscode-focusBorder, #007acc);
    border-style: solid;
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

  select {
    padding: 3px 6px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px;
    font-size: 12px;
    outline: none;
  }

  select:focus {
    border-color: var(--vscode-focusBorder, #007acc);
  }

</style>
