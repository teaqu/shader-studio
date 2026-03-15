import { KeyboardManager } from "./KeyboardManager";

// Quaternion helpers (inline to avoid dependencies)
// q = [x, y, z, w] where w is the scalar part

function quat_identity(): Float32Array {
  return new Float32Array([0, 0, 0, 1]);
}

function quat_from_axis_angle(ax: number, ay: number, az: number, angle: number): Float32Array {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return new Float32Array([ax * s, ay * s, az * s, Math.cos(half)]);
}

function quat_multiply(a: Float32Array, b: Float32Array): Float32Array {
  return new Float32Array([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}

function quat_normalize(q: Float32Array): void {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (len > 0) {
    const inv = 1 / len;
    q[0] *= inv;
    q[1] *= inv;
    q[2] *= inv;
    q[3] *= inv;
  }
}

function quat_rotate_vec3(q: Float32Array, v: Float32Array): Float32Array {
  // q * v * q^-1, optimized
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const vx = v[0], vy = v[1], vz = v[2];

  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return new Float32Array([
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ]);
}

export class CameraManager {
  private orientation = quat_identity(); // current rotation as quaternion
  private position = new Float32Array(3); // [x, y, z]
  private accumulatedPitch = 0; // track total pitch for clamping
  private static readonly MAX_PITCH = Math.PI / 2 - 0.01;

  private moveSpeed = 3.0;
  private sprintMultiplier = 3.0;
  private lookSpeed = 0.003;       // radians/pixel for mouse
  private keyLookSpeed = 1.5;      // radians/sec for IJKL

  private isMouseDown = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private canvas: HTMLCanvasElement | null = null;
  private onMouseDown: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onMouseUp: ((e: MouseEvent) => void) | null = null;

  constructor(private keyboardManager: KeyboardManager) {}

  setupEventListeners(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseDown = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.isMouseDown) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.applyMouseLook(dx * this.lookSpeed, -dy * this.lookSpeed);
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isMouseDown = false;
      }
    };

    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  private applyMouseLook(yawDelta: number, pitchDelta: number): void {
    // Yaw: always rotate around world Y axis (no roll accumulation)
    if (yawDelta !== 0) {
      const yawQ = quat_from_axis_angle(0, 1, 0, yawDelta);
      this.orientation = quat_multiply(yawQ, this.orientation);
    }
    // Pitch: rotate around camera's local X (right) axis, clamped
    if (pitchDelta !== 0) {
      const newPitch = this.accumulatedPitch + pitchDelta;
      const clampedPitch = Math.max(-CameraManager.MAX_PITCH, Math.min(CameraManager.MAX_PITCH, newPitch));
      const actualDelta = clampedPitch - this.accumulatedPitch;
      this.accumulatedPitch = clampedPitch;
      if (actualDelta !== 0) {
        const right = this.getRight();
        const pitchQ = quat_from_axis_angle(right[0], right[1], right[2], actualDelta);
        this.orientation = quat_multiply(pitchQ, this.orientation);
      }
    }
    quat_normalize(this.orientation);
  }

  update(deltaTime: number): void {
    if (deltaTime <= 0 || deltaTime > 1) return;

    const keyHeld = this.keyboardManager.getKeyHeld();
    const speed = this.moveSpeed * (keyHeld[16] ? this.sprintMultiplier : 1);

    const forward = this.getForward();
    const right = this.getRight();
    const up = new Float32Array([0, 1, 0]); // world up for Q/E

    const move = speed * deltaTime;

    // W/S: move along full 3D forward direction (including pitch)
    if (keyHeld[87]) { // W
      this.position[0] += forward[0] * move;
      this.position[1] += forward[1] * move;
      this.position[2] += forward[2] * move;
    }
    if (keyHeld[83]) { // S
      this.position[0] -= forward[0] * move;
      this.position[1] -= forward[1] * move;
      this.position[2] -= forward[2] * move;
    }

    // A/D: strafe along camera right
    if (keyHeld[65]) { // A
      this.position[0] += right[0] * move;
      this.position[1] += right[1] * move;
      this.position[2] += right[2] * move;
    }
    if (keyHeld[68]) { // D
      this.position[0] -= right[0] * move;
      this.position[1] -= right[1] * move;
      this.position[2] -= right[2] * move;
    }

    // Q/E: world-space vertical movement
    if (keyHeld[81]) this.position[1] += move; // Q up
    if (keyHeld[69]) this.position[1] -= move; // E down

    // Arrow key look
    const kls = this.keyLookSpeed * deltaTime;
    if (keyHeld[37] || keyHeld[38] || keyHeld[39] || keyHeld[40]) {
      const yaw = (keyHeld[39] ? kls : 0) - (keyHeld[37] ? kls : 0);   // Right arrow, Left arrow
      const pitch = (keyHeld[40] ? kls : 0) - (keyHeld[38] ? kls : 0); // Down arrow up, Up arrow down
      this.applyMouseLook(yaw, pitch);
    }
  }

  /** Forward direction vector (where camera is looking) */
  private getForward(): Float32Array {
    // Camera default looks along -Z, rotate by orientation
    return quat_rotate_vec3(this.orientation, new Float32Array([0, 0, -1]));
  }

  /** Right direction vector */
  private getRight(): Float32Array {
    return quat_rotate_vec3(this.orientation, new Float32Array([1, 0, 0]));
  }

  getCameraPos(): Float32Array {
    return this.position;
  }

  getCameraDir(): Float32Array {
    return this.getForward();
  }

  dispose(): void {
    if (this.canvas && this.onMouseDown) {
      this.canvas.removeEventListener("mousedown", this.onMouseDown);
    }
    if (this.onMouseMove) {
      window.removeEventListener("mousemove", this.onMouseMove);
    }
    if (this.onMouseUp) {
      window.removeEventListener("mouseup", this.onMouseUp);
    }
    this.canvas = null;
  }
}
