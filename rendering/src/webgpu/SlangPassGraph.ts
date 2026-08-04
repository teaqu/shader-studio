import type { ConfigInput, ShaderConfig } from "@shader-studio/types";
import type {
  ChannelReadTiming,
  RenderPassChannel,
  RenderPassGraph,
  RenderPassName,
  RenderPassNode,
} from "../types/PassGraph";
import { assignInputSlots } from "../util/InputSlotAssigner";

export type {
  ChannelReadTiming,
  RenderPassChannel,
  RenderPassGraph,
  RenderPassName,
  RenderPassNode,
} from "../types/PassGraph";

export interface BuildSlangPassGraphOptions {
  imageCode: string;
  config: ShaderConfig | null;
  buffers: Record<string, string>;
  canvasWidth: number;
  canvasHeight: number;
}

const RESERVED_PASS_NAMES = new Set<string>(["Image", "common"]);

export function buildSlangPassGraph(options: BuildSlangPassGraphOptions): RenderPassGraph {
  const canvasWidth = Math.max(1, Math.round(options.canvasWidth));
  const canvasHeight = Math.max(1, Math.round(options.canvasHeight));
  const warnings: string[] = [];
  const errors: string[] = [];
  const config = options.config;
  const commonCode = options.buffers.common?.trim() ?? "";

  if (!config?.passes) {
    return {
      passes: [{
        name: "Image",
        source: options.imageCode,
        output: "canvas",
        width: canvasWidth,
        height: canvasHeight,
        channels: [],
      }],
      commonCode: "",
      warnings,
      errors,
    };
  }

  const configuredNames = new Set(Object.keys(config.passes));
  const bufferPassNames = Object.keys(config.passes).filter(
    (name) => !RESERVED_PASS_NAMES.has(name),
  );
  const configuredBufferNames = new Set(bufferPassNames);
  const renderablePassNames: RenderPassName[] = [...bufferPassNames, "Image"];
  const passIndexByName = new Map(renderablePassNames.map((name, index) => [name, index]));
  const passes: RenderPassNode[] = [];

  for (const name of renderablePassNames) {
    const passConfig = config.passes[name];
    if (!passConfig && name !== "Image") {
      continue;
    }

    const isImage = name === "Image";
    const source = isImage ? options.imageCode : options.buffers[name] ?? "";
    const path = !isImage && passConfig && "path" in passConfig ? passConfig.path : undefined;

    if (!isImage && source.trim() === "") {
      const pathInfo = path ? ` (path: "${path}")` : "";
      errors.push(`${name}: Buffer file not found or is empty${pathInfo}`);
      continue;
    }

    const resolution = isImage
      ? { width: canvasWidth, height: canvasHeight }
      : resolvePassResolution({
        passName: name,
        passConfig,
        canvasWidth,
        canvasHeight,
        errors,
      });

    passes.push({
      name,
      source,
      path,
      output: isImage ? "canvas" : "texture",
      width: resolution.width,
      height: resolution.height,
      channels: resolveChannels({
        passName: name,
        inputs: passConfig?.inputs ?? {},
        configuredNames,
        configuredBufferNames,
        passIndexByName,
        warnings,
        errors,
      }),
    });
  }

  if (!passes.some((pass) => pass.name === "Image")) {
    passes.push({
      name: "Image",
      source: options.imageCode,
      output: "canvas",
      width: canvasWidth,
      height: canvasHeight,
      channels: [],
    });
  }

  return { passes, commonCode, warnings, errors };
}

/**
 * Resolve a pass's render resolution from its config (fixed width/height,
 * canvas-relative scale, or the canvas size when unconfigured). Exported so
 * the engine can recompute pass sizes on canvas resize exactly the way
 * buildSlangPassGraph does at compile time.
 */
