import { describe, expect, it } from "vitest";
import { emptyVrControllers } from "../../webxr/WebXrFrameData";
import { WebXrLocomotion } from "../../webxr/WebXrLocomotion";

const head = (x = 0, z = 0) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 1.6, z, 1]);
const controls = () => {
  const data = emptyVrControllers();
  data.positions[3] = data.positions[7] = 1;
  data.directions[2] = data.directions[6] = -1;
  data.directions[3] = data.directions[7] = 1;
  return data;
};
const eye = (x = 0, z = 0) => ({ viewport: { x: 0, y: 0, width: 2, height: 2 }, rayTransform: head(x, z) });
const enabledMovement = () => {
  const movement = new WebXrLocomotion();
  movement.configure({ movement: true, movementSpeed: 2, turning: "snap", snapAngle: 30, turnSpeed: 90 });
  movement.reset();
  return movement;
};

describe("WebXrLocomotion", () => {
  it("moves forward and strafes at two metres per second using headset heading", () => {
    const movement = enabledMovement();
    const input = controls();
    input.axes[3] = -1;
    movement.update(0, head(), input);
    movement.update(100, head(), input);
    const view = eye();
    movement.transformEye(view);
    expect(view.rayTransform[14]).toBeCloseTo(-0.2);
    input.axes[3] = 0;
    input.axes[2] = 1;
    movement.update(200, head(), input);
    const strafed = eye();
    movement.transformEye(strafed);
    expect(strafed.rayTransform[12]).toBeCloseTo(0.2);
    expect(strafed.rayTransform[13]).toBeCloseTo(1.6);
    const turnedHead = head();
    turnedHead[8] = -1;
    turnedHead[10] = 0;
    input.axes[2] = 0;
    input.axes[3] = -1;
    movement.update(300, turnedHead, input);
    const turned = eye();
    movement.transformEye(turned);
    expect(turned.rayTransform[12]).toBeCloseTo(0.4);
  });

  it("triples speed while the left trigger is held and preserves raw shader inputs", () => {
    const movement = enabledMovement();
    const input = controls();
    input.axes[3] = -1;
    input.buttons[0] = 1;
    movement.update(0, head(), input);
    movement.update(100, head(), input);
    const fast = eye();
    movement.transformEye(fast);
    expect(fast.rayTransform[14]).toBeCloseTo(-0.6);
    expect(input.buttons[0]).toBe(1);
    input.buttons[0] = 0;
    movement.update(200, head(), input);
    const released = eye();
    movement.transformEye(released);
    expect(released.rayTransform[14]).toBeCloseTo(-0.8);
    movement.configure({ movement: false, movementSpeed: 2, turning: "snap", snapAngle: 30, turnSpeed: 90 });
    input.buttons[0] = 1;
    input.axes[6] = 0;
    movement.update(300, head(), input);
    input.axes[6] = 1;
    movement.update(400, head(), input);
    const disabled = eye();
    movement.transformEye(disabled);
    expect(disabled.rayTransform).toEqual(released.rayTransform);
    expect(input.buttons[0]).toBe(1);
  });

  it("normalizes diagonal input and ignores drift and untracked controllers", () => {
    const movement = enabledMovement();
    const input = controls();
    input.axes[2] = input.axes[3] = 1;
    movement.update(0, head(), input);
    movement.update(100, head(), input);
    const view = eye();
    movement.transformEye(view);
    expect(Math.hypot(view.rayTransform[12], view.rayTransform[14])).toBeCloseTo(0.2);
    input.axes[2] = input.axes[3] = 0.1;
    movement.update(200, head(), input);
    input.positions[3] = 0;
    input.axes[2] = 1;
    movement.update(300, head(), input);
    const unchanged = eye();
    movement.transformEye(unchanged);
    expect(unchanged.rayTransform).toEqual(view.rayTransform);
  });

  it("snap turns once per deflection around the headset and rotates controllers with both eyes", () => {
    const movement = enabledMovement();
    const input = controls();
    input.axes[6] = 1;
    movement.update(0, head(2, 3), input);
    movement.update(16, head(2, 3), input);
    const centre = eye(2, 3);
    movement.transformEye(centre);
    expect(centre.rayTransform[12]).toBeCloseTo(2);
    expect(centre.rayTransform[14]).toBeCloseTo(3);
    expect(centre.rayTransform[0]).toBeCloseTo(Math.cos(Math.PI / 6));
    const left = eye(1.968, 3), right = eye(2.032, 3);
    movement.transformEye(left);
    movement.transformEye(right);
    expect(Math.hypot(left.rayTransform[12] - right.rayTransform[12], left.rayTransform[14] - right.rayTransform[14])).toBeCloseTo(0.064);
    input.positions.set([2, 1.6, 3, 1], 0);
    movement.transformControllers(input);
    expect(input.positions[0]).toBeCloseTo(2);
    expect(input.positions[2]).toBeCloseTo(3);
    expect(input.directions[0]).toBeCloseTo(0.5);
    // Release, then deflect again to take a second step.
    input.axes[6] = 0;
    movement.update(32, head(2, 3), input);
    input.axes[6] = 1;
    movement.update(48, head(2, 3), input);
    const twice = eye();
    movement.transformEye(twice);
    expect(twice.rayTransform[0]).toBeCloseTo(0.5);
  });

  it("turns left, requires neutral before another turn, and does not turn on missing right tracking", () => {
    const movement = enabledMovement();
    const input = controls();
    input.axes[6] = -1;
    movement.update(0, head(), input);
    input.axes[6] = 0.5;
    movement.update(16, head(), input);
    input.axes[6] = 1;
    movement.update(32, head(), input);
    const view = eye();
    movement.transformEye(view);
    expect(view.rayTransform[2]).toBeCloseTo(-0.5);
    input.positions[7] = 0;
    movement.update(48, head(), input);
    const unchanged = eye();
    movement.transformEye(unchanged);
    expect(unchanged.rayTransform).toEqual(view.rayTransform);
    movement.transformControllers(emptyVrControllers());
  });

  it("caps frame gaps, handles vertical gaze, and resets on session changes", () => {
    const movement = enabledMovement();
    const input = controls();
    input.axes[3] = -1;
    const vertical = head();
    vertical[10] = 0;
    movement.update(0, vertical, input);
    movement.update(10000, vertical, input);
    const view = eye();
    movement.transformEye(view);
    expect(view.rayTransform[14]).toBeCloseTo(-0.2);
    movement.update(10001, null, input);
    movement.update(20000, head(), input);
    const resumed = eye();
    movement.transformEye(resumed);
    expect(resumed.rayTransform).toEqual(view.rayTransform);
    movement.reset();
    const reset = eye();
    movement.transformEye(reset);
    expect(reset.rayTransform).toEqual(head());
  });

  it("leaves shader inputs and tracked rays unchanged by default", () => {
    const movement = new WebXrLocomotion();
    const input = controls();
    input.axes[3] = -1;
    input.axes[6] = 1;
    const axes = new Float32Array(input.axes);
    movement.update(0, head(), input);
    movement.update(100, head(), input);
    const view = eye();
    movement.transformEye(view);
    movement.transformControllers(input);
    expect(view.rayTransform).toEqual(head());
    expect(input.axes).toEqual(axes);
  });

  it("configures smooth turn speed and preserves head position while turning", () => {
    const movement = new WebXrLocomotion();
    movement.configure({ movement: true, movementSpeed: 5, turning: "smooth", snapAngle: 45, turnSpeed: 90 });
    const input = controls();
    input.axes[6] = 1;
    movement.update(0, head(2, 3), input);
    movement.update(100, head(2, 3), input);
    const view = eye(2, 3);
    movement.transformEye(view);
    expect(view.rayTransform[0]).toBeCloseTo(Math.cos(Math.PI / 20));
    expect(view.rayTransform[12]).toBeCloseTo(2);
    expect(view.rayTransform[14]).toBeCloseTo(3);
  });

  it("configures speed and snap angle and releases a held turn when settings change", () => {
    const movement = new WebXrLocomotion();
    movement.configure({ movement: true, movementSpeed: 5, turning: "snap", snapAngle: 45, turnSpeed: 90 });
    const input = controls();
    input.axes[3] = -1;
    input.axes[6] = 1;
    movement.update(0, head(), input);
    movement.update(100, head(), input);
    const beforeRelease = eye();
    movement.transformEye(beforeRelease);
    expect(beforeRelease.rayTransform[0]).toBe(1);
    expect(beforeRelease.rayTransform[14]).toBeCloseTo(-0.5);
    input.axes[3] = input.axes[6] = 0;
    movement.update(200, head(), input);
    input.axes[6] = 1;
    movement.update(300, head(), input);
    const turned = eye();
    movement.transformEye(turned);
    expect(turned.rayTransform[0]).toBeCloseTo(Math.SQRT1_2);
  });
});
