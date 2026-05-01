import type {
  AspectRatioMode,
  BufferPass,
  ResolutionSettings,
  ShaderConfig,
} from "@shader-studio/types";
import type { ShaderDebugState } from "../types/ShaderDebugState";
import type { Transport } from "../transport/MessageTransport";
import { persistConfig } from "../config/ConfigPersistence";
import {
  buildRuntimeConfig,
  createDefaultConfig,
  createInitialResolutionSessionState,
  getBufferConfigResolution,
  getEffectiveBufferResolution,
  getEffectiveImageResolution,
  getImageConfigResolution,
  getResolutionMenuViewModel,
  getResolutionTarget,
  resetResolutionSessionState,
  type BufferResolutionMenuState,
  type ResolutionMenuViewModel,
  type ResolutionTarget,
} from "./ResolutionSessionState";

type ResolutionStoreLike = {
  setFromConfig(settings?: ResolutionSettings): void;
  setSessionSettings(settings?: Partial<ResolutionSettings>): void;
};

type AspectRatioStoreLike = {
  setFromConfig(mode?: AspectRatioMode): void;
  setSessionMode(mode?: AspectRatioMode): void;
};

export interface ControllerDeps {
  readonly currentConfig: ShaderConfig | null;
  readonly debugState: ShaderDebugState;
  resolutionStore: ResolutionStoreLike;
  aspectRatioStore: AspectRatioStoreLike;
  setCurrentConfig(config: ShaderConfig): void;
  getShaderPath(): string;
  getBufferPathMap(): Record<string, string>;
  getCurrentAspectRatioMode(): AspectRatioMode;
  isInitialized(): boolean;
  hasShader(): boolean;
  updatePipelineConfig(config: ShaderConfig): void;
  recompileCurrentShader(): void;
  setShaderContext(config: ShaderConfig, shaderPath: string, bufferPathMap: Record<string, string>): void;
  setEditorConfig(config: ShaderConfig): void;
  transport: Transport;
}

export class ResolutionSessionController {
  private _state = $state(createInitialResolutionSessionState());
  // When sync is off and a different shader starts loading, defer re-applying
  // the session runtime override until that load has finished successfully.
  private shouldApplySessionRuntimeAfterShaderLoad = false;

  public constructor(private readonly deps: ControllerDeps) {}

  get menuVM(): ResolutionMenuViewModel {
    return getResolutionMenuViewModel(this._state, this.deps.currentConfig, this.deps.debugState);
  }

  public resetForShaderLoad(isSameShader: boolean): void {
    if (!isSameShader) {
      this._state = resetResolutionSessionState(this._state);
    }
  }

  public syncStoresToCurrentTarget(config: ShaderConfig | null = this.deps.currentConfig): void {
    const target = this.getCurrentTarget(config);
    if (target.kind === "image") {
      const settings = getEffectiveImageResolution(this._state, config);
      this.applyImagePreviewState(settings, this._state.syncWithConfig ? "config" : "session");
    } else {
      const effectiveResolution = getEffectiveBufferResolution(this._state, config, target.bufferName);
      this.applyBufferPreviewState(effectiveResolution);
    }
  }

  public handleShaderLoaded(config: ShaderConfig | null, isSameShader: boolean): void {
    this.shouldApplySessionRuntimeAfterShaderLoad = false;
    this.resetForShaderLoad(isSameShader);
    this.syncStoresToCurrentTarget(config);

    if (!this._state.syncWithConfig) {
      if (isSameShader) {
        this.applySessionRuntimeConfig();
      } else {
        this.shouldApplySessionRuntimeAfterShaderLoad = true;
      }
    }
  }

  public handleShaderLoadSucceeded(): void {
    const shouldApply = this.shouldApplySessionRuntimeAfterShaderLoad;
    this.shouldApplySessionRuntimeAfterShaderLoad = false;

    if (!shouldApply) {
      return;
    }

    this.applySessionRuntimeConfig();
  }

  public handleShaderLoadFailed(): void {
    this.shouldApplySessionRuntimeAfterShaderLoad = false;
  }

