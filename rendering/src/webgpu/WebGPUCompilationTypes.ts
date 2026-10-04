import type { ShaderConfig,SlangSourceModule } from "@shader-studio/types";
import { ResourceManager } from "../resources/ResourceManager";
import type { StorageBindingNode } from "../types/PassGraph";
import { SlangComputePipeline } from "./SlangComputePipeline";
import {
  SlangPassPipeline
} from "./SlangPassPipeline";
import { type WebGPUTextureHandle } from "./WebGPUTextureBackend";
export interface SlangAssetUrls {
  scriptUrl: string;
  wasmUrl: string;
  /** URL of the compiled slangCompileWorker chunk; absent → main-thread compile. */
  workerUrl?: string;
  /** Emit Slang timing diagnostics to the webview console. */
  debugTimings?: boolean;
}

export interface BlobAssetUrl {
  url: string;
  fetchMs: number;
  blobMs: number;
}

export interface PassTiming {
  name: string;
  cacheHit: boolean;
  wgslCacheHit?: boolean;
  totalMs?: number;
  slangMs?: number;
  pipelineMs?: number;
  errorCount?: number;
}

export interface PreparedStorageBuffers {
  generation: number;
  buffers: Map<string, GPUBuffer>;
  keys: Map<string, string>;
  layouts: Map<string, StorageBindingNode>;
  stagedBuffers: GPUBuffer[];
  borrowedResetBuffers: Set<GPUBuffer>;
  settled: boolean;
}

export interface PendingReset {
  generation: number;
  storageBuffers: Map<string, GPUBuffer>;
  storageKeys: Map<string, string>;
}

export interface PendingPipelineCandidates {
  generation: number;
  render: Set<SlangPassPipeline>;
  compute: Set<SlangComputePipeline>;
  resourceManager: ResourceManager<WebGPUTextureHandle> | null;
  resourceLoadsPending: number;
  resourceManagerDisposed: boolean;
  installed: boolean;
  settled: boolean;
}

export interface ShaderCompileSnapshot {
  code: string;
  config: ShaderConfig | null;
  path: string;
  buffers: Record<string, string>;
  customUniformDeclarations?: string;
  customUniformInfo?: { name: string; type: string }[];
  slangModules: SlangSourceModule[];
  slangSourcePath?: string;
  slangSourcePaths?: Record<string, string>;
}
