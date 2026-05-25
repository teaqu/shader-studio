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
      return;
    }

    if (!currentShaderPath) {
      return;
    }

    this.lockedShaderPath = currentShaderPath;
  }
}
