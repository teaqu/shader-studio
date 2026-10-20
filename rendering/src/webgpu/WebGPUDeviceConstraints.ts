import { resolvePassStorage } from "./PassStorage";
import type { SlangSourceModule } from "@shader-studio/types";
import { resolveWorkgroupCounts,validateWorkgroupCounts } from "./WebGPUDispatch";

import type { StorageBindingNode } from "../types/PassGraph";
import {
  type ComputeWorkgroupLimits,
  type RenderPassNode
} from "./SlangPassGraph";
import { createShaderToyUniformLayout } from "./SlangPrelude";
import { WGSL_KNOWN_GPU_FEATURES } from "./WgslPrelude";

const DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;

const DEFAULT_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE = 8;
const DEFAULT_MAX_BUFFER_SIZE = 256 * 1024 * 1024;

const DEFAULT_MAX_STORAGE_BUFFER_BINDING_SIZE = 128 * 1024 * 1024;

const WEBGPU_BUFFER_SIZE_ALIGNMENT = 4;

function storageBufferByteSize(node: StorageBindingNode): number {
  const logicalSize = node.count * node.stride;
  return Math.ceil(logicalSize / WEBGPU_BUFFER_SIZE_ALIGNMENT) * WEBGPU_BUFFER_SIZE_ALIGNMENT;
}

function positiveDeviceLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const DEFAULT_MAX_COMPUTE_WORKGROUPS_PER_DIMENSION = 65_535;

const DEFAULT_MAX_COMPUTE_INVOCATIONS_PER_WORKGROUP = 256;

const DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_X = 256;

const DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Y = 256;

const DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Z = 64;

const DEFAULT_MAX_TEXTURE_ARRAY_LAYERS = 256;

const DEFAULT_MAX_SAMPLED_TEXTURES_PER_SHADER_STAGE = 16;

interface WebGPUDeviceConstraintsHost {

  canvas: HTMLCanvasElement | null;
  device: GPUDevice | null;
}

/** Owns constraints state and operations; dependencies stay live across compilation swaps. */
export class WebGPUDeviceConstraints {
  constructor(private readonly host: WebGPUDeviceConstraintsHost) {}

  maxTextureDimension2D = DEFAULT_MAX_TEXTURE_DIMENSION_2D;

