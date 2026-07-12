import type { TextureBackend } from "./TextureBackend";

export class ShaderKeyboardInput<T> {
  private static readonly KEYBOARD_SIZE = 256;
  private static readonly KEYBOARD_LAYERS = 3;

  private keyboardTexture: T | null = null;
  private readonly keyboardBuffer = new Uint8Array(
    ShaderKeyboardInput.KEYBOARD_SIZE * ShaderKeyboardInput.KEYBOARD_LAYERS
  );

  constructor(private readonly backend: TextureBackend<T>) {}

  public getKeyboardTexture(): T | null {
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
      this.backend.destroyTexture(this.keyboardTexture);
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
    this.keyboardTexture = this.backend.createTexture({
      type: "2d",
      width: ShaderKeyboardInput.KEYBOARD_SIZE,
      height: ShaderKeyboardInput.KEYBOARD_LAYERS,
      format: "r8",
      filter: "nearest",
      wrap: "clamp",
      data: this.keyboardBuffer,
    });
  }

  private updateExistingKeyboardTexture(): void {
    if (this.keyboardTexture) {
      this.backend.updateTexture(
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
