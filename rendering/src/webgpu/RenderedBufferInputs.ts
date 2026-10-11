import type { RenderPassChannel } from "../types/PassGraph";
import type { SlangPassPipeline } from "./SlangPassPipeline";
import type { SlangComputePipeline } from "./SlangComputePipeline";
import type { RenderedCaptureBufferInput } from "./RenderedCaptureState";

/** Retain the textures actually bound for this draw, before feedback banks swap. */
export function renderedBufferInputs(
  channels: RenderPassChannel[],
  renderPipelines: ReadonlyMap<string, Pick<SlangPassPipeline, "getCurrentOutputTexture" | "getPreviousOutputTexture">>,
  computePipelines: ReadonlyMap<string, Pick<SlangComputePipeline, "getCurrentOutputTexture" | "getPreviousOutputTexture">>,
  encodedComputePasses: ReadonlySet<string>,
): Map<number, RenderedCaptureBufferInput> {
  const inputs = new Map<number, RenderedCaptureBufferInput>();
  for (const channel of channels) {
    if (channel.kind !== "buffer") {
      continue;
    }
    const compute = computePipelines.get(channel.source);
    const render = renderPipelines.get(channel.source);
    const texture = compute
      ? channel.readFrom === "previous-frame" || !encodedComputePasses.has(channel.source)
        ? compute.getPreviousOutputTexture() : compute.getCurrentOutputTexture()
      : channel.readFrom === "previous-frame"
        ? render?.getPreviousOutputTexture(channel.output ?? 0) : render?.getCurrentOutputTexture(channel.output ?? 0);
    if (texture) {
      inputs.set(channel.slot, { texture, ...(compute ? { layer: channel.layer ?? 0 } : {}) });
    }
  }
  return inputs;
}
