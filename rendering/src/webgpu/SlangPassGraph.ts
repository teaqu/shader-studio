import type { ComputePass, ConfigInput, ShaderConfig } from "@shader-studio/types";
import type {
  ChannelReadTiming,
  DispatchSpec,
  RenderPassChannel,
  RenderPassGraph,
  RenderPassName,
  RenderPassNode,
  StorageBindingNode,
} from "../types/PassGraph";

export type {
  ChannelReadTiming,
  RenderPassChannel,
  RenderPassGraph,
  RenderPassName,
  RenderPassNode,
} from "../types/PassGraph";

export interface BuildSlangPassGraphOptions {
  imageCode: string;
  config: ShaderConfig | null;
  buffers: Record<string, string>;
  canvasWidth: number;
  canvasHeight: number;
}

export const BUILTIN_STORAGE_TYPES: ReadonlySet<string> = new Set([
  "float", "float2", "float3", "float4",
  "int", "int2", "int3", "int4",
  "uint", "uint2", "uint3", "uint4",
  "Atomic<uint>", "Atomic<int>",
  "float2x2", "float3x3", "float4x4",
]);

const SPECIAL_PASS_NAMES = new Set(["common", "Image"]);
const MAX_TOTAL_STORAGE_BYTES = 256 * 1024 * 1024;
const BASELINE_STORAGE_BUFFER_COUNT = 8;
const MAX_WORKGROUP_INVOCATIONS = 256;
const TEXEL_WORKGROUP_SIZE: [number, number, number] = [8, 8, 1];
const COUNT_WORKGROUP_SIZE: [number, number, number] = [64, 1, 1];

export function isComputePassName(name: string): boolean {
  return name.startsWith("Compute");
}

export function buildSlangPassGraph(options: BuildSlangPassGraphOptions): RenderPassGraph {
  const canvasWidth = Math.max(1, Math.round(options.canvasWidth));
  const canvasHeight = Math.max(1, Math.round(options.canvasHeight));
  const warnings: string[] = [];
  const errors: string[] = [];
  const config = options.config;

  if (!config?.passes) {
    return {
      passes: [createImagePass(options.imageCode, canvasWidth, canvasHeight, [])],
      storage: [],
      commonCode: "",
      warnings,
      errors,
    };
  }

  const commonCode = options.buffers.common?.trim() ?? "";
  const passEntries = Object.entries(config.passes).filter(([name, passConfig]) => {
    if (SPECIAL_PASS_NAMES.has(name) || passConfig === undefined) {
      return true;
    }
    if (!isRecord(passConfig) || Array.isArray(passConfig)) {
      errors.push(`${name}: Pass configuration must be an object`);
      return false;
    }
    return true;
  });
  const configuredBufferNames = new Set(
    passEntries
      .filter(([name, passConfig]) => !SPECIAL_PASS_NAMES.has(name) && passConfig !== undefined)
      .map(([name]) => name),
  );
  const sampledBufferSources = collectSampledBufferSources(passEntries);
  const outputLayersByPass = resolveOutputLayersByPass(passEntries, errors);
  const storage = resolveStorage(config.storage, warnings, errors);
  const storageNames = new Set(storage.map(({ name }) => name));
  const computePasses: RenderPassNode[] = [];
  const renderPasses: RenderPassNode[] = [];

  for (const [name, passConfig] of passEntries) {
    if (SPECIAL_PASS_NAMES.has(name) || passConfig === undefined) {
      continue;
    }

    const path = "path" in passConfig ? passConfig.path : undefined;
    const source = options.buffers[name] ?? "";
    if (source.trim() === "") {
      const pathInfo = path ? ` (path: "${path}")` : "";
      errors.push(`${name}: Buffer file not found or is empty${pathInfo}`);
      continue;
    }

    const resolution = resolvePassResolution({
      passName: name,
      passConfig,
      canvasWidth,
      canvasHeight,
      errors,
    });
    const inputs = passConfig.inputs ?? {};
    const channels = resolveChannels({
      passName: name,
      inputs,
      configuredBufferNames,
      outputLayersByPass,
      warnings,
      errors,
    });

    if (isComputePassName(name)) {
      const computeConfig = passConfig as ComputePass;
      const dispatch = resolveDispatch(name, computeConfig.dispatch, storageNames, new Set(Object.keys(inputs)), errors);
      const defaultWorkgroupSize = dispatch.mode === "count" ? COUNT_WORKGROUP_SIZE : TEXEL_WORKGROUP_SIZE;
      const dispatchCount = resolveDispatchCount(name, computeConfig.dispatchCount, errors);
      const dispatchOnce = computeConfig.dispatchOnce === true;
      if (dispatchOnce && dispatchCount > 1) {
        errors.push(`${name}: dispatchOnce cannot be combined with dispatchCount greater than 1`);
      }

      computePasses.push({
        name,
        source,
        path,
        kind: "compute",
        output: sampledBufferSources.has(name) ? "texture" : "none",
        outputLayers: outputLayersByPass.get(name) ?? 1,
        dispatch,
        dispatchCount,
        dispatchOnce,
        workgroupSize: resolveWorkgroupSize(name, computeConfig.workgroupSize, defaultWorkgroupSize, errors),
        width: resolution.width,
        height: resolution.height,
        channels,
      });
      continue;
    }

    renderPasses.push({
      name,
      source,
      path,
      kind: "render",
      output: "texture",
      outputLayers: 1,
      dispatchCount: 1,
      dispatchOnce: false,
      workgroupSize: [...TEXEL_WORKGROUP_SIZE],
      width: resolution.width,
      height: resolution.height,
      channels,
    });
  }

  const imageConfig = config.passes.Image;
  const imageChannels = resolveChannels({
    passName: "Image",
    inputs: imageConfig?.inputs ?? {},
    configuredBufferNames,
    outputLayersByPass,
    warnings,
    errors,
  });
  const imagePass = createImagePass(options.imageCode, canvasWidth, canvasHeight, imageChannels);
  const passes = [...computePasses, ...renderPasses, imagePass];
  assignChannelReadTiming(passes);

  return { passes, storage, commonCode, warnings, errors };
}

