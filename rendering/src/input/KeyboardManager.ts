export class KeyboardManager {
  private listeners = new Set<(code: string, down: boolean, source: 'physical' | 'injected') => void>();
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
    this.emit(e.code, true, 'physical');
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
    this.emit(e.code, false, 'physical');
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

  /** Enables physical browser keyboard handlers; direct automation remains available. */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearTransientState();
    }
  }

  /** Apply a canonical DOM code without dispatching a global browser event. */
  public inject(code: string, down: boolean): void {
    const keyCode = keyCodeForCode(code);
    if (keyCode === undefined) {
      throw new Error(`Unsupported keyboard code: ${code}`);
    }
    this.setKey(keyCode, down);
    this.emit(code, down, 'injected');
  }

  onInput(listener: (code: string, down: boolean, source: 'physical' | 'injected') => void): { dispose(): void } {
    this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
  }

  /** Releases all held keys while retaining toggle state, matching key-up events. */
  public releaseAll(): void {
    for (const code of this.getHeldCodes()) {
      this.emit(code, false, 'injected');
    }
    this.keyHeld.fill(0);
    this.keyPressed.fill(0);
  }

  public getHeldCodes(): string[] {
    return Array.from(this.keyHeld).flatMap((value, keyCode) => value ? [codeForKeyCode(keyCode)] : []).filter((code): code is string => code !== undefined);
  }

  private clearTransientState(): void {
    for (const code of this.getHeldCodes()) {
      this.emit(code, false, 'physical');
    }
    this.keyHeld.fill(0);
    this.keyPressed.fill(0);
  }

  private setKey(keyIndex: number, down: boolean): void {
    if (down) {
      if (this.keyHeld[keyIndex] === 0) {
        this.keyPressed[keyIndex] = 255;
        this.keyToggled[keyIndex] = this.keyToggled[keyIndex] === 255 ? 0 : 255;
      }
      this.keyHeld[keyIndex] = 255;
      return;
    }
    this.keyHeld[keyIndex] = 0;
  }

  private emit(code: string, down: boolean, source: 'physical' | 'injected'): void {
    for (const listener of this.listeners) {
      listener(code, down, source);
    }
  }

  private getKeyIndex(e: KeyboardEvent): number {
    // Will keep deprecated keyCode for compatibility with shadertoy for now
    return e.keyCode;
  }
}

/** Keyboard texture indexes are legacy keyCode values; keep the MCP API layout-stable. */
export function keyCodeForCode(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) {
    return code.charCodeAt(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.charCodeAt(5);
  }
  return ({ Space: 32, Enter: 13, Escape: 27, Tab: 9, Backspace: 8,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  } as Record<string, number>)[code];
}
function codeForKeyCode(keyCode: number): string | undefined {
  if (keyCode >= 65 && keyCode <= 90) {
    return `Key${String.fromCharCode(keyCode)}`;
  }
  if (keyCode >= 48 && keyCode <= 57) {
    return `Digit${String.fromCharCode(keyCode)}`;
  }
  return ({ 32: 'Space', 13: 'Enter', 27: 'Escape', 9: 'Tab', 8: 'Backspace', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' } as Record<number, string>)[keyCode];
}
