import type { RenderPassNode } from "../types/PassGraph";
import { emptyVrControllers, type VrControllerData, type VrEyeView } from "../webxr/WebXrFrameData";
import type { VrUniformInput } from "./uniforms";
import { usesWebGpuVrEntry } from "./WebGPUVrEntry";

/** Desktop preview and headset state shared by every WebGPU pass of a frame. */
export class WebGPUVrState {
  available = false;
  enabled = false;
  active = false;
  controllers: VrControllerData = emptyVrControllers();
  private path = "";

  /** Mirrors the compile-time choice of the generated mainVR fragment. */
  update(path: string, passes: readonly RenderPassNode[], commonCode: string): void {
    const image = passes.find(pass => pass.name === "Image");
    this.available = image !== undefined
      && image.output === "canvas"
      && usesWebGpuVrEntry({
        passName: image.name,
        passKind: image.kind,
        geometry: image.geometry,
        outputKind: image.outputKind,
        renderEntryPoints: image.entryPoints,
      }, `${commonCode}\n${image.source}`);
    if (path !== this.path || !this.available) {
      this.enabled = false;
    }
    this.path = path;
  }

  clear(): void {
    this.available = false;
    this.enabled = false;
    this.path = "";
  }

  setEnabled(enabled: boolean): void {
    this.enabled = this.available && enabled;
  }

  resetSession(): void {
    this.active = false;
    this.controllers = emptyVrControllers();
  }

  /** Controllers reach every pass; the eye transform reaches only headset Image draws. */
  uniforms(passName: string, eye?: VrEyeView): VrUniformInput {
    return {
      preview: passName === "Image" && this.enabled,
      immersive: eye !== undefined,
      active: this.active,
      controllers: this.controllers,
      ...(eye ? { viewport: eye.viewport, rayTransform: eye.rayTransform } : {}),
    };
  }
}
