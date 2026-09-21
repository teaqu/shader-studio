/**
 * Pointer input for iMouse, following Shadertoy's player: xy tracks the
 * pointer only while a button is held, zw hold the click position, z is
 * positive while a button is held, and w is positive only on the frame of
 * the click. Any button counts, as it does on Shadertoy.
 */
export class MouseManager {
  private mouse = new Float32Array([0, 0, 0, 0]);
  private isMouseDown = false;
  // Set by a click and cleared by endFrame(), so w signals one frame.
  private clickSignalled = false;
  private enabled = true;
  private canvas: HTMLCanvasElement | null = null;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled || !this.canvas) {
      return;
    }
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
    if (!this.enabled || !this.canvas || !this.isMouseDown) {
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
    this.isMouseDown = false;
    this.updateSigns();
    this.canvas?.releasePointerCapture(e.pointerId);
  };

  public getMouse(): Float32Array {
    return this.mouse;
  }

  /** Call once per rendered frame, after its passes have read the mouse. */
  public endFrame(): void {
    this.clickSignalled = false;
    this.updateSigns();
  }

  public setupEventListeners(canvas: HTMLCanvasElement): void {
    this.dispose();
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointermove", this.onPointerMove);
  }

  public dispose(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.removeEventListener?.("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener?.("pointerup", this.onPointerUp);
    this.canvas.removeEventListener?.("pointermove", this.onPointerMove);
    this.canvas = null;
    this.isMouseDown = false;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.isMouseDown = false;
      this.updateSigns();
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
