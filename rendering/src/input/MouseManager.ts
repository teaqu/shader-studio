export class MouseManager {
  private mouse = new Float32Array([0, 0, 0, 0]);
  private isMouseDown = false;
  private enabled = true;

  public getMouse(): Float32Array {
    return this.mouse;
  }

  public setupEventListeners(canvas: HTMLCanvasElement): void {
    const onMouseDown = (e: MouseEvent) => {
      if (!this.enabled) return;
      this.isMouseDown = true;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / rect.width * canvas.width);
      const y = Math.floor(
        canvas.height - (e.clientY - rect.top) / rect.height * canvas.height,
      );
      this.mouse[0] = x;
      this.mouse[1] = y;
      this.mouse[2] = x;
      this.mouse[3] = y;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.enabled) return;
      if (!this.isMouseDown) return;
      const rect = canvas.getBoundingClientRect();
      this.mouse[0] = Math.floor(
        (e.clientX - rect.left) / rect.width * canvas.width,
      );
      this.mouse[1] = Math.floor(
        canvas.height - (e.clientY - rect.top) / rect.height * canvas.height,
      );
    };

    const onMouseUp = () => {
      if (!this.enabled) return;
      this.isMouseDown = false;
      // Negate z and w to indicate mouse is up, following ShaderToy convention.
      this.mouse[2] = -Math.abs(this.mouse[2]);
      this.mouse[3] = -Math.abs(this.mouse[3]);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.isMouseDown = false;
    }
  }
}
