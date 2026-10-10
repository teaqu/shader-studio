import { describe, expect, it, vi } from "vitest";
import { WebXrPassState } from "../../webxr/WebXrPassState";

const renderer = () => ({ SetShaderConstant1I: vi.fn(), SetShaderConstant4FV: vi.fn(), SetShaderConstantMat4F: vi.fn() });

describe("WebXrPassState", () => {
  it("binds neutral controller inputs when immersive VR is inactive", () => {
    const state = new WebXrPassState();
    const target = renderer();
    state.bind(target as never);
    expect(target.SetShaderConstant1I).toHaveBeenCalledWith("iVRActive", 0);
    expect(target.SetShaderConstant1I).toHaveBeenCalledWith("_ssVrImmersive", 0);
    expect(target.SetShaderConstant4FV).toHaveBeenCalledTimes(4);
    expect(target.SetShaderConstantMat4F).not.toHaveBeenCalled();
  });

  it("binds controllers and the current per-eye transform", () => {
    const state = new WebXrPassState();
    state.active = true;
    state.controllers.buttons[0] = .75;
    state.view = { viewport: { x: 3, y: 4, width: 5, height: 6 }, rayTransform: Float32Array.from({ length: 16 }, (_, index) => index) };
    const target = renderer();
    state.bind(target as never);
    expect(target.SetShaderConstant1I).toHaveBeenCalledWith("iVRActive", 1);
    expect(target.SetShaderConstant1I).toHaveBeenCalledWith("_ssVrImmersive", 1);
    expect(target.SetShaderConstant4FV).toHaveBeenCalledWith("iVRControllerButtons[0]", state.controllers.buttons);
    expect(target.SetShaderConstant4FV).toHaveBeenCalledWith("_ssVrViewport", [3, 4, 5, 6]);
    expect(target.SetShaderConstantMat4F).toHaveBeenCalledWith("_ssVrRayTransform", Array.from({ length: 16 }, (_, index) => index), true);
  });

  it("clears active view and controller data", () => {
    const state = new WebXrPassState();
    state.active = true;
    state.controllers.axes[0] = 1;
    state.view = { viewport: { x: 0, y: 0, width: 1, height: 1 }, rayTransform: new Float32Array(16) };
    state.reset();
    expect(state.active).toBe(false);
    expect(state.view).toBeNull();
    expect(Array.from(state.controllers.axes)).toEqual(Array(8).fill(0));
  });
});
