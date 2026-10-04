import { KeyboardManager } from "../input/KeyboardManager";
import type { RenderPassChannel } from "../types/PassGraph";
import { getSlangSamplerSettings,getSlangTextureIdentity } from "./SlangBindingPlan";
import {
  type RenderPassNode
} from "./SlangPassGraph";
import {
  type SlangChannelResource
} from "./SlangPassPipeline";
import { getShaderToyChannelCount } from "./SlangPrelude";
import { getWebGPUSampler } from "./WebGPUSamplerCache";
import type { WebGPUShaderSession } from "./WebGPUShaderSession";
import { type WebGPUTextureHandle } from "./WebGPUTextureBackend";

interface WebGPUChannelsHost {
  session: Pick<WebGPUShaderSession, "computePipelines" | "passGraph" | "passPipelines" | "resourceManager">;
  device: GPUDevice | null;
  keyboardManager: KeyboardManager;
}

/** Owns channels state and operations; dependencies stay live across compilation swaps. */
export class WebGPUChannels {
  constructor(private readonly host: WebGPUChannelsHost) {}

  getChannelSampler(channel: RenderPassChannel): GPUSampler {
    const settings = getSlangSamplerSettings(channel);
    return getWebGPUSampler(this.host.device!, settings.filter, settings.wrap);
  }