function createImagePass(
  source: string,
  width: number,
  height: number,
  channels: RenderPassChannel[],
): RenderPassNode {
  return {
    name: "Image",
    source,
    kind: "render",
    output: "canvas",
    outputLayers: 1,
    dispatchCount: 1,
    dispatchOnce: false,
    workgroupSize: [...TEXEL_WORKGROUP_SIZE],
    width,
    height,
    channels,
  };
}

function collectSampledBufferSources(
  passEntries: [string, ShaderConfig["passes"][string]][],
): Set<string> {
  const sampledSources = new Set<string>();
  for (const [, passConfig] of passEntries) {
    for (const input of Object.values(passConfig?.inputs ?? {})) {
      if (input?.type === "buffer") {
        sampledSources.add(input.source);
      }
    }
  }
  return sampledSources;
}

function resolveOutputLayersByPass(
  passEntries: [string, ShaderConfig["passes"][string]][],
  errors: string[],
): Map<string, number> {
  const outputLayers = new Map<string, number>();
  for (const [name, passConfig] of passEntries) {
    if (SPECIAL_PASS_NAMES.has(name) || passConfig === undefined) {
      continue;
    }
    if (!isComputePassName(name)) {
      outputLayers.set(name, 1);
      continue;
    }

    const configuredLayers = (passConfig as ComputePass).outputLayers;
    if (configuredLayers === undefined) {
      outputLayers.set(name, 1);
    } else if (Number.isInteger(configuredLayers) && configuredLayers >= 1 && configuredLayers <= 8) {
      outputLayers.set(name, configuredLayers);
    } else {
      errors.push(`${name}: outputLayers must be an integer from 1 to 8`);
      outputLayers.set(name, 1);
    }
  }
  return outputLayers;
}

