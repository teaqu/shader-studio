export interface SlotAssignment {
  slot: number;
  key: string;
  isCustomName: boolean;
}

const MAX_CHANNELS = 16;

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
export function assignInputSlots(inputs: Record<string, any>): SlotAssignment[] {
  const keys = Object.keys(inputs);
  const assignments: SlotAssignment[] = [];

  for (let i = 0; i < keys.length && i < MAX_CHANNELS; i++) {
    const key = keys[i];
    assignments.push({
      slot: i,
      key,
      isCustomName: key !== `iChannel${i}`,
    });
  }

  return assignments;
}
