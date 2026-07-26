import { createPerspectiveMatrix, createViewMatrix, normalizeVector, type ClipSpaceDepth, type Mat4 } from './math';
import type { Vec3 } from './types';

const DEFAULT_TARGET: Vec3 = [0, 0, 0];
const DEFAULT_YAW = Math.PI / 4;
const DEFAULT_PITCH = Math.atan2(1.5, 4);
const DEFAULT_DISTANCE = Math.hypot(1.5, 4);
const MIN_PITCH = -Math.PI / 2 + 0.01;
const MAX_PITCH = Math.PI / 2 - 0.01;
const MIN_DISTANCE = 0.5;
const MAX_DISTANCE = 20;

export class OrbitCamera {
  private target: [number, number, number] = [...DEFAULT_TARGET];
  private yaw = DEFAULT_YAW;
  private pitch = DEFAULT_PITCH;
  private distance = DEFAULT_DISTANCE;
  private inputEnabled = true;
  private attachedCanvas: HTMLCanvasElement | null = null;
  private dragMode: 'orbit' | 'pan' | null = null;
  private lastPointer: [number, number] = [0, 0];

  getTarget(): [number, number, number] {
    return [...this.target];
  }
  getPitch(): number {
    return this.pitch;
  }
  getDistance(): number {
    return this.distance;
  }

  getPosition(): [number, number, number] {
    const horizontalDistance = Math.cos(this.pitch) * this.distance;
    return [
      this.target[0] + Math.sin(this.yaw) * horizontalDistance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] + Math.cos(this.yaw) * horizontalDistance,
    ];
  }

  getViewMatrix(): Mat4 {
    return createViewMatrix(this.getPosition(), this.target);
  }
  getProjectionMatrix(aspect: number, clipSpaceDepth: ClipSpaceDepth = 'webgl'): Mat4 {
    return createPerspectiveMatrix(Math.PI / 4, Math.max(aspect, 0.01), 0.01, 100, clipSpaceDepth);
  }

  orbit(deltaX: number, deltaY: number): void {
    this.yaw -= deltaX * 0.01;
    this.pitch = clamp(this.pitch + deltaY * 0.01, MIN_PITCH, MAX_PITCH);
  }

  pan(deltaX: number, deltaY: number): void {
    const position = this.getPosition();
    const forward = normalizeVector([this.target[0] - position[0], this.target[1] - position[1], this.target[2] - position[2]]);
    const right = normalizeVector([forward[2], 0, -forward[0]]);
    const up = normalizeVector([
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ]);
    const panScale = this.distance * 0.002;
    this.target[0] += (right[0] * deltaX + up[0] * deltaY) * panScale;
    this.target[1] += (right[1] * deltaX + up[1] * deltaY) * panScale;
    this.target[2] += (right[2] * deltaX + up[2] * deltaY) * panScale;
  }

  dolly(delta: number): void {
    this.distance = clamp(this.distance + delta * 0.01, MIN_DISTANCE, MAX_DISTANCE);
  }

  reset(): void {
    this.target = [...DEFAULT_TARGET]; this.yaw = DEFAULT_YAW; this.pitch = DEFAULT_PITCH; this.distance = DEFAULT_DISTANCE;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled; if (!enabled) {
      this.dragMode = null;
    }
  }

  attach(canvas: HTMLCanvasElement): void {
    this.detach();
    this.attachedCanvas = canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detach(): void {
    const canvas = this.attachedCanvas;
    if (!canvas) {
      return;
    }
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    this.attachedCanvas = null;
    this.dragMode = null;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.inputEnabled || (event.button !== 0 && event.button !== 1)) {
      return;
    }
    this.dragMode = event.button === 1 || event.shiftKey ? 'pan' : 'orbit';
    this.lastPointer = [event.clientX, event.clientY];
    this.attachedCanvas?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.inputEnabled || !this.dragMode) {
      return;
    }
    const deltaX = event.clientX - this.lastPointer[0]; const deltaY = event.clientY - this.lastPointer[1];
    this.lastPointer = [event.clientX, event.clientY];
    if (this.dragMode === 'orbit') {
      this.orbit(deltaX, deltaY);
    } else {
      this.pan(deltaX, deltaY);
    }
    event.preventDefault();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.dragMode = null;
    this.attachedCanvas?.releasePointerCapture?.(event.pointerId);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.inputEnabled) {
      return;
    }
    this.dolly(event.deltaY);
    event.preventDefault();
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