function resolveStorage(
  storageConfig: ShaderConfig["storage"],
  warnings: string[],
  errors: string[],
): StorageBindingNode[] {
  const storage: StorageBindingNode[] = [];
  let totalBytes = 0;

  for (const [name, declaration] of Object.entries(storageConfig ?? {})) {
    let valid = true;
    if (!isPositiveInteger(declaration?.count)) {
      errors.push(`Storage ${name}: count must be a positive integer`);
      valid = false;
    }
    if (!isPositiveInteger(declaration?.stride)) {
      errors.push(`Storage ${name}: stride must be a positive integer`);
      valid = false;
    }
    const elementType = typeof declaration?.elementType === "string" ? declaration.elementType.trim() : "";
    if (elementType === "") {
      errors.push(`Storage ${name}: elementType is required`);
      valid = false;
    }
    if (!valid) {
      continue;
    }

    storage.push({
      name,
      binding: storage.length,
      elementType,
      builtin: BUILTIN_STORAGE_TYPES.has(elementType),
      count: declaration.count,
      stride: declaration.stride,
    });
    totalBytes += declaration.count * declaration.stride;
  }

  if (storage.length > BASELINE_STORAGE_BUFFER_COUNT) {
    warnings.push(
      `Storage uses more than the WebGPU baseline 8 storage buffers; check adapter support or consider packing buffers`,
    );
  }
  if (totalBytes > MAX_TOTAL_STORAGE_BYTES) {
    errors.push("Total storage size exceeds 256 MiB");
  }
  return storage;
}

function resolveDispatch(
  passName: string,
  dispatch: unknown,
  storageNames: Set<string>,
  channelKeys: Set<string>,
  errors: string[],
): DispatchSpec {
  if (dispatch === undefined) {
    return { mode: "texel" };
  }
  if (!isRecord(dispatch) || Array.isArray(dispatch)) {
    errors.push(`${passName}: invalid dispatch shape`);
    return { mode: "texel" };
  }

  const keys = Object.keys(dispatch);
  if (keys.length === 1 && keys[0] === "count") {
    if (isPositiveInteger(dispatch.count)) {
      return { mode: "count", count: dispatch.count };
    }
    errors.push(`${passName}: dispatch count must be a positive integer`);
    return { mode: "texel" };
  }

  if (keys.length === 3 && keys.includes("x") && keys.includes("y") && keys.includes("z")) {
    if (isPositiveInteger(dispatch.x) && isPositiveInteger(dispatch.y) && isPositiveInteger(dispatch.z)) {
      return { mode: "workgroups", x: dispatch.x, y: dispatch.y, z: dispatch.z };
    }
    errors.push(`${passName}: dispatch x, y, and z must be positive integers`);
    return { mode: "texel" };
  }

  if (keys.length === 1 && keys[0] === "cover") {
    if (typeof dispatch.cover === "string" && storageNames.has(dispatch.cover)) {
      return { mode: "cover-storage", name: dispatch.cover };
    }
    if (typeof dispatch.cover === "string" && channelKeys.has(dispatch.cover)) {
      return { mode: "cover-channel", key: dispatch.cover };
    }
    errors.push(`${passName}: dispatch cover target "${String(dispatch.cover)}" was not found`);
    return { mode: "texel" };
  }

  errors.push(`${passName}: invalid dispatch shape`);
  return { mode: "texel" };
}

function resolveDispatchCount(passName: string, dispatchCount: unknown, errors: string[]): number {
  if (dispatchCount === undefined) {
    return 1;
  }
  if (isPositiveInteger(dispatchCount)) {
    return dispatchCount;
  }
  errors.push(`${passName}: dispatchCount must be a positive integer`);
  return 1;
}

function resolveWorkgroupSize(
  passName: string,
  workgroupSize: unknown,
  fallback: [number, number, number],
  errors: string[],
): [number, number, number] {
  if (workgroupSize === undefined) {
    return [...fallback];
  }
  if (!Array.isArray(workgroupSize) || workgroupSize.length !== 3) {
    errors.push(`${passName}: workgroupSize must contain exactly 3 dimensions`);
    return [...fallback];
  }
  if (!workgroupSize.every(isPositiveInteger)) {
    errors.push(`${passName}: workgroupSize dimensions must be positive integers`);
    return [...fallback];
  }
  if (workgroupSize[0] * workgroupSize[1] * workgroupSize[2] > MAX_WORKGROUP_INVOCATIONS) {
    errors.push(`${passName}: workgroupSize product must be at most 256`);
    return [...fallback];
  }
  return [workgroupSize[0], workgroupSize[1], workgroupSize[2]];
}

function assignChannelReadTiming(passes: RenderPassNode[]): void {
  const passIndex = new Map(passes.map((pass, index) => [pass.name, index]));
  for (const [consumerIndex, pass] of passes.entries()) {
    for (const channel of pass.channels) {
      if (channel.kind !== "buffer") {
        continue;
      }
      const sourceIndex = passIndex.get(channel.source);
      channel.readFrom = sourceIndex !== undefined && sourceIndex < consumerIndex
        ? "current-frame"
        : "previous-frame";
    }
  }
}

