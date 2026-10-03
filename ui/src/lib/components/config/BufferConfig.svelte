<svelte:options runes={true} />

<script lang="ts">
  import { ConfigValidator, resolveRenderState } from "@shader-studio/rendering";
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
    GeometryConfig,
    FullscreenGeometryConfig,
    MeshGeometryConfig,
    MeshTopology,
    SampleCount,
    ModelGeometryConfig,
    ComputePass,
    ShaderLanguageId,
    BufferOutputFormat,
    ShaderEntryPoint,
    VerticesGeometryConfig,
    VertexTopology,
    VertexSpace,
    BlendMode,
    ClearColor,
    CullMode,
    DepthSettings,
  } from "@shader-studio/types";
  import {
    DEFAULT_BLEND_MODE,
    DEFAULT_CLEAR_COLOR,
    DEFAULT_CULL_MODE,
    DEFAULT_DEPTH_COMPARE,
    DEFAULT_INSTANCE_COUNT,
    DEFAULT_MESH_TOPOLOGY,
    DEFAULT_SAMPLE_COUNT,
    DEFAULT_VERTEX_COUNT,
    DEFAULT_VERTEX_SPACE,
    DEFAULT_VERTEX_TOPOLOGY,
    MAX_INSTANCE_COUNT,
    MAX_VERTEX_COUNT,
    SHADER_LANGUAGES,
    shaderLanguageForPath,
    vertexPassKey,
  } from "@shader-studio/types";
  import ChannelListItem from "./ChannelListItem.svelte";
  import ChannelConfigModal from "./ChannelConfigModal.svelte";
  import ComputePassControls from "./ComputePassControls.svelte";
  import RenderEntryPointControls from "./RenderEntryPointControls.svelte";
  import PathInput from "./PathInput.svelte";
  import DepthTestingControls from "./DepthTestingControls.svelte";
  import { getEditorOverlayVisible, setEditorOverlayVisible, setOverlayActiveFile } from "../../state/editorOverlayState.svelte";
  import { rememberDrawFields, takeDrawField } from "../../state/verticesDrawMemory.svelte";
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
    onComputeCommit = undefined,
    onOpenInNewTab = () => {},
  }: BufferConfigProps = $props();

  const IMAGE_SCALES = [0.25, 0.5, 1, 2, 4] as const;
  const BUFFER_SCALES = [0.25, 0.5, 1, 2, 4] as const;
  const ASPECT_MODES: AspectRatioMode[] = ['16:9', '4:3', '1:1', 'fill', 'auto'];

  const imageConfig = $derived(isImagePass ? (config as ImagePass) : undefined);
  const bufferPassConfig = $derived(!isImagePass ? (config as BufferPass) : undefined);
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
  const renderAuthoringMode = $derived(config.entryPoints === undefined ? 'hooks' as const : 'native' as const);
  const isWebGpuLanguage = $derived(SHADER_LANGUAGES[language].engine === 'webgpu');
  const canInsert = $derived(isWebGpuLanguage && renderAuthoringMode === 'native');
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
  const verticesGeometry = $derived<VerticesGeometryConfig | undefined>(
    !modelGeometry && config.geometry?.type === 'vertices' ? config.geometry : undefined,
  );
  const selectedGeometry = $derived<GeometryType>(modelGeometry ? 'model' : config.geometry?.type ?? 'fullscreen');
  /** Geometry that accepts instanceCount: anything drawn but fullscreen. */
  const instancedGeometry = $derived<Exclude<GeometryConfig, FullscreenGeometryConfig> | undefined>(
    config.geometry && config.geometry.type !== 'fullscreen' ? config.geometry : undefined,
  );
  /** The configured plane, cube, sphere or model geometry, which accepts a mesh topology. */
  const configuredMeshGeometry = $derived<MeshGeometryConfig | ModelGeometryConfig | undefined>(
    instancedGeometry?.type === 'vertices' ? undefined : instancedGeometry,
  );
  /** The mesh geometry the Topology control edits; hidden while a model is being picked to replace another mesh. */
  const meshGeometry = $derived(
    modelSelectionPending && configuredMeshGeometry?.type !== 'model' ? undefined : configuredMeshGeometry,
  );
  /** Blend/clear/depth/cull the pass draws with, defaults applied, for the controls' displayed values. */
  const renderState = $derived(resolveRenderState({
    geometry: selectedGeometry,
    ...(verticesGeometry?.space ? { space: verticesGeometry.space } : {}),
    ...('blend' in config && config.blend ? { blend: config.blend } : {}),
    ...('clear' in config && config.clear ? { clear: config.clear } : {}),
    ...('depth' in config && config.depth ? { depth: config.depth } : {}),
    ...('cull' in config && config.cull ? { cull: config.cull } : {}),
    ...('samples' in config && config.samples ? { samples: config.samples } : {}),
  }));
  const clearRgbHex = $derived(`#${renderState.clear.slice(0, 3)
    .map((component) => Math.round(component * 255).toString(16).padStart(2, '0'))
    .join('')}`);
  let vertexCountError = $state<string | null>(null);
  let instanceCountError = $state<string | null>(null);
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

  type RenderSettingsConfig = EditableConfig & { blend?: BlendMode; clear?: ClearColor; depth?: DepthSettings; cull?: CullMode; samples?: SampleCount };

  /** Drops keys whose value is undefined so defaults never reach the config file. */
  function withoutUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
  }

  /**
   * instanceCount for geometry replacing the current one: kept from drawn
   * geometry, or restored from memory when the pass was fullscreen.
   */
  function carriedInstanceCount(): { instanceCount?: number } {
    const instanceCount = instancedGeometry
      ? instancedGeometry.instanceCount
      : takeDrawField(shaderPath, bufferName, 'instanceCount');
    return instanceCount === undefined ? {} : { instanceCount };
  }

  /**
   * Mesh topology for mesh geometry replacing the current one: kept from a
   * mesh, or restored from memory when the pass was fullscreen or vertices.
   */
  function carriedMeshTopology(): { topology?: MeshTopology } {
    const topology = configuredMeshGeometry
      ? configuredMeshGeometry.topology
      : takeDrawField(shaderPath, bufferName, 'meshTopology');
    return topology === undefined ? {} : { topology };
  }

  function handleGeometryChange(type: GeometryType) {
    if (passType === 'compute') return;
    vertexCountError = null;
    instanceCountError = null;
    // Fullscreen and vertices reject a mesh topology; keep it for a switch back.
    if (configuredMeshGeometry && (type === 'fullscreen' || type === 'vertices')) {
      rememberDrawFields(shaderPath, bufferName, { meshTopology: configuredMeshGeometry.topology });
    }
    // Other geometry rejects vertexCount/topology/space; keep them for a switch back.
    if (verticesGeometry && type !== 'vertices') {
      const { type: _type, instanceCount: _instanceCount, ...fields } = verticesGeometry;
      rememberDrawFields(shaderPath, bufferName, { vertices: fields });
    }
    if (type === 'model') {
      // The geometry changes once a model file is chosen.
      modelSelectionPending = true;
      return;
    }
    modelSelectionPending = false;
    const { geometry: _geometry, ...current } = config as RenderSettingsConfig;
    if (type === 'fullscreen') {
      // Fullscreen has no depth buffer, nothing to cull or antialias, and draws once; keep them for a switch back.
      rememberDrawFields(shaderPath, bufferName, { depth: current.depth, cull: current.cull, samples: current.samples, instanceCount: instancedGeometry?.instanceCount });
      const { depth: _depth, cull: _cull, samples: _samples, ...rest } = current;
      updateConfig(rest as EditableConfig);
      return;
    }
    const restored: Partial<RenderSettingsConfig> = {};
    if (selectedGeometry === 'fullscreen') {
      const depth = takeDrawField(shaderPath, bufferName, 'depth');
      const cull = takeDrawField(shaderPath, bufferName, 'cull');
      const samples = takeDrawField(shaderPath, bufferName, 'samples');
      Object.assign(restored, depth ? { depth } : {}, cull ? { cull } : {}, samples ? { samples } : {});
    }
    const geometry = type === 'vertices'
      ? { type, ...takeDrawField(shaderPath, bufferName, 'vertices'), ...carriedInstanceCount() }
      : { type, ...carriedMeshTopology(), ...carriedInstanceCount() };
    updateConfig({ ...current, ...restored, geometry } as EditableConfig);
  }

  /** Writes vertices draw fields, leaving out any that are at their default. */
  function updateVerticesDraw(fields: Partial<Pick<VerticesGeometryConfig, 'vertexCount' | 'topology' | 'space'>>) {
    const { type: _type, ...current } = verticesGeometry ?? { type: 'vertices' as const };
    const draw = withoutUndefined({ ...current, ...fields });
    updateConfig({ ...config, geometry: { type: 'vertices', ...draw } } as EditableConfig);
  }

  function handleVertexCountChange(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value.trim();
    if (raw === '') {
      vertexCountError = null;
      updateVerticesDraw({ vertexCount: undefined });
      return;
    }
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 1 || count > MAX_VERTEX_COUNT) {
      vertexCountError = `Vertex count must be a whole number from 1 to ${MAX_VERTEX_COUNT}`;
      return;
    }
    vertexCountError = null;
    updateVerticesDraw({ vertexCount: count });
  }

  function handleMeshTopologyChange(event: Event) {
    if (!meshGeometry) {
      return;
    }
    const topology = (event.currentTarget as HTMLSelectElement).value as MeshTopology;
    const { topology: _topology, ...geometry } = meshGeometry;
    updateConfig({
      ...config,
      geometry: topology === DEFAULT_MESH_TOPOLOGY ? geometry : { ...geometry, topology },
    } as EditableConfig);
  }

  function handleInstanceCountChange(event: Event) {
    if (!instancedGeometry) {
      return;
    }
    const raw = (event.currentTarget as HTMLInputElement).value.trim();
    const count = raw === '' ? DEFAULT_INSTANCE_COUNT : Number(raw);
    if (!Number.isInteger(count) || count < 1 || count > MAX_INSTANCE_COUNT) {
      instanceCountError = `Instance count must be a whole number from 1 to ${MAX_INSTANCE_COUNT}`;
      return;
    }
    instanceCountError = null;
    const { instanceCount: _instanceCount, ...geometry } = instancedGeometry;
    updateConfig({
      ...config,
      geometry: count === DEFAULT_INSTANCE_COUNT ? geometry : { ...geometry, instanceCount: count },
    } as EditableConfig);
  }

  function handleTopologyChange(event: Event) {
    const topology = (event.currentTarget as HTMLSelectElement).value as VertexTopology;
    updateVerticesDraw({ topology: topology === DEFAULT_VERTEX_TOPOLOGY ? undefined : topology });
  }

  function handleSpaceChange(event: Event) {
    const space = (event.currentTarget as HTMLSelectElement).value as VertexSpace;
    updateVerticesDraw({ space: space === DEFAULT_VERTEX_SPACE ? undefined : space });
  }

  /** Writes one pass-level render setting; the default value removes the key. */
  function updateRenderSetting<K extends 'blend' | 'cull' | 'samples'>(field: K, value: RenderSettingsConfig[K], fallback: RenderSettingsConfig[K]) {
    const { [field]: _current, ...rest } = config as RenderSettingsConfig;
    updateConfig((value === fallback ? rest : { ...rest, [field]: value }) as EditableConfig);
  }

  function handleBlendChange(event: Event) {
    updateRenderSetting('blend', (event.currentTarget as HTMLSelectElement).value as BlendMode, DEFAULT_BLEND_MODE);
  }

  function updateClear(clear: ClearColor) {
    const current = config as RenderSettingsConfig;
    const { clear: _clear, ...rest } = current;
    updateConfig((clear.every((component, index) => component === DEFAULT_CLEAR_COLOR[index])
      ? rest
      : { ...rest, clear }) as EditableConfig);
  }

  function handleClearColorChange(event: Event) {
    const hex = (event.currentTarget as HTMLInputElement).value;
    updateClear([
      Number.parseInt(hex.slice(1, 3), 16) / 255,
      Number.parseInt(hex.slice(3, 5), 16) / 255,
      Number.parseInt(hex.slice(5, 7), 16) / 255,
      renderState.clear[3],
    ]);
  }

  function handleClearAlphaChange(event: Event) {
    const parsed = Number((event.currentTarget as HTMLInputElement).value);
    const alpha = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : renderState.clear[3];
    updateClear([renderState.clear[0], renderState.clear[1], renderState.clear[2], alpha]);
  }

  function handleSamplesChange(event: Event) {
    updateRenderSetting('samples', Number((event.currentTarget as HTMLSelectElement).value) as SampleCount, DEFAULT_SAMPLE_COUNT);
  }

  function handleCullChange(event: Event) {
    updateRenderSetting('cull', (event.currentTarget as HTMLSelectElement).value as CullMode, DEFAULT_CULL_MODE);
  }

  /** Writes depth fields; each at its geometry's default is left out, and an empty depth object is dropped. */
  function updateDepth(fields: Partial<DepthSettings>) {
    const current = config as RenderSettingsConfig;
    const defaults = resolveRenderState({
      geometry: selectedGeometry,
      ...(verticesGeometry?.space ? { space: verticesGeometry.space } : {}),
    }).depth!;
    const merged = { ...current.depth, ...fields };
    const depth = withoutUndefined({
      test: merged.test === defaults.test ? undefined : merged.test,
      write: merged.write === defaults.write ? undefined : merged.write,
      compare: merged.compare === DEFAULT_DEPTH_COMPARE ? undefined : merged.compare,
    });
    const { depth: _depth, ...rest } = current;
    updateConfig((Object.keys(depth).length === 0 ? rest : { ...rest, depth }) as EditableConfig);
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
    updateConfig({ ...renderConfig, geometry: { type: 'model', path, ...(modelGeometry?.mesh ? { mesh: modelGeometry.mesh } : {}), ...carriedMeshTopology(), ...carriedInstanceCount() } });
  }

  function handleModelMeshChange(event: Event) {
    if (passType === 'compute') {
      return;
    }
    const renderConfig = config as BufferPass | ImagePass;
    const mesh = (event.currentTarget as HTMLInputElement).value.trim();
    updateConfig({ ...renderConfig, geometry: { type: 'model', path: modelGeometry?.path ?? '', ...(mesh ? { mesh } : {}), ...carriedMeshTopology(), ...carriedInstanceCount() } });
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
          authoringMode={passType === 'compute' ? 'native' : renderAuthoringMode}
          passName={bufferName}
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

    {#if passType === 'render' && isWebGpuLanguage}
      <div class="config-item">
        <RenderEntryPointControls
          pass={config as BufferPass | ImagePass}
          entryPoints={renderEntryPoints}
          onCommit={(nextPass) => updateConfig(nextPass)}
        />
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
          value={selectedGeometry}
          onchange={(event) => handleGeometryChange((event.currentTarget as HTMLSelectElement).value as GeometryType)}
        >
          <option value="fullscreen">Fullscreen</option>
          <option value="vertices">Vertices</option>
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
        {#if meshGeometry}
          <div class="resolution-row">
            <label class="resolution-label" for="mesh-topology-{bufferName}">Topology</label>
            <select
              id="mesh-topology-{bufferName}"
              value={meshGeometry.topology ?? DEFAULT_MESH_TOPOLOGY}
              onchange={handleMeshTopologyChange}
            >
              <option value="triangle-list">Triangles</option>
              <option value="line-list">Wireframe (line list)</option>
              <option value="point-list">Points</option>
            </select>
          </div>
        {/if}
        {#if verticesGeometry}
          <div class="resolution-row">
            <label class="resolution-label" for="vertex-count-{bufferName}">Vertices</label>
            <input
              id="vertex-count-{bufferName}"
              class="vertex-count-input"
              type="number"
              min="1"
              max={MAX_VERTEX_COUNT}
              step="1"
              placeholder={String(DEFAULT_VERTEX_COUNT)}
              value={verticesGeometry.vertexCount ?? ''}
              onchange={handleVertexCountChange}
            />
          </div>
          {#if vertexCountError}<span class="input-note" role="alert">{vertexCountError}</span>{/if}
          <div class="resolution-row">
            <label class="resolution-label" for="topology-{bufferName}">Topology</label>
            <select
              id="topology-{bufferName}"
              value={verticesGeometry.topology ?? DEFAULT_VERTEX_TOPOLOGY}
              onchange={handleTopologyChange}
            >
              <option value="triangle-list">Triangle list</option>
              <option value="triangle-strip">Triangle strip</option>
              <option value="line-list">Line list</option>
              <option value="line-strip">Line strip</option>
              <option value="point-list">Point list</option>
            </select>
          </div>
          <div class="resolution-row">
            <label class="resolution-label" for="space-{bufferName}">Space</label>
            <select
              id="space-{bufferName}"
              value={verticesGeometry.space ?? DEFAULT_VERTEX_SPACE}
              onchange={handleSpaceChange}
            >
              <option value="world">World (orbit camera)</option>
              <option value="clip">Clip (screen)</option>
            </select>
          </div>
        {/if}
        {#if instancedGeometry}
          <div class="resolution-row">
            <label class="resolution-label" for="instance-count-{bufferName}">Instances</label>
            <input
              id="instance-count-{bufferName}"
              class="vertex-count-input"
              type="number"
              min="1"
              max={MAX_INSTANCE_COUNT}
              step="1"
              placeholder={String(DEFAULT_INSTANCE_COUNT)}
              value={instancedGeometry.instanceCount ?? ''}
              onchange={handleInstanceCountChange}
            />
          </div>
          {#if instanceCountError}<span class="input-note" role="alert">{instanceCountError}</span>{/if}
        {/if}
      </div>
      <div class="config-item render-settings-section">
        <h3 class="section-title">Rendering</h3>
        <div class="resolution-row">
          <label class="resolution-label" for="blend-{bufferName}">Blend</label>
          <select id="blend-{bufferName}" value={renderState.blend} onchange={handleBlendChange}>
            <option value="none">None</option>
            <option value="alpha">Alpha</option>
            <option value="premultiplied">Premultiplied alpha</option>
            <option value="additive">Additive</option>
          </select>
        </div>
        <div class="resolution-row">
          <label class="resolution-label" for="clear-color-{bufferName}">Clear colour</label>
          <input id="clear-color-{bufferName}" class="clear-color-input" type="color" value={clearRgbHex} onchange={handleClearColorChange} />
        </div>
        <div class="resolution-row">
          <label class="resolution-label" for="clear-alpha-{bufferName}">Clear alpha</label>
          <input id="clear-alpha-{bufferName}" class="clear-alpha-input" type="number" min="0" max="1" step="0.05" value={renderState.clear[3]} onchange={handleClearAlphaChange} />
        </div>
        {#if renderState.depth}
          <div class="resolution-row">
            <label class="resolution-label" for="cull-{bufferName}">Cull</label>
            <select id="cull-{bufferName}" value={renderState.cull} onchange={handleCullChange}>
              <option value="none">None</option>
              <option value="back">Back faces</option>
              <option value="front">Front faces</option>
            </select>
          </div>
          <div class="resolution-row">
            <label class="resolution-label" for="samples-{bufferName}">Antialiasing</label>
            <select id="samples-{bufferName}" value={String(renderState.samples)} onchange={handleSamplesChange}>
              <option value="1">Off</option>
              <option value="4">4× MSAA</option>
            </select>
          </div>
        {/if}
      </div>
      {#if renderState.depth}
        <DepthTestingControls bufferName={bufferName} depth={renderState.depth} onChange={updateDepth} />
      {/if}
      {#if !(isWebGpuLanguage && renderAuthoringMode === 'native')}
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

  .dim-input,
  .clear-alpha-input,
  .vertex-count-input {
    width: 80px;
    padding: 3px 6px;
    font-size: 11px;
    background: var(--vscode-input-background, #3c3c3c);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    color: var(--vscode-input-foreground, #cccccc);
    outline: none;
  }

  /* Wide enough for the 10-digit maximum vertex count. */
  .vertex-count-input {
    width: 110px;
  }

  .dim-input:focus,
  .clear-alpha-input:focus,
  .vertex-count-input:focus {
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
