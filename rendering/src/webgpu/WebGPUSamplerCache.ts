/// <reference types="@webgpu/types" />
import type { TextureFilter, TextureWrap } from "../resources/TextureBackend";

const caches = new WeakMap<GPUDevice, Map<string, GPUSampler>>();

/** Device ownership prevents reuse after device loss and across rendering engines. */
export function getWebGPUSampler(device: GPUDevice, filter: TextureFilter, wrap: TextureWrap): GPUSampler {
  let cache = caches.get(device);
  if (!cache) {
    cache = new Map(); caches.set(device, cache); 
  }
  const key = `${filter}:${wrap}`;
  let sampler = cache.get(key);
  if (!sampler) {
    const mode = wrap === "clamp" ? "clamp-to-edge" : "repeat";
    sampler = device.createSampler({
      magFilter: filter === "nearest" ? "nearest" : "linear",
      minFilter: filter === "nearest" ? "nearest" : "linear",
      addressModeU: mode,
      addressModeV: mode,
      ...(filter === "mipmap" ? { mipmapFilter: "linear" as const } : {}),
    });
    cache.set(key, sampler);
  }
  return sampler;
}
