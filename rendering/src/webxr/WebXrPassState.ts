import type { PiRenderer } from "../types/piRenderer";
import { emptyVrControllers, type VrControllerData, type VrEyeView } from "./WebXrFrameData";
import { stripComments } from "../util/ShaderText";

/** Explicit opt-in keeps these extra names out of imported Shadertoy shaders. */
export function vrInputDeclarations(source: string): string {
  if (!/^[\t ]*#[\t ]*define[\t ]+SHADER_STUDIO_VR_INPUTS(?:[\t ]+1)?[\t ]*$/m.test(stripComments(source))) {
    return "";
  }
  const names = ["Active", "ControllerPosition", "ControllerDirection", "ControllerButtons", "ControllerAxes", "ControllerFaceButtons", "ControllerTouches", "ControllerFaceTouches"];
  return names.map(name => `uniform ${name === "Active" ? "bool" : "vec4"} _ssVr${name}${name === "Active" ? "" : "[2]"};\n#define iVR${name} _ssVr${name}`).join("\n");
}

export class WebXrPassState {
  active = false;
  view: VrEyeView | null = null;
  controllers: VrControllerData = emptyVrControllers();

  reset(): void {
    this.active = false;
    this.view = null;
    this.controllers = emptyVrControllers();
  }

  bind(renderer: PiRenderer): void {
    renderer.SetShaderConstant1I("_ssVrActive", this.active ? 1 : 0);
    renderer.SetShaderConstant4FV("_ssVrControllerPosition[0]", this.controllers.positions);
    renderer.SetShaderConstant4FV("_ssVrControllerDirection[0]", this.controllers.directions);
    renderer.SetShaderConstant4FV("_ssVrControllerButtons[0]", this.controllers.buttons);
    renderer.SetShaderConstant4FV("_ssVrControllerAxes[0]", this.controllers.axes);
    renderer.SetShaderConstant4FV("_ssVrControllerFaceButtons[0]", this.controllers.faceButtons);
    renderer.SetShaderConstant4FV("_ssVrControllerTouches[0]", this.controllers.touches);
    renderer.SetShaderConstant4FV("_ssVrControllerFaceTouches[0]", this.controllers.faceTouches);
    renderer.SetShaderConstant1I("_ssVrImmersive", this.view ? 1 : 0);
    if (this.view) {
      const viewport = this.view.viewport;
      renderer.SetShaderConstant4FV("_ssVrViewport", [viewport.x, viewport.y, viewport.width, viewport.height]);
      renderer.SetShaderConstantMat4F("_ssVrRayTransform", Array.from(this.view.rayTransform), true);
    }
  }
}