/**
 * Resolve a pass's render resolution from its config (fixed width/height,
 * canvas-relative scale, or the canvas size when unconfigured). Exported so
 * the engine can recompute pass sizes on canvas resize exactly the way
 * buildSlangPassGraph does at compile time.
 */
export function resolvePassResolution(options: {
  passName: RenderPassName;
  passConfig: ShaderConfig["passes"][string] | undefined;
  canvasWidth: number;
  canvasHeight: number;
  errors: string[];
}): { width: number; height: number } {
  const resolution = options.passConfig?.resolution;
  if (!resolution) {
    return { width: options.canvasWidth, height: options.canvasHeight };
  }

  if ("width" in resolution && "height" in resolution && resolution.width && resolution.height) {
    return {
      width: Math.max(1, Math.round(resolution.width * (resolution.scale ?? 1))),
      height: Math.max(1, Math.round(resolution.height * (resolution.scale ?? 1))),
    };
  }

  if ("scale" in resolution && typeof resolution.scale === "number") {
    return {
      width: Math.max(1, Math.round(options.canvasWidth * resolution.scale)),
      height: Math.max(1, Math.round(options.canvasHeight * resolution.scale)),
    };
  }

  options.errors.push(`${options.passName}: Invalid resolution settings`);
  return { width: options.canvasWidth, height: options.canvasHeight };
}

function resolveChannels(options: {
  passName: RenderPassName;
  inputs: Record<string, ConfigInput>;
  configuredBufferNames: Set<string>;
  outputLayersByPass: Map<string, number>;
  warnings: string[];
  errors: string[];
}): RenderPassChannel[] {
  const channels: RenderPassChannel[] = [];

  for (const [key, input] of Object.entries(options.inputs)) {
    const slot = channelSlotFromKey(key);
    if (slot === null) {
      options.warnings.push(`${options.passName}: ignoring non-iChannel input "${key}"`);
      continue;
    }

    if (input.type === "texture") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} texture input is missing a path`);
        continue;
      }
      channels.push({
        kind: "texture",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
        grayscale: input.grayscale,
      });
      continue;
    }

    if (input.type === "video") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} video input is missing a path`);
        continue;
      }
      channels.push({
        kind: "video",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
        muted: input.muted,
      });
      continue;
    }

    if (input.type === "cubemap") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} cubemap input is missing a path`);
        continue;
      }
      channels.push({
        kind: "cubemap",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
      });
      continue;
    }

    if (input.type === "keyboard") {
      channels.push({ kind: "keyboard", slot, key });
      continue;
    }

    if (input.type !== "buffer") {
      options.warnings.push(`${options.passName}: ${key} uses unsupported Slang/WebGPU input type "${input.type}"`);
      continue;
    }

    if (SPECIAL_PASS_NAMES.has(input.source)) {
      options.errors.push(`${options.passName}: ${key} source "${input.source}" is not a buffer pass`);
      continue;
    }
    if (!options.configuredBufferNames.has(input.source)) {
      options.errors.push(`${options.passName}: ${key} references missing buffer "${input.source}"`);
      continue;
    }

    const sourceLayers = options.outputLayersByPass.get(input.source) ?? 1;
    const layer = input.layer === undefined ? 0 : input.layer;
    if (!Number.isInteger(layer) || layer < 0 || layer >= sourceLayers) {
      options.errors.push(
        `${options.passName}: ${key} layer ${String(input.layer)} is invalid for source "${input.source}" with ${sourceLayers} layer(s)`,
      );
      continue;
    }

    channels.push({
      kind: "buffer",
      slot,
      key,
      source: input.source,
      readFrom: "previous-frame",
      ...(input.layer === undefined ? {} : { layer: input.layer }),
    });
  }

  return channels.sort((a, b) => a.slot - b.slot);
}

function channelSlotFromKey(key: string): number | null {
  const match = /^iChannel(\d+)$/.exec(key);
  if (!match) {
    return null;
  }
  const slot = Number.parseInt(match[1], 10);
  return Number.isInteger(slot) && slot >= 0 && slot <= 15 ? slot : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
