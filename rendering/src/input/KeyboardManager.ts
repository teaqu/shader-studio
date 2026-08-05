export class KeyboardManager {
  private keyHeld = new Uint8Array(256);
  private keyPressed = new Uint8Array(256);
  private keyToggled = new Uint8Array(256);
  private enabled = true;
  private listening = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) {
      return;
    }
    const keyIndex = this.getKeyIndex(e);
    if (keyIndex >= 256) {
      return;
    }
    if (this.keyHeld[keyIndex] === 0) {
      this.keyPressed[keyIndex] = 255;
      this.keyToggled[keyIndex] = this.keyToggled[keyIndex] === 255 ? 0 : 255;
    }
    this.keyHeld[keyIndex] = 255;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!this.enabled) {
      return;
    }
    const keyIndex = this.getKeyIndex(e);
    if (keyIndex >= 256) {
      return;
    }
    this.keyHeld[keyIndex] = 0;
  };

  private readonly onBlur = (): void => {
    this.clearTransientState();
  };

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
    this.dispose();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.listening = true;
  }

  public dispose(): void {
    if (!this.listening) {
      return;
    }
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.listening = false;
    this.clearTransientState();
  }

  public clearPressed(): void {
    this.keyPressed.fill(0);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearTransientState();
    }
  }

  private clearTransientState(): void {
    this.keyHeld.fill(0);
    this.keyPressed.fill(0);
  }

  private getKeyIndex(e: KeyboardEvent): number {
    // Will keep deprecated keyCode for compatibility with shadertoy for now
    return e.keyCode;
  }
}
