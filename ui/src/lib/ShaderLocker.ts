export class ShaderLocker {
  private lockedShaderPath?: string;

  public isLocked(): boolean {
    return this.lockedShaderPath !== undefined;
  }

  public getLockedShaderPath(): string | undefined {
    return this.lockedShaderPath;
  }

  public toggleLock(currentShaderPath?: string): void {
    if (this.isLocked()) {
      this.lockedShaderPath = undefined;
      console.log('ShaderLocker: Unlocked');
      return;
    }

    if (!currentShaderPath) {
      console.log('ShaderLocker: Cannot lock without a shader path');
      return;
    }

    this.lockedShaderPath = currentShaderPath;
    console.log(`ShaderLocker: Locked to shader at path: ${this.lockedShaderPath}`);
  }
}
