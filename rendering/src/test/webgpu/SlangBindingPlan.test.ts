import { describe, expect, it } from "vitest";
import { buildSlangBindingPlan, getSlangChannels, getSlangSamplerSettings, validateSlangBindingBudget } from "../../webgpu/SlangBindingPlan";

describe("Slang binding plan", () => {
  it("normalizes effective defaults separately for each input kind", () => {
    expect(getSlangSamplerSettings({ kind: "video", key: "a", slot: 0, path: "a" })).toEqual({ filter: "linear", wrap: "clamp" });
    expect(getSlangSamplerSettings({ kind: "texture", key: "a", slot: 0, path: "a" })).toEqual({ filter: "mipmap", wrap: "repeat" });
    expect(getSlangSamplerSettings({ kind: "cubemap", key: "a", slot: 0, path: "a" })).toEqual({ filter: "mipmap", wrap: "clamp" });
    expect(getSlangSamplerSettings({ kind: "keyboard", key: "a", slot: 0 })).toEqual({ filter: "nearest", wrap: "clamp" });
    expect(getSlangSamplerSettings({ kind: "audio", key: "a", slot: 0, path: "a" })).toEqual({ filter: "linear", wrap: "clamp" });
  });

  it("checks independent unique-resource budgets including trailing bindings and metadata", () => {
    const plan = buildSlangBindingPlan(getSlangChannels([
      { kind: "texture", slot: 0, key: "a", path: "a" },
      { kind: "texture", slot: 1, key: "b", path: "a", wrap: "clamp" },
      { kind: "texture", slot: 2, key: "c", path: "b" },
    ]));
    expect(() => validateSlangBindingBudget("Image", plan, undefined, 2, 512)).not.toThrow();
    expect(() => validateSlangBindingBudget("Image", plan, { maxSampledTexturesPerShaderStage: 2, maxSamplersPerShaderStage: 2, maxBindingsPerBindGroup: 7, maxUniformBufferBindingSize: 512 }, 2, 512)).not.toThrow();
    expect(() => validateSlangBindingBudget("Image", plan, { maxSampledTexturesPerShaderStage: 1 }, 2, 512)).toThrow("Image: 2 sampled textures required after deduplication; device limit is 1");
    expect(() => validateSlangBindingBudget("Image", plan, { maxSamplersPerShaderStage: 1 }, 2, 512)).toThrow("2 samplers");
    expect(() => validateSlangBindingBudget("Image", plan, { maxBindingsPerBindGroup: 6 }, 2, 512)).toThrow("7 bindings");
    expect(() => validateSlangBindingBudget("Image", plan, { maxUniformBufferBindingSize: 511 }, 2, 512)).toThrow("512 uniform bytes");
  });

  it("shares samplers across distinct textures", () => {
    const plan = buildSlangBindingPlan(getSlangChannels(Array.from({ length: 24 }, (_, slot) => ({
      kind: "texture" as const, slot, key: `tex${slot}`, path: `image${slot}.png`,
    }))));
    expect(plan.textures).toHaveLength(24);
    expect(plan.samplers).toHaveLength(1);
    expect(plan.nextBinding).toBe(26);
  });
  it("shares repeated sources but preserves feedback timing, layer and sampling settings", () => {
    const plan = buildSlangBindingPlan(getSlangChannels([
      { kind: "buffer", slot: 0, key: "a", source: "Buffer", readFrom: "previous-frame" },
      { kind: "buffer", slot: 3, key: "b", source: "Buffer", readFrom: "previous-frame", layer: 0 },
      { kind: "buffer", slot: 4, key: "c", source: "Buffer", readFrom: "current-frame" },
      { kind: "buffer", slot: 5, key: "d", source: "Buffer", readFrom: "previous-frame", layer: 1 },
    ]));
    expect(plan.textures).toHaveLength(3);
    expect(plan.samplers).toHaveLength(1);
    expect(plan.channels[1].textureBinding).toBe(plan.channels[0].textureBinding);
  });
  it("keeps upload variants separate while sharing one texture with different wrap", () => {
    const plan = buildSlangBindingPlan(getSlangChannels([
      { kind: "texture", slot: 0, key: "a", path: "a.png" },
      { kind: "texture", slot: 1, key: "b", path: "a.png", wrap: "clamp" },
      { kind: "texture", slot: 2, key: "c", path: "a.png", vflip: false },
      { kind: "cubemap", slot: 3, key: "d", path: "a.png" },
    ]));
    expect(plan.textures).toHaveLength(3);
    expect(plan.samplers).toHaveLength(2);
  });
  it("retains legacy independent bindings for unspecified identities and sorts sparse slots", () => {
    const plan = buildSlangBindingPlan([{ slot: 5, key: "b" }, { slot: 1, key: "a" }]);
    expect(plan.channels.map(c => [c.slot, c.textureBinding, c.samplerBinding])).toEqual([[1, 1, 2], [5, 3, 4]]);
    expect(plan.nextBinding).toBe(5);
    expect(buildSlangBindingPlan([]).nextBinding).toBe(1);
  });
});
