export class KeyboardManager {
  private keyHeld = new Uint8Array(256);
  private keyPressed = new Uint8Array(256);
  private keyToggled = new Uint8Array(256);

  public getKeyHeld(): Uint8Array {
    return this.keyHeld;
  }

  public getKeyPressed(): Uint8Array {
    return this.keyPressed;
  }

  public getKeyToggled(): Uint8Array {
    return this.keyToggled;
  }

  public setupEventListeners(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      const keyIndex = this.getKeyIndex(e);
      if (keyIndex >= 256) return;
      // If key was not previously held, it's a "just pressed" event
      if (this.keyHeld[keyIndex] === 0) {
        this.keyPressed[keyIndex] = 255;
        // Toggle state only changes on initial press
        this.keyToggled[keyIndex] = this.keyToggled[keyIndex] === 255
          ? 0
          : 255;
      }
      // Set key as held
      this.keyHeld[keyIndex] = 255;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const keyIndex = this.getKeyIndex(e);
      if (keyIndex >= 256) return;
      // Unset key as held
      this.keyHeld[keyIndex] = 0;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  public clearPressed(): void {
    this.keyPressed.fill(0);
  }

  private getKeyIndex(e: KeyboardEvent): number {
    // Will keep deprecated keyCode for compatibility with shadertoy for now
    return e.keyCode;
  }
}