  getChannelResources(
    pass: RenderPassNode,
    skipInputUpdates = false,
    encodedComputePasses: ReadonlySet<string> = new Set(),
    completedFrame = false,
  ): SlangChannelResource[] | null {
    const resources: SlangChannelResource[] = [];
    for (const channel of pass.channels) {
      if (channel.kind === "buffer") {
        const renderSource = this.host.session.passPipelines.get(channel.source);
        const computeSource = this.host.session.computePipelines.get(channel.source);
        const layer = channel.layer ?? 0;
        // Image-only capture redraws after the feedback targets have swapped.
        // Reverse their roles to reproduce the picture that was submitted.
        const previousRenderOutput = completedFrame
          ? channel.readFrom !== "previous-frame"
          : channel.readFrom === "previous-frame";
        const previousComputeOutput = completedFrame
          ? channel.readFrom !== "previous-frame" || !encodedComputePasses.has(channel.source)
          : channel.readFrom === "previous-frame" || !encodedComputePasses.has(channel.source);
        const textureView = computeSource
          ? previousComputeOutput
            ? computeSource.getPreviousLayerOutputView(layer)
            : computeSource.getLayerOutputView(layer)
          : previousRenderOutput
            ? renderSource?.getPreviousOutputView()
            : renderSource?.getCurrentOutputView();
        if (!textureView) {
          return null;
        }
        const size = computeSource?.getOutputSize?.() ?? renderSource?.getOutputSize?.();
        resources.push({
          slot: channel.slot,
          textureView,
          ...size,
          ...(
            channel.filter === undefined && channel.wrap === undefined && channel.samplerType !== "non-filtering"
              ? {}
              : { sampler: this.getChannelSampler(channel) }
          ),
        });
      } else if (channel.kind === "texture") {
        const handle = this.host.session.resourceManager?.getImageTextureCache()[getSlangTextureIdentity(channel)]
          ?? this.host.session.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: this.getChannelSampler(channel),
          width: handle.width,
          height: handle.height,
        });
      } else if (channel.kind === "video") {
        const handle = this.host.session.resourceManager?.getVideoTexture(channel.path)
          ?? this.host.session.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: this.getChannelSampler(channel),
          width: handle.width,
          height: handle.height,
        });
      } else if (channel.kind === "cubemap") {
        const handle = this.host.session.resourceManager?.getCubemapTexture(channel.path);
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: this.getChannelSampler(channel),
          width: handle.width,
          height: handle.height,
        });
      } else if (channel.kind === "audio") {
        const handle = this.host.session.resourceManager?.getAudioTexture(channel.path)
          ?? this.host.session.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: this.getChannelSampler(channel),
          width: handle.width,
          height: handle.height,
        });
      } else {
        const handle = this.resolveKeyboardHandle(skipInputUpdates);
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: this.getChannelSampler(channel),
          width: handle.width,
          height: handle.height,
        });
      }
    }
    return resources;
  }

  getChannelUniforms(
    pass: RenderPassNode,
  ): {
    channelTime: number[];
    channelLoaded: number[];
    sampleRate: number;
    channelResolution: number[];
  } {
    const channelCount = getShaderToyChannelCount(pass.channels);
    const channelTime = new Array<number>(channelCount).fill(0);
    const channelLoaded = new Array<number>(channelCount).fill(0);
    const channelResolution = new Array<number>(channelCount * 3).fill(0);

    for (const channel of pass.channels) {
      if (channel.kind === "video") {
        const video = this.host.session.resourceManager?.getVideoElement?.(channel.path);
        const handle = this.host.session.resourceManager?.getVideoTexture?.(channel.path);
        if (video) {
          channelTime[channel.slot] = video.currentTime;
          channelLoaded[channel.slot] = 1;
        }
        this.setChannelResolution(channelResolution, channel.slot, handle?.width, handle?.height);
      } else if (channel.kind === "audio") {
        const state = this.host.session.resourceManager?.getAudioState?.(channel.path);
        if (state) {
          channelTime[channel.slot] = state.currentTime;
          channelLoaded[channel.slot] = 1;
        }
        this.setChannelResolution(channelResolution, channel.slot, 512, 2);
      } else if (channel.kind === "texture") {
        const handle = this.host.session.resourceManager?.getImageTextureCache?.()[getSlangTextureIdentity(channel)];
        channelLoaded[channel.slot] = handle ? 1 : 0;
        this.setChannelResolution(channelResolution, channel.slot, handle?.width, handle?.height);
      } else if (channel.kind === "cubemap") {
        const handle = this.host.session.resourceManager?.getCubemapTexture?.(channel.path);
        channelLoaded[channel.slot] = handle ? 1 : 0;
        this.setChannelResolution(channelResolution, channel.slot, handle?.width, handle?.height);
      } else if (channel.kind === "buffer") {
        const source = this.host.session.passPipelines.get(channel.source);
        const view = channel.readFrom === "previous-frame"
          ? source?.getPreviousOutputView()
          : source?.getCurrentOutputView();
        channelLoaded[channel.slot] = view ? 1 : 0;
        const sourcePass = this.host.session.passGraph.find((candidate) => candidate.name === channel.source);
        this.setChannelResolution(channelResolution, channel.slot, sourcePass?.width, sourcePass?.height);
      } else {
        channelLoaded[channel.slot] = this.host.session.resourceManager?.getKeyboardTexture?.() ? 1 : 0;
        this.setChannelResolution(channelResolution, channel.slot, 256, 3);
      }
    }

    return {
      channelTime,
      channelLoaded,
      sampleRate: this.host.session.resourceManager?.getAudioSampleRate?.() || 44100,
      channelResolution,
    };
  }

  setChannelResolution(
    resolutions: number[],
    slot: number,
    width: number | undefined,
    height: number | undefined,
  ): void {
    if (width === undefined || height === undefined) {
      return;
    }
    resolutions[slot * 3] = width;
    resolutions[slot * 3 + 1] = height;
    resolutions[slot * 3 + 2] = 1;
  }

  resolveKeyboardHandle(skipInputUpdates: boolean): WebGPUTextureHandle | null {
    if (!this.host.session.resourceManager) {
      return null;
    }
    if (!skipInputUpdates) {
      this.host.session.resourceManager.updateKeyboardTexture(
        this.host.keyboardManager.getKeyHeld(),
        this.host.keyboardManager.getKeyPressed(),
        this.host.keyboardManager.getKeyToggled(),
      );
    }
    return this.host.session.resourceManager.getKeyboardTexture() ?? this.host.session.resourceManager.getDefaultTexture();
  }
}
