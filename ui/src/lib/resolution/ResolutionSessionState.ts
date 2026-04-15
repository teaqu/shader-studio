import type {
  AspectRatioMode,
  BufferPass,
  BufferResolution,
  ResolutionSettings,
  ShaderConfig,
} from "@shader-studio/types";
import type { ShaderDebugState } from "../types/ShaderDebugState";

export type BufferResolutionMenuState = {
  mode: "none" | "fixed" | "scale";
  width: string;
  height: string;
  scale: number;
};

export type ResolutionTarget =
  | { kind: "image"; label: string }
  | { kind: "buffer"; bufferName: string; label: string };

export interface ResolutionSessionState {
  syncWithConfig: boolean;
  imageResolutionOverride: ResolutionSettings | undefined;
  imageAspectOverride: AspectRatioMode | undefined;
  bufferResolutionOverrides: Record<string, BufferResolution | undefined>;
}

export interface ResolutionMenuViewModel {
  syncWithConfig: boolean;
  targetKind: ResolutionTarget["kind"];
  targetLabel: string;
  bufferResolutionState: BufferResolutionMenuState;
}

export function createInitialResolutionSessionState(): ResolutionSessionState {
  return {
    syncWithConfig: true,
    imageResolutionOverride: undefined,
    imageAspectOverride: undefined,
    bufferResolutionOverrides: {},
  };
}

export function createDefaultConfig(base: ShaderConfig | null): ShaderConfig {
  if (base) {
    return base;
  }

  return {
    version: "1.0",
    passes: {
      Image: { inputs: {} },
    },
  };
}

export function resetResolutionSessionState(state: ResolutionSessionState): ResolutionSessionState {
  return {
    ...state,
    syncWithConfig: true,
    imageResolutionOverride: undefined,
    imageAspectOverride: undefined,
    bufferResolutionOverrides: {},
  };
}

export function isBufferResolution(resolution: BufferResolution | undefined): boolean {
  return Boolean(
    resolution && (
      resolution.width !== undefined
      || resolution.height !== undefined
      || resolution.scale !== undefined
    ),
  );
}

export function getResolutionTarget(
  config: ShaderConfig | null,
  debugState: ShaderDebugState,
): ResolutionTarget {
  if (!config || !debugState.isEnabled || !debugState.isActive || !debugState.isInlineRenderingEnabled) {
    return { kind: "image", label: "Image" };
  }

  const activeBufferName = debugState.activeBufferName;
  if (
    activeBufferName === "Image"
    || activeBufferName === "Script"
    || activeBufferName === "Common"
    || activeBufferName === "common"
    || !config.passes[activeBufferName]
  ) {
    return { kind: "image", label: "Image" };
  }

  return {
    kind: "buffer",
    bufferName: activeBufferName,
    label: activeBufferName,
  };
}

export function getImageConfigResolution(config: ShaderConfig | null): ResolutionSettings | undefined {
  return config?.passes?.Image?.resolution;
}

export function getBufferConfigResolution(
  config: ShaderConfig | null,
  bufferName: string,
): BufferResolution | undefined {
  return (config?.passes?.[bufferName] as BufferPass | undefined)?.resolution;
}

export function getBufferResolutionMenuState(
  resolution: BufferResolution | undefined,
): BufferResolutionMenuState {
  if (!resolution || (!resolution.width && !resolution.height && resolution.scale === undefined)) {
    return {
      mode: "none",
      width: "",
      height: "",
      scale: 1,
    };
  }

  if (resolution.width !== undefined || resolution.height !== undefined) {
    return {
      mode: "fixed",
      width: resolution.width !== undefined ? String(resolution.width) : "",
      height: resolution.height !== undefined ? String(resolution.height) : "",
      scale: 1,
    };
  }

  return {
    mode: "scale",
    width: "",
    height: "",
    scale: resolution.scale ?? 1,
  };
}

export function getResolutionMenuViewModel(
  state: ResolutionSessionState,
  config: ShaderConfig | null,
  debugState: ShaderDebugState,
): ResolutionMenuViewModel {
  const target = getResolutionTarget(config, debugState);
  const bufferResolution = target.kind === "buffer"
    ? getEffectiveBufferResolution(state, config, target.bufferName)
    : undefined;

  return {
    syncWithConfig: state.syncWithConfig,
    targetKind: target.kind,
    targetLabel: target.label,
    bufferResolutionState: getBufferResolutionMenuState(bufferResolution),
  };
}

export function getEffectiveImageResolution(
  state: ResolutionSessionState,
  config: ShaderConfig | null,
): ResolutionSettings | undefined {
  return state.syncWithConfig
    ? getImageConfigResolution(config)
    : (state.imageResolutionOverride ?? getImageConfigResolution(config));
}

export function getEffectiveBufferResolution(
  state: ResolutionSessionState,
  config: ShaderConfig | null,
  bufferName: string,
): BufferResolution | undefined {
  return state.syncWithConfig
    ? getBufferConfigResolution(config, bufferName)
    : (state.bufferResolutionOverrides[bufferName] ?? getBufferConfigResolution(config, bufferName));
}

export function buildRuntimeConfig(
  state: ResolutionSessionState,
  config: ShaderConfig | null,
): ShaderConfig {
  const base = createDefaultConfig(config);
  const passes = { ...base.passes };

  if (state.imageResolutionOverride) {
    passes.Image = {
      ...passes.Image,
      resolution: state.imageResolutionOverride,
    };
  }

  for (const [bufferName, resolution] of Object.entries(state.bufferResolutionOverrides)) {
    const pass = passes[bufferName] as BufferPass | undefined;
    if (!pass) {
      continue;
    }

    const updatedPass = { ...pass };
    if (resolution && isBufferResolution(resolution)) {
      updatedPass.resolution = resolution;
    } else {
      delete updatedPass.resolution;
    }
    passes[bufferName] = updatedPass;
  }

  return {
    ...base,
    passes,
  };
}
