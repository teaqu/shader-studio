import type { StorageBindingNode } from "../types/PassGraph";
import { renderPipelineStateKey,verticesSpace } from "../types/Geometry";
import { buildSlangBindingPlan,getSlangChannels } from "./SlangBindingPlan";
import {
  type RenderPassNode
} from "./SlangPassGraph";

const SLANG_WGSL_CACHE_KEY_VERSION = 3;

const SLANG_PIPELINE_CACHE_KEY_VERSION = 1;
export function wgslCacheKey(
  pass: RenderPassNode,
  commonCode: string,
  storage: StorageBindingNode[],
  customUniforms: { name: string; type: string }[] = [],
  modules: Array<{ moduleName: string; path: string; source: string }> = [],
): string {
  const channels = buildSlangBindingPlan(getSlangChannels(pass.channels)).channels
    .map(channel => [channel.slot, channel.key, channel.kind, channel.textureBinding, channel.samplerBinding]);
  const storageLayout = storage.map((node) => [
    node.name,
    node.elementType,
    node.builtin,
  ]);
  const hasOutput = pass.output === "texture";
  return JSON.stringify([
    SLANG_WGSL_CACHE_KEY_VERSION,
    pass.kind,
    pass.entryPoint,
    pass.source,
    pass.geometry,
    pass.vertexSrc,
    pass.geometry === "vertices" ? verticesSpace(pass) : null,
    commonCode,
    channels,
    storageLayout,
    pass.workgroupSize,
    hasOutput,
    hasOutput ? pass.outputLayers : null,
    hasOutput ? pass.resolvedOutputFormat : null,
    customUniforms,
    modules,
  ]);
}

export function pipelineCacheKey(
  pass: RenderPassNode,
  commonCode: string,
  storage: StorageBindingNode[],
  customUniforms: { name: string; type: string }[] = [],
  modules: Array<{ moduleName: string; path: string; source: string }> = [],
): string {
  const channels = buildSlangBindingPlan(getSlangChannels(pass.channels)).channels
    .map(channel => [channel.slot, channel.key, channel.kind, channel.textureBinding, channel.samplerBinding]);
  const storageLayout = storage.map((node) => [
    node.name,
    node.binding,
    node.elementType,
    node.builtin,
    node.count,
    node.stride,
  ]);
  return JSON.stringify([
    SLANG_PIPELINE_CACHE_KEY_VERSION,
    wgslCacheKey(
      pass,
      commonCode,
      storage,
      customUniforms,
      modules,
    ),
    pass.name,
    pass.kind,
    pass.width,
    pass.height,
    channels,
    storageLayout,
    pass.workgroupSize,
    pass.dispatch,
    pass.dispatchCount,
    pass.dispatchOnce,
    pass.output,
    pass.outputLayers,
    pass.resolvedOutputFormat,
    pass.kind === "render" ? renderPipelineStateKey(pass) : null,
  ]);
}

export function hasFileResources(passes: RenderPassNode[]): boolean {
  return passes.some((pass) => pass.channels.some((channel) =>
    channel.kind === "texture" || channel.kind === "video" ||
      channel.kind === "cubemap" || channel.kind === "audio"));
}

export function resourceLayoutKey(passes: RenderPassNode[]): string {
  return JSON.stringify(passes.flatMap((pass) => pass.channels.flatMap((channel) => {
    if (channel.kind === "texture") {
      return [[
        pass.name,
        channel.slot,
        channel.kind,
        channel.path,
        channel.filter,
        channel.wrap,
        channel.vflip,
        channel.grayscale,
      ]];
    }
    if (channel.kind === "video") {
      return [[
        pass.name,
        channel.slot,
        channel.kind,
        channel.path,
        channel.filter,
        channel.wrap,
        channel.vflip,
        channel.muted,
      ]];
    }
    if (channel.kind === "cubemap") {
      return [[
        pass.name,
        channel.slot,
        channel.kind,
        channel.path,
        channel.filter,
        channel.wrap,
        channel.vflip,
      ]];
    }
    if (channel.kind === "audio") {
      return [[
        pass.name,
        channel.slot,
        channel.kind,
        channel.path,
        channel.muted,
        channel.startTime,
        channel.endTime,
      ]];
    }
    return [];
  })));
}

export function prefixPassError(passName: string, error: string): string {
  return error.startsWith(`${passName}:`) ? error : `${passName}: ${error}`;
}

export function storageCacheKey(node: StorageBindingNode): string {
  return JSON.stringify([node.elementType, node.count, node.stride, node.containsAtomic === true]);
}