  public handleConfigUpdated(updatedConfig: ShaderConfig): void {
    this.deps.setCurrentConfig(updatedConfig);
    this.deps.setEditorConfig(updatedConfig);
    this.deps.setShaderContext(updatedConfig, this.deps.getShaderPath(), this.deps.getBufferPathMap());
    this.deps.updatePipelineConfig(updatedConfig);
    this.syncStoresToCurrentTarget(updatedConfig);
  }

  public handleDebugStateChanged(): void {
    this.syncStoresToCurrentTarget();
  }

  public setSyncWithConfig(enabled: boolean): void {
    this.shouldApplySessionRuntimeAfterShaderLoad = false;

    if (enabled) {
      const syncedConfig = buildRuntimeConfig(this._state, this.deps.currentConfig);
      this._state.syncWithConfig = true;
      this._state.imageResolutionOverride = undefined;
      this._state.imageAspectOverride = undefined;
      this._state.bufferResolutionOverrides = {};
      this.persistConfigUpdate(syncedConfig);
      return;
    }

    this._state.syncWithConfig = false;

    const config = this.deps.currentConfig;
    const currentImageResolution = getImageConfigResolution(config);
    this._state.imageResolutionOverride = currentImageResolution ? { ...currentImageResolution } : undefined;
    this._state.imageAspectOverride = currentImageResolution?.aspectRatio ?? this.deps.getCurrentAspectRatioMode();

    const target = this.getCurrentTarget(config);
    if (target.kind === "buffer") {
      const currentBufferResolution = getBufferConfigResolution(config, target.bufferName);
      this._state.bufferResolutionOverrides = {
        ...this._state.bufferResolutionOverrides,
        [target.bufferName]: currentBufferResolution ? { ...currentBufferResolution } : undefined,
      };
    }

    this.syncStoresToCurrentTarget();
  }

  public setAspectRatio(mode: AspectRatioMode): void {
    if (this._state.syncWithConfig) {
      const base = createDefaultConfig(this.deps.currentConfig);
      const imagePass = { ...base.passes.Image };
      const { width: _width, height: _height, ...resolution } = imagePass.resolution ?? {};
      imagePass.resolution = {
        ...resolution,
        aspectRatio: mode,
      };
      this.persistConfigUpdate({
        ...base,
        passes: {
          ...base.passes,
          Image: imagePass,
        },
      });
      return;
    }

    const base = this._state.imageResolutionOverride ?? {};
    const { width: _width, height: _height, ...resolution } = base;
    this._state.imageAspectOverride = mode;
    this._state.imageResolutionOverride = {
      ...resolution,
      aspectRatio: mode,
    };
    this.applySessionRuntimeConfig();
  }

  public setImageScale(scale: number): void {
    if (this._state.syncWithConfig) {
      const base = createDefaultConfig(this.deps.currentConfig);
      const imagePass = { ...base.passes.Image };
      imagePass.resolution = {
        ...imagePass.resolution,
        scale,
      };
      this.persistConfigUpdate({
        ...base,
        passes: {
          ...base.passes,
          Image: imagePass,
        },
      });
      return;
    }

    const base = this._state.imageResolutionOverride ?? {};
    this._state.imageResolutionOverride = this.hasFixedImageSize(base)
      ? {
        ...base,
        scale,
      }
      : {
        ...base,
        scale,
        aspectRatio: this._state.imageAspectOverride
          ?? base.aspectRatio
          ?? undefined,
      };
    this.applySessionRuntimeConfig();
  }

