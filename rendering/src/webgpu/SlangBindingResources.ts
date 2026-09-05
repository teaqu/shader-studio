/// <reference types="@webgpu/types" />
import type { SlangBindingPlan } from "./SlangBindingPlan";
import type { SlangChannelResource } from "./SlangPassPipeline";

export function slangChannelLayoutEntries(plan: SlangBindingPlan, visibility: GPUShaderStageFlags): GPUBindGroupLayoutEntry[] {
  return [
    ...plan.textures.map(({ binding, kind }) => ({ binding, visibility, texture: {
      sampleType: "float" as const, ...(kind === "cubemap" ? { viewDimension: "cube" as const } : {}),
    } })),
    ...plan.samplers.map(({ binding }) => ({ binding, visibility, sampler: { type: "filtering" as const } })),
  ].sort((a, b) => a.binding - b.binding);
}

/** Require every logical channel, including aliases, before binding a pass. */
export function slangChannelResourceEntries(plan: SlangBindingPlan, resources: readonly SlangChannelResource[], fallback: GPUSampler | null): GPUBindGroupEntry[] | null {
  const bySlot = new Map(resources.map(resource => [resource.slot, resource]));
  if (plan.channels.some(channel => !bySlot.has(channel.slot))) {
    return null;
  }
  const entries: GPUBindGroupEntry[] = [];
  for (const { binding, slot } of plan.textures) {
    entries.push({ binding, resource: bySlot.get(slot)!.textureView });
  }
  for (const { binding, slot } of plan.samplers) {
    const sampler = bySlot.get(slot)!.sampler ?? fallback;
    if (!sampler) {
      return null;
    }
    entries.push({ binding, resource: sampler });
  }
  return entries.sort((a, b) => a.binding - b.binding);
}
