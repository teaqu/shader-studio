export class ShaderLocker {
    private isLocked = false;
    private lockedShaderName: string | null = null;

    public getIsLocked(): boolean {
        return this.isLocked;
    }

    public getLockedShaderName(): string | null {
        return this.lockedShaderName;
    }

    public toggleLock(currentShaderName?: string): void {
        this.isLocked = !this.isLocked;

        if (this.isLocked) {
            this.lockedShaderName = currentShaderName || null;
            console.log(`ShaderLocker: Locked to shader: ${this.lockedShaderName || 'unknown'}`);
        } else {
            this.lockedShaderName = null;
            console.log('ShaderLocker: Unlocked');
        }
    }

    public shouldProcessShader(incomingShaderName: string): boolean {
        if (!this.isLocked || !this.lockedShaderName) {
            return true;
        }

        const shouldProcess = incomingShaderName === this.lockedShaderName;

        if (!shouldProcess) {
            console.log(`ShaderLocker: Ignoring shader ${incomingShaderName} - locked to ${this.lockedShaderName}`);
        }

        return shouldProcess;
    }

    public updateLockedShader(shaderName: string): void {
        if (this.isLocked) {
            this.lockedShaderName = shaderName;
        }
    }
}
