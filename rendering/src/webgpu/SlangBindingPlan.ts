import type { RenderPassChannel } from "../types/PassGraph";

export interface SlangBindingChannel {
  slot: number;
  key: string;
  kind?: string;
  textureIdentity?: string;
  samplerIdentity?: string;
}

/** Stable source identities, never transient GPU views (fallbacks and feedback can change). */
export function getSlangTextureIdentity(channel: RenderPassChannel): string {
  if (channel.kind === "buffer") {
    return JSON.stringify([channel.kind, channel.source, channel.readFrom, channel.layer ?? 0]);
  }
  if (channel.kind === "keyboard") {
    return "keyboard";
  }
  if (channel.kind === "audio") {
    return JSON.stringify([channel.kind, channel.path]);
  }
  return JSON.stringify([
    channel.kind, channel.path, getSlangSamplerSettings(channel).filter === "mipmap",
    channel.vflip ?? (channel.kind !== "cubemap"),
    channel.kind === "texture" ? channel.grayscale ?? false : false,
  ]);
}

export function getSlangSamplerSettings(channel: RenderPassChannel): { filter: "nearest" | "linear" | "mipmap"; wrap: "clamp" | "repeat" } {
  if (channel.kind === "buffer" || channel.kind === "audio") {
    return { filter: "linear", wrap: "clamp" };
  }
  if (channel.kind === "keyboard") {
    return { filter: "nearest", wrap: "clamp" };
  }
  if (channel.kind === "video") {
    return { filter: channel.filter ?? "linear", wrap: channel.wrap ?? "clamp" };
  }
  return { filter: channel.filter ?? "mipmap", wrap: channel.wrap ?? (channel.kind === "cubemap" ? "clamp" : "repeat") };
}

export function getSlangChannels(channels: readonly RenderPassChannel[]) {
  return channels.map(channel => ({
    slot: channel.slot, key: channel.key, kind: channel.kind,
    textureIdentity: getSlangTextureIdentity(channel),
    samplerIdentity: JSON.stringify(getSlangSamplerSettings(channel)),
  }));
}

export function buildSlangBindingPlan(channels: readonly SlangBindingChannel[]) {
  let nextBinding = 1;
  const textures: Array<{ binding: number; slot: number; kind?: string }> = [];
  const samplers: Array<{ binding: number; slot: number }> = [];
  const textureBindings = new Map<string, number>();
  const samplerBindings = new Map<string, number>();
  const bindings = [...channels].sort((a, b) => a.slot - b.slot).map(channel => {
    const textureKey = JSON.stringify([channel.kind === "cubemap" ? "cube" : "2d", channel.textureIdentity ?? { slot: channel.slot }]);
    const samplerKey = channel.samplerIdentity ?? `slot:${channel.slot}`;
    let textureBinding = textureBindings.get(textureKey);
    if (textureBinding === undefined) {
      textureBinding = nextBinding++;
      textureBindings.set(textureKey, textureBinding);
      textures.push({ binding: textureBinding, slot: channel.slot, kind: channel.kind });
    }
    let samplerBinding = samplerBindings.get(samplerKey);
    if (samplerBinding === undefined) {
      samplerBinding = nextBinding++;
      samplerBindings.set(samplerKey, samplerBinding);
      samplers.push({ binding: samplerBinding, slot: channel.slot });
    }
    return { ...channel, textureBinding, samplerBinding };
  });
  return { channels: bindings, textures, samplers, nextBinding };
}

export type SlangBindingPlan = ReturnType<typeof buildSlangBindingPlan>;

export function validateSlangBindingBudget(
  passName: string,
  plan: SlangBindingPlan,
  limits: {
    maxSampledTexturesPerShaderStage?: number;
    maxSamplersPerShaderStage?: number;
    maxBindingsPerBindGroup?: number;
    maxUniformBufferBindingSize?: number;
  } | undefined,
  extraBindings: number,
  uniformBufferSize: number,
): void {
  for (const [resource, count, limit] of [
    ["sampled textures", plan.textures.length, limits?.maxSampledTexturesPerShaderStage ?? 16],
    ["samplers", plan.samplers.length, limits?.maxSamplersPerShaderStage ?? 16],
    ["bindings", plan.nextBinding + extraBindings, limits?.maxBindingsPerBindGroup ?? 1000],
    ["uniform bytes", uniformBufferSize, limits?.maxUniformBufferBindingSize ?? 65536],
  ] as const) {
    if (count > limit) {
      throw new Error(`${passName}: ${count} ${resource} required after deduplication; device limit is ${limit}`);
    }
  }
}
