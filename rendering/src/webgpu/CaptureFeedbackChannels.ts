import type { CaptureCompileContext } from "../capture/VariableCapturer";
import type { RenderPassNode } from "../types/PassGraph";
import type { SlangChannelResource, SlangPassPipeline } from "./SlangPassPipeline";
import type { RenderedCaptureBufferInput } from "./RenderedCaptureState";

/** Copy render-buffer channels before compilation can yield to another live frame. */
export function captureFeedbackChannels(
  device: GPUDevice, pass: RenderPassNode, pipelines: ReadonlyMap<string, SlangPassPipeline>, resources: SlangChannelResource[] | null,
  drawnInputs?: ReadonlyMap<number, RenderedCaptureBufferInput>,
): ReturnType<NonNullable<CaptureCompileContext["captureChannelSnapshot"]>> {
  if (!resources) {
    return null;
  }
  const copies = new Map<GPUTexture, Map<number, GPUTexture>>();
  try {
    const encoder = device.createCommandEncoder({ label: "variable-capture feedback snapshot" });
    const frozen = resources.map(resource => {
      const channel = pass.channels.find(candidate => candidate.slot === resource.slot);
      if (channel?.kind !== "buffer") {
        return resource;
      }
      const pipeline = pipelines.get(channel.source);
      const drawn = drawnInputs?.get(resource.slot);
      const source = drawn?.texture ?? (channel.readFrom === "previous-frame"
        ? pipeline?.getPreviousOutputTexture(channel.output ?? 0)
        : pipeline?.getCurrentOutputTexture(channel.output ?? 0));
      if (!source) {
        return resource;
      }
      const layer = drawn?.layer ?? 0;
      let layers = copies.get(source);
      if (!layers) {
        layers = new Map();
        copies.set(source, layers);
      }
      let texture = layers.get(layer);
      if (!texture) {
        texture = allocateChannelSnapshot(device, source, `${channel.source}[${channel.output ?? 0}]`);
        layers.set(layer, texture);
        encoder.copyTextureToTexture(
          { texture: source, ...(drawn?.layer !== undefined ? { origin: { z: drawn.layer } } : {}) },
          { texture }, { width: source.width, height: source.height },
        );
      }
      return { ...resource, textureView: texture.createView() };
    });
    if (copies.size > 0) {
      device.queue.submit([encoder.finish()]);
    }
    return { resources: frozen, textureCount: [...copies.values()].reduce((count, layers) => count + layers.size, 0), destroy: () => {
      for (const layers of copies.values()) {
        for (const texture of layers.values()) {
          texture.destroy();
        }
      }
    } };
  } catch (error) {
    for (const layers of copies.values()) {
      for (const texture of layers.values()) {
        texture.destroy();
      }
    }
    throw error;
  }
}

function allocateChannelSnapshot(device: GPUDevice, source: GPUTexture, label: string): GPUTexture {
  return device.createTexture({
    label: `variable-capture feedback snapshot: ${label}`,
    size: { width: source.width, height: source.height }, format: source.format,
    usage: (globalThis.GPUTextureUsage?.TEXTURE_BINDING ?? 0x04) | (globalThis.GPUTextureUsage?.COPY_DST ?? 0x02),
  });
}
