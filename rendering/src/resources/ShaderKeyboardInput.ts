import type { PiRenderer, PiTexture } from "../types/piRenderer";

export class ShaderKeyboardInput {
  private static readonly KEYBOARD_SIZE = 256;
  private static readonly KEYBOARD_LAYERS = 3;

  private keyboardTexture: PiTexture | null = null;
  private readonly keyboardBuffer = new Uint8Array(
    ShaderKeyboardInput.KEYBOARD_SIZE * ShaderKeyboardInput.KEYBOARD_LAYERS
  );

  constructor(private readonly renderer: PiRenderer) {}

  public getKeyboardTexture(): PiTexture | null {
    return this.keyboardTexture;
  }

  public updateKeyboardTexture(
    keyHeld: Uint8Array,
    keyPressed: Uint8Array,
    keyToggled: Uint8Array,
  ): void {
    this.updateKeyboardBuffer(keyHeld, keyPressed, keyToggled);
    
    if (!this.keyboardTexture) {
      this.createKeyboardTexture();
    } else {
      this.updateExistingKeyboardTexture();
    }
  }

  public cleanup(): void {
    if (this.keyboardTexture) {
      this.renderer.DestroyTexture(this.keyboardTexture);
      this.keyboardTexture = null;
    }
  }

  private updateKeyboardBuffer(
    keyHeld: Uint8Array,
    keyPressed: Uint8Array,
    keyToggled: Uint8Array,
  ): void {
    this.keyboardBuffer.set(keyHeld, 0);
    this.keyboardBuffer.set(keyPressed, ShaderKeyboardInput.KEYBOARD_SIZE);
    this.keyboardBuffer.set(keyToggled, ShaderKeyboardInput.KEYBOARD_SIZE * 2);
  }

  private createKeyboardTexture(): void {
    this.keyboardTexture = this.renderer.CreateTexture(
      this.renderer.TEXTYPE.T2D,
      ShaderKeyboardInput.KEYBOARD_SIZE,
      ShaderKeyboardInput.KEYBOARD_LAYERS,
      this.renderer.TEXFMT.C1I8,
      this.renderer.FILTER.NONE,
      this.renderer.TEXWRP.CLAMP,
      this.keyboardBuffer,
    );
  }

  private updateExistingKeyboardTexture(): void {
    if (this.keyboardTexture) {
      this.renderer.UpdateTexture(
        this.keyboardTexture,
        0,
        0,
        ShaderKeyboardInput.KEYBOARD_SIZE,
        ShaderKeyboardInput.KEYBOARD_LAYERS,
        this.keyboardBuffer,
      );
    }
  }
}
