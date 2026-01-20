export class ShaderLocker {
    private locked = false;
    private lockedShaderPath?: string;

    public isLocked(): boolean {
        return this.locked;
    }

    public getLockedShaderPath(): string | undefined {
        return this.lockedShaderPath;
    }

    public toggleLock(currentShaderPath?: string): void {
        this.locked = !this.locked;

        if (this.locked) {
            this.lockedShaderPath = currentShaderPath;
            console.log(`ShaderLocker: Locked to shader at path: ${this.lockedShaderPath || 'unknown'}`);
        } else {
            this.lockedShaderPath = undefined;
            console.log('ShaderLocker: Unlocked');
        }
    }

    public updateLockedShader(shaderPath: string): void {
        if (this.locked) {
            this.lockedShaderPath = shaderPath;
        }
    }
}