  buildDeviceDescriptor(adapter: GPUAdapter): GPUDeviceDescriptor | undefined {
    const requiredLimits: Record<string, number> = {};
    const adapterTextureLimit = adapter.limits?.maxTextureDimension2D;
    if (
      typeof adapterTextureLimit === "number" &&
      Number.isFinite(adapterTextureLimit) &&
      adapterTextureLimit > DEFAULT_MAX_TEXTURE_DIMENSION_2D
    ) {
      requiredLimits.maxTextureDimension2D = adapterTextureLimit;
    }
    const adapterStorageCountLimit = adapter.limits?.maxStorageBuffersPerShaderStage;
    if (
      typeof adapterStorageCountLimit === "number" &&
      Number.isFinite(adapterStorageCountLimit) &&
      adapterStorageCountLimit > DEFAULT_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE
    ) {
      requiredLimits.maxStorageBuffersPerShaderStage = adapterStorageCountLimit;
    }
    const adapterStorageSizeLimit = adapter.limits?.maxStorageBufferBindingSize;
    if (
      typeof adapterStorageSizeLimit === "number" &&
      Number.isFinite(adapterStorageSizeLimit) &&
      adapterStorageSizeLimit > DEFAULT_MAX_STORAGE_BUFFER_BINDING_SIZE
    ) {
      requiredLimits.maxStorageBufferBindingSize = adapterStorageSizeLimit;
    }
    const computeLimits: Array<[keyof GPUSupportedLimits, number]> = [
      ["maxBufferSize", DEFAULT_MAX_BUFFER_SIZE],
      ["maxColorAttachments", 8],
      ["maxColorAttachmentBytesPerSample", 32],
      ["maxComputeInvocationsPerWorkgroup", DEFAULT_MAX_COMPUTE_INVOCATIONS_PER_WORKGROUP],
      ["maxComputeWorkgroupSizeX", DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_X],
      ["maxComputeWorkgroupSizeY", DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Y],
      ["maxComputeWorkgroupSizeZ", DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Z],
      ["maxComputeWorkgroupsPerDimension", DEFAULT_MAX_COMPUTE_WORKGROUPS_PER_DIMENSION],
    ];
    for (const [name, portableLimit] of computeLimits) {
      const adapterLimit = adapter.limits?.[name];
      if (
        typeof adapterLimit === "number" &&
        Number.isFinite(adapterLimit) &&
        adapterLimit > portableLimit
      ) {
        requiredLimits[name] = adapterLimit;
      }
    }
    const adapterArrayLayersLimit = adapter.limits?.maxTextureArrayLayers;
    if (
      typeof adapterArrayLayersLimit === "number" &&
      Number.isFinite(adapterArrayLayersLimit) &&
      adapterArrayLayersLimit > DEFAULT_MAX_TEXTURE_ARRAY_LAYERS
    ) {
      requiredLimits.maxTextureArrayLayers = adapterArrayLayersLimit;
    }
    const adapterSampledTexturesLimit = adapter.limits?.maxSampledTexturesPerShaderStage;
    if (
      typeof adapterSampledTexturesLimit === "number" &&
      Number.isFinite(adapterSampledTexturesLimit) &&
      adapterSampledTexturesLimit > DEFAULT_MAX_SAMPLED_TEXTURES_PER_SHADER_STAGE
    ) {
      requiredLimits.maxSampledTexturesPerShaderStage = adapterSampledTexturesLimit;
    }
    const adapterSamplersLimit = adapter.limits?.maxSamplersPerShaderStage;
    if (
      typeof adapterSamplersLimit === "number" &&
      Number.isFinite(adapterSamplersLimit) &&
      adapterSamplersLimit > DEFAULT_MAX_SAMPLED_TEXTURES_PER_SHADER_STAGE
    ) {
      requiredLimits.maxSamplersPerShaderStage = adapterSamplersLimit;
    }
    // Spec 7.2 option A: request every known feature the adapter supports up
    // front, so a shader with `enable f16` just works when the hardware allows.
    const requiredFeatures = WGSL_KNOWN_GPU_FEATURES.filter(
      (feature) => adapter.features?.has?.(feature as GPUFeatureName) === true,
    ) as GPUFeatureName[];
    if (requiredFeatures.length === 0 && Object.keys(requiredLimits).length === 0) {
      return undefined;
    }

    const descriptor: GPUDeviceDescriptor = {};
    if (requiredFeatures.length > 0) {
      descriptor.requiredFeatures = requiredFeatures;
    }
    if (Object.keys(requiredLimits).length > 0) {
      descriptor.requiredLimits = requiredLimits;
    }
    return descriptor;
  }

  resolveChannelLimit(limits: Pick<GPUSupportedLimits, "maxUniformBufferBindingSize"> | undefined): number {
    // Logical aliases consume metadata space, not one sampler/texture each.
    const bytes = limits?.maxUniformBufferBindingSize ?? 65536;
    return Math.max(4, Math.floor((bytes - createShaderToyUniformLayout(4).size) / 48) + 4);
  }

  resolveDeviceTextureLimit(device: GPUDevice): number {
    const deviceLimit = device.limits?.maxTextureDimension2D;
    if (typeof deviceLimit === "number" && Number.isFinite(deviceLimit) && deviceLimit > 0) {
      return Math.floor(deviceLimit);
    }
    return DEFAULT_MAX_TEXTURE_DIMENSION_2D;
  }

