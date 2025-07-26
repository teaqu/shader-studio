export class ShaderLocker {
    private isLocked = false;
    private lockedShaderPath: string | null = null;

    public getIsLocked(): boolean {
        return this.isLocked;
    }

    public getLockedShaderPath(): string | null {
        return this.lockedShaderPath;
    }

    public toggleLock(currentShaderPath?: string): void {
        this.isLocked = !this.isLocked;

        if (this.isLocked) {
            this.lockedShaderPath = currentShaderPath || null;
            console.log(`ShaderLocker: Locked to shader at path: ${this.lockedShaderPath || 'unknown'}`);
        } else {
            this.lockedShaderPath = null;
            console.log('ShaderLocker: Unlocked');
        }
    }

    public shouldProcessShader(incomingShaderPath: string): boolean {
        if (!this.isLocked || !this.lockedShaderPath) {
            return true;
        }

        const shouldProcess = incomingShaderPath === this.lockedShaderPath;

        if (!shouldProcess) {
            console.log(`ShaderLocker: Ignoring shader ${incomingShaderPath} - locked to ${this.lockedShaderPath}`);
        }

        return shouldProcess;
    }

    public updateLockedShader(shaderPath: string): void {
        if (this.isLocked) {
            this.lockedShaderPath = shaderPath;
        }
    }
}
