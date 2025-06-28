export class InputManager {
  private mouse = new Float32Array([0, 0, 0, 0]);
  private isMouseDown = false;
  private keyHeld = new Uint8Array(256);
  private keyPressed = new Uint8Array(256);
  private keyToggled = new Uint8Array(256);

  public getMouse(): Float32Array {
    return this.mouse;
  }

  public getKeyHeld(): Uint8Array {
    return this.keyHeld;
  }

  public getKeyPressed(): Uint8Array {
    return this.keyPressed;
  }

  public getKeyToggled(): Uint8Array {
    return this.keyToggled;
  }

  public setupEventListeners(canvas: HTMLCanvasElement): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.keyCode >= 256) return;
      // If key was not previously held, it's a "just pressed" event
      if (this.keyHeld[e.keyCode] === 0) {
        this.keyPressed[e.keyCode] = 255;
        // Toggle state only changes on initial press
        this.keyToggled[e.keyCode] = this.keyToggled[e.keyCode] === 255
          ? 0
          : 255;
      }
      // Set key as held
      this.keyHeld[e.keyCode] = 255;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.keyCode >= 256) return;
      // Unset key as held
      this.keyHeld[e.keyCode] = 0;
    };

    const onMouseDown = (e: MouseEvent) => {
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
      this.isMouseDown = false;
      // Negate z and w to indicate mouse is up, following ShaderToy convention.
      this.mouse[2] = -Math.abs(this.mouse[2]);
      this.mouse[3] = -Math.abs(this.mouse[3]);
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousemove", onMouseMove);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  public clearPressed(): void {
    this.keyPressed.fill(0);
  }
}
