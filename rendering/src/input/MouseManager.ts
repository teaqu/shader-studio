export class MouseManager {
  private mouse = new Float32Array([0, 0, 0, 0]);
  private isMouseDown = false;
  private enabled = true;
  private canvas: HTMLCanvasElement | null = null;

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled || !this.canvas) {
      return;
    }
    this.isMouseDown = true;
    const { x, y } = this.getCanvasPosition(e, this.canvas);
    this.mouse[0] = x;
    this.mouse[1] = y;
    this.mouse[2] = x;
    this.mouse[3] = y;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled || !this.isMouseDown || !this.canvas) {
      return;
    }
    const { x, y } = this.getCanvasPosition(e, this.canvas);
    this.mouse[0] = x;
    this.mouse[1] = y;
  };

  private readonly onMouseUp = (): void => {
    if (!this.enabled) {
      return;
    }
    this.isMouseDown = false;
    this.mouse[2] = -Math.abs(this.mouse[2]);
    this.mouse[3] = -Math.abs(this.mouse[3]);
  };

  public getMouse(): Float32Array {
    return this.mouse;
  }

  public setupEventListeners(canvas: HTMLCanvasElement): void {
    this.dispose();
    this.canvas = canvas;
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("mousemove", this.onMouseMove);
  }

  public dispose(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.removeEventListener?.("mousedown", this.onMouseDown);
    this.canvas.removeEventListener?.("mouseup", this.onMouseUp);
    this.canvas.removeEventListener?.("mousemove", this.onMouseMove);
    this.canvas = null;
    this.isMouseDown = false;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.isMouseDown = false;
    }
  }

  private getCanvasPosition(e: MouseEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / rect.width * canvas.width),
      y: Math.floor(canvas.height - (e.clientY - rect.top) / rect.height * canvas.height),
    };
  }
}
