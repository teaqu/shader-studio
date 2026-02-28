import { describe, it, expect } from "vitest";
import { assignInputSlots } from "../../util/InputSlotAssigner";

describe("assignInputSlots", () => {
  it("returns empty array for empty inputs", () => {
    expect(assignInputSlots({})).toEqual([]);
  });

  it("assigns keys sequentially in insertion order", () => {
    const result = assignInputSlots({
      iChannel0: { type: "texture" },
      iChannel1: { type: "buffer" },
      iChannel2: { type: "keyboard" },
      iChannel3: { type: "texture" },
    });
    expect(result).toEqual([
      { slot: 0, key: "iChannel0", isCustomName: false },
      { slot: 1, key: "iChannel1", isCustomName: false },
      { slot: 2, key: "iChannel2", isCustomName: false },
      { slot: 3, key: "iChannel3", isCustomName: false },
    ]);
  });

  it("assigns custom names to sequential slots", () => {
    const result = assignInputSlots({
      noiseMap: { type: "texture" },
      prevFrame: { type: "buffer" },
    });
    expect(result).toEqual([
      { slot: 0, key: "noiseMap", isCustomName: true },
      { slot: 1, key: "prevFrame", isCustomName: true },
    ]);
  });

  it("assigns all keys sequentially regardless of iChannel names", () => {
    const result = assignInputSlots({
      noiseMap: { type: "texture" },
      iChannel2: { type: "keyboard" },
      prevFrame: { type: "buffer" },
    });
    // No pinning — iChannel2 gets slot 1 (second in insertion order)
    expect(result).toEqual([
      { slot: 0, key: "noiseMap", isCustomName: true },
      { slot: 1, key: "iChannel2", isCustomName: true },
      { slot: 2, key: "prevFrame", isCustomName: true },
    ]);
  });

  it("marks isCustomName correctly based on slot position", () => {
    // iChannel0 at slot 0 → not custom, iChannel3 at slot 1 → custom
    const result = assignInputSlots({
      iChannel0: { type: "texture" },
      iChannel3: { type: "texture" },
      myTex: { type: "texture" },
    });
    expect(result).toEqual([
      { slot: 0, key: "iChannel0", isCustomName: false },
      { slot: 1, key: "iChannel3", isCustomName: true },
      { slot: 2, key: "myTex", isCustomName: true },
    ]);
  });

  it("limits to 16 channels total", () => {
    const inputs: Record<string, any> = {};
    for (let i = 0; i < 20; i++) {
      inputs[`tex${i}`] = { type: "texture" };
    }
    const result = assignInputSlots(inputs);
    expect(result).toHaveLength(16);
    expect(result[15].slot).toBe(15);
  });

  it("assigns all 16 slots sequentially for large input sets", () => {
    const inputs: Record<string, any> = {};
    inputs.iChannel5 = { type: "texture" };
    inputs.iChannel10 = { type: "texture" };
    for (let i = 0; i < 14; i++) {
      inputs[`custom${i}`] = { type: "texture" };
    }
    const result = assignInputSlots(inputs);
    expect(result).toHaveLength(16);
    // iChannel5 is first key → slot 0
    expect(result[0]).toEqual({ slot: 0, key: "iChannel5", isCustomName: true });
    // iChannel10 is second key → slot 1
    expect(result[1]).toEqual({ slot: 1, key: "iChannel10", isCustomName: true });
  });

  it("treats iChannel names beyond 15 as custom names at their assigned slot", () => {
    const result = assignInputSlots({
      iChannel16: { type: "texture" },
      iChannel99: { type: "texture" },
    });
    // They're just custom names assigned to slots 0 and 1
    expect(result).toEqual([
      { slot: 0, key: "iChannel16", isCustomName: true },
      { slot: 1, key: "iChannel99", isCustomName: true },
    ]);
  });

  it("single iChannel0 at slot 0 is not a custom name", () => {
    const result = assignInputSlots({
      iChannel0: { type: "texture" },
    });
    expect(result).toEqual([
      { slot: 0, key: "iChannel0", isCustomName: false },
    ]);
  });

  it("iChannel name matching is slot-based", () => {
    // iChannel1 at slot 0 is custom, iChannel0 at slot 1 is custom
    const result = assignInputSlots({
      iChannel1: { type: "texture" },
      iChannel0: { type: "texture" },
    });
    expect(result).toEqual([
      { slot: 0, key: "iChannel1", isCustomName: true },
      { slot: 1, key: "iChannel0", isCustomName: true },
    ]);
  });

  it("works with the example from the plan", () => {
    const result = assignInputSlots({
      noiseMap: { type: "texture", path: "noise.png" },
      prevFrame: { type: "buffer", source: "BufferA" },
      iChannel2: { type: "keyboard" },
    });
    expect(result).toEqual([
      { slot: 0, key: "noiseMap", isCustomName: true },
      { slot: 1, key: "prevFrame", isCustomName: true },
      { slot: 2, key: "iChannel2", isCustomName: false },
    ]);
  });
});
