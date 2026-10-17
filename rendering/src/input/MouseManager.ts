/**
 * Pointer input for iMouse, following Shadertoy's player: xy tracks the
 * pointer only while a button is held, zw hold the click position, z is
 * positive while a button is held, and w is positive only on the frame of
 * the click. Any button counts, as it does on Shadertoy.
 */
export class MouseManager {
  private listeners = new Set<(type: 'pointer_move' | 'pointer_down' | 'pointer_up', x: number | undefined, y: number | undefined, source: 'physical' | 'injected') => void>();
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
    this.emit('pointer_down', x, this.canvas.height - y, 'physical');
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled || !this.canvas || !this.isMouseDown) {
      return;
    }
    const { x, y } = this.getCanvasPosition(e, this.canvas);
    this.mouse[0] = x;
    this.mouse[1] = y;
    this.emit('pointer_move', x, this.canvas.height - y, 'physical');
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.enabled) {
      return;
    }
    this.isMouseDown = false;
    this.updateSigns();
    if (this.canvas?.hasPointerCapture?.(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    if (this.canvas) {
      const { x, y } = this.getCanvasPosition(e, this.canvas);
      this.emit('pointer_up', x, this.canvas.height - y, 'physical');
    }
  };

  private readonly onPointerCancel = (): void => {
    const wasDown = this.isMouseDown;
    this.isMouseDown = false;
    this.clickSignalled = false;
    this.updateSigns();
    if (wasDown) {
      this.emit('pointer_up', undefined, undefined, 'physical');
    }
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
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("lostpointercapture", this.onPointerCancel);
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
    this.canvas.removeEventListener?.("lostpointercapture", this.onPointerCancel);
    if (this.canvas.style) {
      this.canvas.style.touchAction = "";
    }
    this.canvas = null;
    this.isMouseDown = false;
  }

  /** Enables physical canvas pointer handlers; direct automation remains available. */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.isMouseDown = false;
      this.updateSigns();
    }
  }

  /** Inject a top-left canvas-pixel action without routing through DOM listeners. */
  public inject(type: 'pointer_move' | 'pointer_down' | 'pointer_up', x?: number, y?: number): void {
    if (type !== 'pointer_up' && (x === undefined || y === undefined)) {
      throw new Error(`${type} requires x and y.`);
    }
    if (type === 'pointer_down') {
      const point = this.shaderPoint(x!, y!);
      this.isMouseDown = true;
      this.clickSignalled = true;
      this.mouse[0] = point.x; this.mouse[1] = point.y;
      this.mouse[2] = point.x; this.mouse[3] = point.y;
      this.updateSigns();
    } else if (type === 'pointer_move' && this.isMouseDown) {
      const point = this.shaderPoint(x!, y!);
      this.mouse[0] = point.x; this.mouse[1] = point.y;
    } else if (type === 'pointer_up') {
      if (x !== undefined && y !== undefined && this.isMouseDown) {
        const point = this.shaderPoint(x, y);
        this.mouse[0] = point.x; this.mouse[1] = point.y;
      }
      this.isMouseDown = false;
      this.updateSigns();
    }
    this.emit(type, x, y, 'injected');
  }

  onInput(listener: (type: 'pointer_move' | 'pointer_down' | 'pointer_up', x: number | undefined, y: number | undefined, source: 'physical' | 'injected') => void): { dispose(): void } {
    this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
  }

  public releaseAll(): void {
    const wasDown = this.isMouseDown;
    this.isMouseDown = false;
    this.clickSignalled = false;
    this.updateSigns();
    if (wasDown) {
      this.emit('pointer_up', undefined, undefined, 'injected');
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

  private shaderPoint(x: number, y: number): { x: number; y: number } {
    if (!this.canvas) {
      throw new Error('Pointer input is unavailable before canvas initialization.');
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Pointer coordinates must be finite.');
    }
    const px = Math.min(this.canvas.width, Math.max(0, Math.floor(x)));
    const py = Math.min(this.canvas.height, Math.max(0, Math.floor(y)));
    return { x: px, y: this.canvas.height - py };
  }
  private emit(type: 'pointer_move' | 'pointer_down' | 'pointer_up', x: number | undefined, y: number | undefined, source: 'physical' | 'injected'): void {
    for (const listener of this.listeners) {
      listener(type, x, y, source);
    }
  }
}