  clampDimensionToTextureLimit(value: number): number {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) {
      return 1;
    }
    return Math.min(Math.max(1, rounded), this.maxTextureDimension2D);
  }

  clampCanvasToTextureLimit(): void {
    if (!this.host.canvas) {
      return;
    }
    this.host.canvas.width = this.clampDimensionToTextureLimit(this.host.canvas.width);
    this.host.canvas.height = this.clampDimensionToTextureLimit(this.host.canvas.height);
  }

  clampResolutionToTextureLimit(resolution: { width: number; height: number }): { width: number; height: number } {
    return {
      width: this.clampDimensionToTextureLimit(resolution.width),
      height: this.clampDimensionToTextureLimit(resolution.height),
    };
  }

  validateStorageLimits(
    storage: StorageBindingNode[],
    passes?: RenderPassNode[],
    commonCode = "",
    modules: SlangSourceModule[] = [],
  ): string[] {
    if (!this.host.device) {
      return ["WebGPU device unavailable while validating storage buffers"];
    }

    const limits = this.host.device.limits;
    const maxStorageBuffers = positiveDeviceLimit(limits?.maxStorageBuffersPerShaderStage,
      DEFAULT_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE);
    const maxStorageBufferSize = positiveDeviceLimit(limits?.maxStorageBufferBindingSize,
      DEFAULT_MAX_STORAGE_BUFFER_BINDING_SIZE);
    const errors: string[] = [];
    const selections = passes?.map(pass => ({
      name: pass.name,
      storage: resolvePassStorage(storage, pass.source, pass.vertexSrc ?? "", commonCode,
        ...modules.filter(module => module.ownerPass === pass.name).map(module => module.source)),
    })) ?? [{ name: "Storage config", storage }];
    for (const selection of selections) {
      if (selection.storage.length > maxStorageBuffers) {
        errors.push(`${selection.name}: uses ${selection.storage.length} storage buffers, but the device ` +
          `maxStorageBuffersPerShaderStage limit is ${maxStorageBuffers}; ` +
          "pack related buffers into structs to reduce the buffer count");
      }
    }
    const maxBufferSize = positiveDeviceLimit(limits?.maxBufferSize, DEFAULT_MAX_BUFFER_SIZE);
    for (const node of storage) {
      const byteSize = storageBufferByteSize(node);
      if (!Number.isSafeInteger(byteSize) || byteSize > maxBufferSize) {
        errors.push(`Storage ${node.name} requires ${byteSize} bytes, but the device ` +
          `maxBufferSize limit is ${maxBufferSize} bytes ` +
          `(maxStorageBufferBindingSize: ${maxStorageBufferSize} bytes)`);
      }
      if (byteSize > maxStorageBufferSize) {
        errors.push(
          `Storage ${node.name} requires ${byteSize} bytes, but the device ` +
          `maxStorageBufferBindingSize limit is ${maxStorageBufferSize} bytes; ` +
          "reduce its size or pack related data into structs",
        );
      }
    }
    if (errors.length > 0) {
      return errors;
    }

    return [];
  }

  resolveComputeWorkgroupLimit(): number {
    const grantedLimit = this.host.device?.limits?.maxComputeWorkgroupsPerDimension;
    return typeof grantedLimit === "number" && Number.isFinite(grantedLimit) && grantedLimit > 0
      ? Math.floor(grantedLimit)
      : DEFAULT_MAX_COMPUTE_WORKGROUPS_PER_DIMENSION;
  }

  resolveComputeWorkgroupLimits(): ComputeWorkgroupLimits {
    const limits = this.host.device?.limits;
    const resolve = (value: number | undefined, fallback: number): number => (
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback
    );
    return {
      maxInvocations: resolve(
        limits?.maxComputeInvocationsPerWorkgroup,
        DEFAULT_MAX_COMPUTE_INVOCATIONS_PER_WORKGROUP,
      ),
      maxSizeX: resolve(limits?.maxComputeWorkgroupSizeX, DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_X),
      maxSizeY: resolve(limits?.maxComputeWorkgroupSizeY, DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Y),
      maxSizeZ: resolve(limits?.maxComputeWorkgroupSizeZ, DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Z),
    };
  }

  wgslImageFormat(gpuFormat: GPUTextureFormat): "rgba16f" | "rgba32f" {
    return gpuFormat === "rgba32float" ? "rgba32f" : "rgba16f";
  }

  resolveMaxOutputLayers(): number {
    const grantedLimit = this.host.device?.limits?.maxTextureArrayLayers;
    return typeof grantedLimit === "number" && Number.isFinite(grantedLimit) && grantedLimit > 0
      ? Math.floor(grantedLimit)
      : DEFAULT_MAX_TEXTURE_ARRAY_LAYERS;
  }

  validateStaticComputeDispatchLimits(
    passes: RenderPassNode[],
    storage: StorageBindingNode[],
  ): string[] {
    const storageLayouts = new Map(storage.map((node) => [node.name, node]));
    const limit = this.resolveComputeWorkgroupLimit();
    const errors: string[] = [];
    for (const pass of passes) {
      if (pass.kind !== "compute" || pass.dispatch?.mode === "cover-channel") {
        continue;
      }
      const counts = resolveWorkgroupCounts(pass, storageLayouts, []);
      if (counts) {
        const error = validateWorkgroupCounts(pass.name, counts, limit);
        if (error) {
          errors.push(error);
        }
      }
    }
    return errors;
  }
}
