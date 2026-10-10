import type { PiRenderer } from "../types/piRenderer";
import { emptyVrControllers, type VrControllerData, type VrEyeView } from "./WebXrFrameData";

export const VR_INPUT_DECLARATIONS = `uniform bool iVRActive;
uniform vec4 iVRControllerPosition[2];
uniform vec4 iVRControllerDirection[2];
uniform vec4 iVRControllerButtons[2];
uniform vec4 iVRControllerAxes[2];`;

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
    renderer.SetShaderConstant1I("iVRActive", this.active ? 1 : 0);
    renderer.SetShaderConstant4FV("iVRControllerPosition[0]", this.controllers.positions);
    renderer.SetShaderConstant4FV("iVRControllerDirection[0]", this.controllers.directions);
    renderer.SetShaderConstant4FV("iVRControllerButtons[0]", this.controllers.buttons);
    renderer.SetShaderConstant4FV("iVRControllerAxes[0]", this.controllers.axes);
    renderer.SetShaderConstant1I("_ssVrImmersive", this.view ? 1 : 0);
    if (this.view) {
      const viewport = this.view.viewport;
      renderer.SetShaderConstant4FV("_ssVrViewport", [viewport.x, viewport.y, viewport.width, viewport.height]);
      renderer.SetShaderConstantMat4F("_ssVrRayTransform", Array.from(this.view.rayTransform), true);
    }
  }
}
