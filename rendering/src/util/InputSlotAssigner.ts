import { resolveGlslInputBindings, type GlslInputLike } from "@shader-studio/types";

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
 * Max 16 total; excess keys are dropped.
 */
export function assignInputSlots(inputs: Readonly<Record<string, GlslInputLike>>): SlotAssignment[] {
  return resolveGlslInputBindings(inputs).map(({ slot, key, isCustomName }) => ({
    slot,
    key,
    isCustomName,
  }));
}
