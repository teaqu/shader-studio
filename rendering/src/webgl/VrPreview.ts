import type { Pass } from "../models/Pass";
import { hasMainVr } from "./VrShaderEntry";

/** VR preview affects only the final fullscreen Image pass. */
export class VrPreview {
  available = false;
  enabled = false;
  private path = "";

  update(path: string, passes: Pass[]): void {
    const image = passes.find(pass => pass.name === "Image");
    const common = passes.find(pass => pass.name === "common");
    this.available = image?.geometry === "fullscreen" && hasMainVr(`${common?.shaderSrc ?? ""}\n${image.shaderSrc}`);
    if (path !== this.path || !this.available) {
      this.enabled = false;
    }
    this.path = path;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = this.available && enabled;
  }
}