export function resolvePassResolution(options: {
  passName: RenderPassName;
  passConfig: ShaderConfig["passes"][string] | undefined;
  canvasWidth: number;
  canvasHeight: number;
  errors: string[];
}): { width: number; height: number } {
  const resolution = options.passConfig?.resolution;
  if (!resolution) {
    return { width: options.canvasWidth, height: options.canvasHeight };
  }

  if ("width" in resolution && "height" in resolution && resolution.width && resolution.height) {
    return {
      width: Math.max(1, Math.round(resolution.width * (resolution.scale ?? 1))),
      height: Math.max(1, Math.round(resolution.height * (resolution.scale ?? 1))),
    };
  }

  if ("scale" in resolution && typeof resolution.scale === "number") {
    return {
      width: Math.max(1, Math.round(options.canvasWidth * resolution.scale)),
      height: Math.max(1, Math.round(options.canvasHeight * resolution.scale)),
    };
  }

  options.errors.push(`${options.passName}: Invalid resolution settings`);
  return { width: options.canvasWidth, height: options.canvasHeight };
}

function resolveChannels(options: {
  passName: RenderPassName;
  inputs: Record<string, ConfigInput>;
  configuredNames: Set<string>;
  configuredBufferNames: Set<string>;
  passIndexByName: Map<string, number>;
  warnings: string[];
  errors: string[];
}): RenderPassChannel[] {
  const channels: RenderPassChannel[] = [];
  const validInputs: Record<string, ConfigInput> = {};

  for (const [key, input] of Object.entries(options.inputs)) {
    const numericName = /^iChannel(\d+)$/.exec(key);
    if (numericName && Number.parseInt(numericName[1], 10) > 15) {
      options.warnings.push(`${options.passName}: ignoring channel input "${key}" above slot 15`);
      continue;
    }
    validInputs[key] = input;
  }

  for (const { slot, key } of assignInputSlots(validInputs)) {
    const input = validInputs[key];

    if (input.type === "texture") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} texture input is missing a path`);
        continue;
      }
      channels.push({
        kind: "texture",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
        grayscale: input.grayscale,
      });
      continue;
    }

    if (input.type === "video") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} video input is missing a path`);
        continue;
      }
      channels.push({
        kind: "video",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
        muted: input.muted,
      });
      continue;
    }

    if (input.type === "cubemap") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} cubemap input is missing a path`);
        continue;
      }
      channels.push({
        kind: "cubemap",
        slot,
        key,
        path,
        filter: input.filter,
        wrap: input.wrap,
        vflip: input.vflip,
      });
      continue;
    }

    if (input.type === "audio") {
      const path = input.resolved_path || input.path;
      if (!path) {
        options.errors.push(`${options.passName}: ${key} audio input is missing a path`);
        continue;
      }
      channels.push({
        kind: "audio",
        slot,
        key,
        path,
        muted: input.muted,
        startTime: input.startTime,
        endTime: input.endTime,
      });
      continue;
    }

    if (input.type === "keyboard") {
      channels.push({ kind: "keyboard", slot, key });
      continue;
    }

    if (!options.configuredBufferNames.has(input.source)) {
      if (options.configuredNames.has(input.source)) {
        options.errors.push(
          `${options.passName}: ${key} source "${input.source}" is not a buffer pass`,
        );
      } else {
        options.errors.push(`${options.passName}: ${key} references missing buffer "${input.source}"`);
      }
      continue;
    }

    channels.push({
      kind: "buffer",
      slot,
      key,
      source: input.source,
      readFrom: resolveBufferReadTiming(
        options.passName,
        input.source,
        options.passIndexByName,
      ),
    });
  }

  return channels.sort((a, b) => a.slot - b.slot);
}

function resolveBufferReadTiming(
  passName: RenderPassName,
  sourceName: string,
  passIndexByName: Map<string, number>,
): ChannelReadTiming {
  if (passName === "Image") {
    return "current-frame";
  }
  const passIndex = passIndexByName.get(passName);
  const sourceIndex = passIndexByName.get(sourceName);
  return sourceIndex !== undefined && passIndex !== undefined && sourceIndex < passIndex
    ? "current-frame"
    : "previous-frame";
}
