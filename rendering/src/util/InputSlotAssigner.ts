import { resolveGlslInputBindings, type GlslInputLike } from "@shader-studio/types";
import type { ChannelSamplerType } from "../webgl/ShaderCompiler";

export interface SlotAssignment {
  slot: number;
  key: string;
  isCustomName: boolean;
}

/**
 * Assigns texture unit slots to input channel keys.
 *
 * All keys are assigned slots sequentially in insertion order.
 * iChannel{N} names have no special slot pinning — they're just
 * default names. The iChannel{N} uniforms in the shader always
 * refer to slot N regardless of config key names.
 *
 * isCustomName is true when the key doesn't match its slot's
 * natural iChannel{N} name (i.e. it needs an alias uniform).
 *
 * No hard limit; the GPU will enforce its own texture unit count.
 */
export function assignInputSlots(inputs: Readonly<Record<string, GlslInputLike>>): SlotAssignment[] {
  return resolveGlslInputBindings(inputs).map(({ slot, key, isCustomName }) => ({
    slot,
    key,
    isCustomName,
  }));
}

/**
 * Sampler type per slot, so declarations match the resources actually bound.
 * A cubemap slot declared as sampler2D makes every texture() call against it
 * fail to compile, which is why render and variable capture must agree here.
 */
export function resolveChannelSamplerTypes(
  inputs: Readonly<Record<string, GlslInputLike>>,
  slotAssignments: SlotAssignment[] = assignInputSlots(inputs),
): ChannelSamplerType[] {
  const channelCount = Math.max(4, slotAssignments.length);
  const types: ChannelSamplerType[] = new Array(channelCount).fill('2D');

  for (const { slot, key } of slotAssignments) {
    if (inputs[key]?.type === 'cubemap') {
      types[slot] = 'Cube';
    }
  }

  return types;
}
