/// <reference types="@webgpu/types" />
import type { StorageBindingNode } from "../types/PassGraph";
import type { SlangChannelBinding } from "./SlangPrelude";
import { buildSlangBindingPlan } from "./SlangBindingPlan";
import { slangChannelLayoutEntries, slangChannelResourceEntries } from "./SlangBindingResources";
import { captureUniformBindingIndex, nativeMeshBindingIndex } from "./NativeCaptureMeshBinding";

export function captureBindGroupLayoutEntries(
  channels: SlangChannelBinding[], storage: StorageBindingNode[], nativeRaster: boolean, nativeMesh: boolean,
): GPUBindGroupLayoutEntry[] {
  const FRAGMENT = globalThis.GPUShaderStage?.FRAGMENT ?? 0x2;
  const VERTEX = globalThis.GPUShaderStage?.VERTEX ?? 0x1;
  const stageVisibility = nativeRaster ? VERTEX | FRAGMENT : FRAGMENT;
  const entries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: VERTEX | FRAGMENT, buffer: { type: "uniform" } }];
  const plan = buildSlangBindingPlan(channels);
  entries.push(...slangChannelLayoutEntries(plan, stageVisibility));
  const storageBaseBinding = plan.nextBinding;
  for (const node of storage) {
    entries.push({
      binding: storageBaseBinding + node.binding,
      // WebGPU does not permit read-write storage in a vertex stage. Native
      // capture vertices can still read storage; atomic/debug writes belong
      // solely to the instrumented fragment invocation.
      visibility: node.containsAtomic ? FRAGMENT : stageVisibility,
      buffer: { type: node.containsAtomic ? "storage" : "read-only-storage" },
    });
  }
  if (nativeMesh) {
    entries.push({ binding: nativeMeshBindingIndex(storageBaseBinding, storage.length), visibility: stageVisibility, buffer: { type: "uniform" } });
  }
  entries.push({ binding: captureUniformBindingIndex(storageBaseBinding, storage.length, nativeMesh), visibility: stageVisibility, buffer: { type: "uniform" } });
  return entries;
}

export function createCaptureBindGroup(
  device: GPUDevice, layout: GPUBindGroupLayout, channels: SlangChannelBinding[],
  channelResources: Array<{ slot: number; textureView: GPUTextureView; sampler?: GPUSampler }>,
  storage: StorageBindingNode[], storageBuffers: Map<string, GPUBuffer>, sampler: GPUSampler | null,
  uniformBuffer: GPUBuffer | null, captureUniformBuffer: GPUBuffer | null,
  meshUniformBuffer: GPUBuffer | undefined, nativeMesh: boolean,
): { group?: GPUBindGroup; error?: string } {
  if (!uniformBuffer || !captureUniformBuffer) {
    return { error: "Capture uniform buffers are not resolvable yet" };
  }
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: uniformBuffer } }];
  const plan = buildSlangBindingPlan(channels);
  const channelEntries = slangChannelResourceEntries(plan, channelResources, sampler);
  if (!channelEntries) {
    return { error: "Capture channel resources are not resolvable yet" };
  }
  entries.push(...channelEntries);
  const storageBaseBinding = plan.nextBinding;
  for (const node of storage) {
    entries.push({ binding: storageBaseBinding + node.binding, resource: { buffer: storageBuffers.get(node.name)! } });
  }
  if (nativeMesh) {
    if (!meshUniformBuffer) {
      return { error: "Native mesh capture uniform snapshot is not resolvable yet" };
    }
    entries.push({ binding: nativeMeshBindingIndex(storageBaseBinding, storage.length), resource: { buffer: meshUniformBuffer } });
  }
  entries.push({ binding: captureUniformBindingIndex(storageBaseBinding, storage.length, nativeMesh), resource: { buffer: captureUniformBuffer } });
  try {
    return { group: device.createBindGroup({ layout, entries }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
