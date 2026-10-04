/// <reference types="@webgpu/types" />
import type { SlangChannelResource } from '../webgpu/SlangPassPipeline';
import type { StorageBindingNode } from '../types/PassGraph';

const U = globalThis.GPUBufferUsage ?? { COPY_SRC: 4, COPY_DST: 8, STORAGE: 128 } as typeof GPUBufferUsage;
const T = globalThis.GPUTextureUsage ?? { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4 } as typeof GPUTextureUsage;

/** Enqueues deep copies before any asynchronous pipeline work begins. */
export function cloneWgslTraceStorage(
  device: GPUDevice,
  nodes: readonly StorageBindingNode[],
  source: ReadonlyMap<string, GPUBuffer>,
  owned: GPUBuffer[],
): Map<string, GPUBuffer> {
  const copies = new Map<string, GPUBuffer>();
  const encoder = device.createCommandEncoder();
  try {
    for (const node of nodes) {
      const size = Math.ceil(node.count * node.stride / 4) * 4;
      const live = source.get(node.name);
      if (!live) {
        throw new Error(`Missing live storage buffer '${node.name}' for trace.`);
      }
      const copy = device.createBuffer({ size, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST });
      owned.push(copy); copies.set(node.name, copy);
      encoder.copyBufferToBuffer(live, 0, copy, 0, size);
    }
    if (nodes.length) {
      device.queue.submit([encoder.finish()]);
    }
    return copies;
  } catch (error) {
    for (const buffer of owned.splice(owned.length - copies.size)) {
      buffer.destroy();
    }
    throw error;
  }
}

/** Copies every mip and deduplicates aliases of the same texture. */
export function cloneWgslTraceChannels(
  device: GPUDevice,
  resources: readonly SlangChannelResource[],
  owned: GPUTexture[],
): SlangChannelResource[] {
  const clones = new Map<GPUTexture, GPUTexture>();
  const encoder = device.createCommandEncoder();
  try {
    const copied = resources.map(resource => {
      const source = resource.texture;
      if (!source) {
        throw new Error(`Channel ${resource.slot} is not a frozen texture snapshot.`);
      }
      let texture = clones.get(source);
      if (!texture) {
        texture = device.createTexture({
          size: { width: source.width, height: source.height, depthOrArrayLayers: source.depthOrArrayLayers },
          format: source.format, dimension: source.dimension, mipLevelCount: source.mipLevelCount,
          sampleCount: source.sampleCount, usage: T.TEXTURE_BINDING | T.COPY_DST | T.COPY_SRC,
        });
        for (let mip = 0; mip < source.mipLevelCount; mip++) {
          encoder.copyTextureToTexture({ texture: source, mipLevel: mip }, { texture, mipLevel: mip }, {
            width: Math.max(1, source.width >> mip), height: Math.max(1, source.height >> mip), depthOrArrayLayers: source.depthOrArrayLayers,
          });
        }
        clones.set(source, texture); owned.push(texture);
      }
      return { ...resource, texture, textureView: texture.createView(resource.layer === undefined
        ? { dimension: source.depthOrArrayLayers === 6 ? 'cube' : '2d' }
        : { dimension: '2d', baseArrayLayer: resource.layer, arrayLayerCount: 1 }) };
    });
    if (resources.length) {
      device.queue.submit([encoder.finish()]);
    }
    return copied;
  } catch (error) {
    for (const texture of owned.splice(owned.length - clones.size)) {
      texture.destroy();
    }
    throw error;
  }
}