  public setImageCustomResolution(width?: string, height?: string): void {
    const parsedWidth = this.parseImageDimension(width);
    const parsedHeight = this.parseImageDimension(height);

    if (this._state.syncWithConfig) {
      const base = createDefaultConfig(this.deps.currentConfig);
      const imagePass = { ...base.passes.Image };
      if (parsedWidth !== undefined && parsedHeight !== undefined) {
        const { aspectRatio: _aspectRatio, ...resolution } = imagePass.resolution ?? {};
        imagePass.resolution = {
          ...resolution,
          width: parsedWidth,
          height: parsedHeight,
        };
      } else if (imagePass.resolution) {
        const { width: _width, height: _height, ...resolution } = imagePass.resolution;
        imagePass.resolution = {
          ...resolution,
        };
      }
      this.persistConfigUpdate({
        ...base,
        passes: {
          ...base.passes,
          Image: imagePass,
        },
      });
      return;
    }

    const base = this._state.imageResolutionOverride ?? {};
    if (parsedWidth !== undefined && parsedHeight !== undefined) {
      const { aspectRatio: _aspectRatio, ...resolution } = base;
      this._state.imageResolutionOverride = {
        ...resolution,
        width: parsedWidth,
        height: parsedHeight,
      };
    } else {
      const { width: _width, height: _height, ...resolution } = base;
      this._state.imageResolutionOverride = {
        ...resolution,
      };
    }
    this.applySessionRuntimeConfig();
  }

  public resetCurrentTarget(): void {
    const config = this.deps.currentConfig;
    const target = this.getCurrentTarget(config);

    if (this._state.syncWithConfig) {
      const base = createDefaultConfig(config);
      if (target.kind === "image") {
        const { resolution: _resolution, ...imageRest } = base.passes.Image;
        this.persistConfigUpdate({
          ...base,
          passes: {
            ...base.passes,
            Image: imageRest,
          },
        });
        return;
      }

      const pass = base.passes[target.bufferName] as BufferPass | undefined;
      if (!pass) {
        return;
      }
      const { resolution: _resolution, ...rest } = pass;
      this.persistConfigUpdate({
        ...base,
        passes: {
          ...base.passes,
          [target.bufferName]: rest,
        },
      });
      return;
    }

    if (target.kind === "image") {
      const configResolution = getImageConfigResolution(config);
      this._state.imageResolutionOverride = configResolution ? { ...configResolution } : undefined;
      this._state.imageAspectOverride = configResolution?.aspectRatio;
    } else {
      const configResolution = getBufferConfigResolution(config, target.bufferName);
      this._state.bufferResolutionOverrides = {
        ...this._state.bufferResolutionOverrides,
        [target.bufferName]: configResolution ? { ...configResolution } : undefined,
      };
    }
    this.applySessionRuntimeConfig();
  }

  public setBufferResolutionMode(mode: BufferResolutionMenuState["mode"]): void {
    const target = this.getCurrentTarget();
    if (target.kind !== "buffer") {
      return;
    }

    if (mode === "none") {
      if (this._state.syncWithConfig) {
        const base = createDefaultConfig(this.deps.currentConfig);
        const pass = base.passes[target.bufferName] as BufferPass | undefined;
        if (!pass) {
          return;
        }
        const { resolution: _resolution, ...rest } = pass;
        this.persistConfigUpdate({
          ...base,
          passes: {
            ...base.passes,
            [target.bufferName]: rest,
          },
        });
      } else {
        this._state.bufferResolutionOverrides = {
          ...this._state.bufferResolutionOverrides,
          [target.bufferName]: undefined,
        };
        this.applySessionRuntimeConfig();
      }
      return;
    }

    if (mode === "fixed") {
      this.setBufferFixedResolution("512", "512");
      return;
    }

    this.setBufferScale(1);
  }

  public setBufferFixedResolution(width: string, height: string): void {
    const target = this.getCurrentTarget();
    if (target.kind !== "buffer" || !width || !height) {
      return;
    }

    const resolution = { width: Number(width), height: Number(height) };
    if (Number.isNaN(resolution.width) || Number.isNaN(resolution.height)) {
      return;
    }

    if (this._state.syncWithConfig) {
      const base = createDefaultConfig(this.deps.currentConfig);
      const pass = base.passes[target.bufferName] as BufferPass | undefined;
      if (!pass) {
        return;
      }
      this.persistConfigUpdate({
        ...base,
        passes: {
          ...base.passes,
          [target.bufferName]: {
            ...pass,
            resolution,
          },
        },
      });
      return;
    }

    this._state.bufferResolutionOverrides = {
      ...this._state.bufferResolutionOverrides,
      [target.bufferName]: resolution,
    };
    this.applySessionRuntimeConfig();
  }

