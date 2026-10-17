import { preventCanvasMouseDefault } from "./CanvasInputDefaults";
/**
 * Pointer input for iMouse, following Shadertoy's player: xy tracks the
 * pointer only while a button is held, zw hold the click position, z is
 * positive while a button is held, and w is positive only on the frame of
 * the click. Any button counts, as it does on Shadertoy.
 */
import type { PointerState } from "@shader-studio/types";

export class MouseManager {
  private mouse = new Float32Array([0, 0, 0, 0]);
  private isMouseDown = false;
  // Set by a click and cleared by endFrame(), so w signals one frame.
  private clickSignalled = false;
  private enabled = true;
  private canvas: HTMLCanvasElement | null = null;
  private pointer: PointerState = {
    position: [0, 0], inside: 0, held: 0, pressed: 0, released: 0,
    modifiers: 0, wheel: [0, 0], wheelDelta: [0, 0],
  };

  private updatePointer(e: PointerEvent, buttons = e.buttons): void {
    if (!this.canvas) {
      return;
    }
    const { x, y } = this.getCanvasPosition(e, this.canvas);
    this.pointer.position = [x, y];
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.inside = Number(e.clientX >= rect.left && e.clientX < rect.left + rect.width
      && e.clientY >= rect.top && e.clientY < rect.top + rect.height);
    this.pointer.modifiers = Number(e.shiftKey) | Number(e.ctrlKey) << 1
      | Number(e.altKey) << 2 | Number(e.metaKey) << 3;
    this.pointer.pressed |= buttons & ~this.pointer.held;
    this.pointer.released |= this.pointer.held & ~buttons;
    this.pointer.held = buttons;
  }

  private readonly onPointerEnter = (e: PointerEvent): void => {
    if (this.enabled) {
      this.updatePointer(e);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.pointer.inside = 0;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled || !this.canvas) {
      return;
    }
    preventCanvasMouseDefault(this.canvas, e);
    const rect = this.canvas.getBoundingClientRect();
    // Normalize line units to 16 CSS pixels; page units follow the canvas size.
    const scaleX = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.width : 1;
    const scaleY = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
    const delta: [number, number] = [e.deltaX * scaleX, e.deltaY * scaleY];
    for (const axis of [0, 1] as const) {
      this.pointer.wheel[axis] += delta[axis];
      this.pointer.wheelDelta[axis] += delta[axis];
    }
    const { x, y } = this.getCanvasPosition(e, this.canvas);
    this.pointer.position = [x, y];
    this.pointer.modifiers = Number(e.shiftKey) | Number(e.ctrlKey) << 1
      | Number(e.altKey) << 2 | Number(e.metaKey) << 3;
  };

  private readonly onAuxClick = (e: MouseEvent): void => {
    if (this.enabled && e.button !== 0) {
      preventCanvasMouseDefault(this.canvas, e);
    }
  };

  private readonly onLostPointerCapture = (): void => {
    // Normal release also loses capture; keep hover/inside in that case.
    if (this.pointer.held !== 0) {
      this.onPointerCancel();
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled || !this.canvas) {
      return;
    }
    // Real pointerdown includes buttons; the fallback also supports synthetic events.
    this.updatePointer(e, e.buttons || (e.button === 1 ? 4 : e.button === 2 ? 2 : 1 << e.button));
    this.isMouseDown = true;
    this.clickSignalled = true;
    const { x, y } = this.getCanvasPosition(e, this.canvas);
    this.mouse[0] = x;
    this.mouse[1] = y;
    this.mouse[2] = x;
    this.mouse[3] = y;
    this.updateSigns();
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled || !this.canvas) {
      return;
    }
    // Additional button presses/releases arrive as pointermove. iMouse keeps
    // its existing drag/click semantics; iPointer tracks the full button mask.
    this.updatePointer(e);
    this.updateSigns();
    if (!this.isMouseDown) {
      return;
    }
    const { x, y } = this.getCanvasPosition(e, this.canvas);
    this.mouse[0] = x;
    this.mouse[1] = y;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.enabled) {
      return;
    }
    this.updatePointer(e);
    this.isMouseDown = e.buttons !== 0;
    this.updateSigns();
    if (this.canvas?.hasPointerCapture?.(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  };

  private readonly onPointerCancel = (): void => {
    this.pointer.released |= this.pointer.held;
    this.pointer.held = 0;
    this.pointer.inside = 0;
    this.pointer.modifiers = 0;
    this.isMouseDown = false;
    this.clickSignalled = false;
    this.updateSigns();
  };

  public getMouse(): Float32Array {
    return this.mouse;
  }

  public getPointer(): PointerState {
    return { ...this.pointer, position: [...this.pointer.position], wheel: [...this.pointer.wheel], wheelDelta: [...this.pointer.wheelDelta] };
  }

  /** Call once per rendered frame, after its passes have read the mouse. */
  public endFrame(): void {
    this.pointer.pressed = 0;
    this.pointer.released = 0;
    this.pointer.wheelDelta = [0, 0];
    this.clickSignalled = false;
    this.updateSigns();
  }

  public setupEventListeners(canvas: HTMLCanvasElement): void {
    this.dispose();
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("lostpointercapture", this.onLostPointerCapture);
    canvas.addEventListener("pointerenter", this.onPointerEnter);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("auxclick", this.onAuxClick);
    canvas.addEventListener("mousedown", this.onAuxClick);
    canvas.ownerDocument?.defaultView?.addEventListener("blur", this.onPointerCancel);
    if (canvas.style) {
      canvas.style.touchAction = "none";
    }
  }

  public dispose(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.removeEventListener?.("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener?.("pointerup", this.onPointerUp);
    this.canvas.removeEventListener?.("pointermove", this.onPointerMove);
    this.canvas.removeEventListener?.("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener?.("lostpointercapture", this.onLostPointerCapture);
    this.canvas.removeEventListener?.("pointerenter", this.onPointerEnter);
    this.canvas.removeEventListener?.("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener?.("wheel", this.onWheel);
    this.canvas.removeEventListener?.("auxclick", this.onAuxClick);
    this.canvas.removeEventListener?.("mousedown", this.onAuxClick);
    this.canvas.ownerDocument?.defaultView?.removeEventListener("blur", this.onPointerCancel);
    if (this.canvas.style) {
      this.canvas.style.touchAction = "";
    }
    this.canvas = null;
    this.onPointerCancel();
    this.endFrame();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.onPointerCancel();
      this.endFrame();
    }
  }

  private updateSigns(): void {
    // `|| 0` keeps an untouched mouse at +0 rather than -0.
    this.mouse[2] = (this.isMouseDown ? 1 : -1) * Math.abs(this.mouse[2]) || 0;
    this.mouse[3] = (this.clickSignalled ? 1 : -1) * Math.abs(this.mouse[3]) || 0;
  }

  private getCanvasPosition(e: { clientX: number; clientY: number }, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / rect.width * canvas.width),
      y: Math.floor(canvas.height - (e.clientY - rect.top) / rect.height * canvas.height),
    };
  }
}
