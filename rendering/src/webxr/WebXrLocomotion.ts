import type { VrControllerData, VrEyeView } from "./WebXrFrameData";
import { normalizeVrNavigation, type VrNavigationSettings } from "./VrNavigationSettings";

/** Session-local world transform; physical tracking and stereo separation stay intact. */
export class WebXrLocomotion {
  private yaw = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  private lastTime: number | null = null;
  private turnReady = true;
  private settings = normalizeVrNavigation(undefined);

  configure(settings: VrNavigationSettings): void {
    this.settings = normalizeVrNavigation(settings);
    // A held stick must be released after changing turn settings.
    this.turnReady = false;
  }

  reset(): void {
    this.yaw = this.x = this.y = this.z = 0;
    this.lastTime = null;
    this.turnReady = true;
  }

  update(time: number, head: Float32Array | null, input: VrControllerData): void {
    if (!head) {
      this.lastTime = null;
      return;
    }
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min((time - this.lastTime) / 1000, 0.1));
    this.lastTime = time;
    const turn = input.positions[7] ? input.axes[6] : 0;
    if (Math.abs(turn) < 0.25) {
      this.turnReady = true;
    }
    const snap = this.settings.movement && this.settings.turning === "snap" && Math.abs(turn) > 0.65 && this.turnReady;
    const smooth = this.settings.movement && this.settings.turning === "smooth" && Math.abs(turn) > 0.18;
    if (snap || smooth) {
      // Rotate around the head, rather than orbiting the reference-space origin.
      const [beforeX, beforeZ] = this.rotate(head[12], head[14]);
      const degrees = snap ? Math.sign(turn) * this.settings.snapAngle
        : Math.sign(turn) * (Math.abs(turn) - 0.18) / 0.82 * this.settings.turnSpeed * dt;
      this.yaw -= degrees * Math.PI / 180;
      const [afterX, afterZ] = this.rotate(head[12], head[14]);
      this.x += beforeX - afterX;
      this.z += beforeZ - afterZ;
      this.turnReady = false;
    }
    const stickX = input.positions[3] ? input.axes[2] : 0;
    const stickY = input.positions[3] ? input.axes[3] : 0;
    const magnitude = Math.hypot(stickX, stickY);
    if (!this.settings.movement || magnitude <= 0.18) {
      return;
    }
    const strength = Math.min(1, (magnitude - 0.18) / 0.82);
    const length = Math.hypot(head[8], head[9], head[10]);
    const [forwardX, forwardZ] = length > 0.001
      ? this.rotate(-head[8] / length, -head[10] / length)
      : this.rotate(0, -1);
    const forwardY = length > 0.001 ? -head[9] / length : 0;
    // Strafing stays level even when looking straight up or down.
    const horizontalLength = Math.hypot(forwardX, forwardZ);
    const [rightX, rightZ] = horizontalLength > 0.001
      ? [-forwardZ / horizontalLength, forwardX / horizontalLength]
      : this.rotate(1, 0);
    const sprint = input.buttons[0] > 0.5 ? 3 : 1;
    const distance = this.settings.movementSpeed * sprint * dt * strength / magnitude;
    this.x += (rightX * stickX - forwardX * stickY) * distance;
    this.y -= forwardY * stickY * distance;
    this.z += (rightZ * stickX - forwardZ * stickY) * distance;
  }

  transformEye(view: VrEyeView): void {
    const matrix = view.rayTransform;
    for (const offset of [0, 4, 8, 12]) {
      const [x, z] = this.rotate(matrix[offset], matrix[offset + 2]);
      matrix[offset] = x + (offset === 12 ? this.x : 0);
      matrix[offset + 2] = z + (offset === 12 ? this.z : 0);
    }
    matrix[13] += this.y;
  }

  transformControllers(input: VrControllerData): void {
    for (const offset of [0, 4]) {
      if (!input.positions[offset + 3]) {
        continue;
      }
      const [x, z] = this.rotate(input.positions[offset], input.positions[offset + 2]);
      input.positions[offset] = x + this.x;
      input.positions[offset + 1] += this.y;
      input.positions[offset + 2] = z + this.z;
      const [dx, dz] = this.rotate(input.directions[offset], input.directions[offset + 2]);
      input.directions[offset] = dx;
      input.directions[offset + 2] = dz;
    }
  }

  private rotate(x: number, z: number): [number, number] {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [c * x + s * z, -s * x + c * z];
  }
}