  public setBufferScale(scale: number): void {
    const target = this.getCurrentTarget();
    if (target.kind !== "buffer") {
      return;
    }

    const resolution = { scale };
    if (this._state.syncWithConfig) {
      const base = createDefaultConfig(this.deps.currentConfig);
      const pass = base.passes[target.bufferName] as BufferPass | undefined;
      if (!pass) {
        return;
      }
      this.persistConfigUpdate({
        ...base,
        passes: {
          ...base.passes,
          [target.bufferName]: {
            ...pass,
            resolution,
          },
        },
      });
      return;
    }

    this._state.bufferResolutionOverrides = {
      ...this._state.bufferResolutionOverrides,
      [target.bufferName]: resolution,
    };
    this.applySessionRuntimeConfig();
  }

  public getMenuViewModel(): ResolutionMenuViewModel {
    return this.menuVM;
  }

  public getCurrentTarget(config: ShaderConfig | null = this.deps.currentConfig): ResolutionTarget {
    return getResolutionTarget(config, this.deps.debugState);
  }

  private applyImagePreviewState(
    settings?: ResolutionSettings,
    source: "config" | "session" = "config",
  ): void {
    if (!settings) {
      this.deps.resolutionStore.setSessionSettings({ scale: 1 });
      this.deps.aspectRatioStore.setSessionMode("auto");
      return;
    }

    if (source === "config") {
      this.deps.resolutionStore.setFromConfig(settings);
      this.deps.aspectRatioStore.setFromConfig(settings?.aspectRatio);
      return;
    }

    this.deps.resolutionStore.setSessionSettings(settings);
    this.deps.aspectRatioStore.setSessionMode(settings?.aspectRatio ?? this._state.imageAspectOverride ?? "auto");
  }

  private applyBufferPreviewState(resolution?: { width?: number; height?: number; scale?: number }): void {
    if (!resolution) {
      this.deps.resolutionStore.setSessionSettings({ scale: 1 });
      this.deps.aspectRatioStore.setSessionMode("fill");
      return;
    }

    if (resolution.width !== undefined || resolution.height !== undefined) {
      this.deps.resolutionStore.setSessionSettings({
        scale: 1,
        width: resolution.width,
        height: resolution.height,
      });
      this.deps.aspectRatioStore.setSessionMode("fill");
      return;
    }

    this.deps.resolutionStore.setSessionSettings({ scale: resolution.scale ?? 1 });
    this.deps.aspectRatioStore.setSessionMode("fill");
  }

  private parseImageDimension(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
  }

  private hasFixedImageSize(settings: Partial<ResolutionSettings>): settings is Partial<ResolutionSettings> & { width: number; height: number } {
    return settings.width !== undefined && settings.height !== undefined;
  }

  private applySessionRuntimeConfig(): void {
    if (!this.deps.isInitialized() || !this.deps.hasShader()) {
      return;
    }

    const runtimeConfig = buildRuntimeConfig(this._state, this.deps.currentConfig);
    this.deps.updatePipelineConfig(runtimeConfig);
    this.deps.setShaderContext(runtimeConfig, this.deps.getShaderPath(), this.deps.getBufferPathMap());
    this.syncStoresToCurrentTarget(runtimeConfig);
    this.deps.recompileCurrentShader();
  }

  private persistConfigUpdate(updatedConfig: ShaderConfig): void {
    persistConfig(this.deps.transport, {
      config: updatedConfig,
      shaderPath: this.deps.getShaderPath(),
      skipRefresh: true,
    });
    this.deps.setCurrentConfig(updatedConfig);
    this.deps.updatePipelineConfig(updatedConfig);
    this.deps.setShaderContext(updatedConfig, this.deps.getShaderPath(), this.deps.getBufferPathMap());
    this.deps.setEditorConfig(updatedConfig);
    this.syncStoresToCurrentTarget(updatedConfig);
  }
}
