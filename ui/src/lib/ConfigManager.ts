import type { ShaderConfig, BufferPass, ImagePass } from '@shader-studio/types';
import type { Transport } from './transport/MessageTransport';

export class ConfigManager {
    private config: ShaderConfig | null = null;
    private pathMap: Record<string, string> = {};
    private transport: Transport | null = null;
    private onConfigChange?: (config: ShaderConfig) => void;

    constructor(
        transport: Transport,
        onConfigChange?: (config: ShaderConfig) => void
    ) {
        this.transport = transport;
        this.onConfigChange = onConfigChange;
    }

    /**
     * Set the current configuration
     */
    public setConfig(config: ShaderConfig | null): void {
        this.config = config;
    }

    /**
     * Set the path map for resolving resource URIs
     */
    public setPathMap(pathMap: Record<string, string>): void {
        this.pathMap = pathMap;
    }

    /**
     * Get the webview URI for a given path
     */
    public getWebviewUri(path: string): string | undefined {
        return this.pathMap[path];
    }

    /**
     * Get the next available buffer name (BufferA, BufferB, etc.)
     */
    getNextBufferName(): string | null {
        if (!this.config) return null;

        const bufferOrder = ['BufferA', 'BufferB', 'BufferC', 'BufferD'];
        
        for (const bufferName of bufferOrder) {
            if (!this.config.passes[bufferName as keyof typeof this.config.passes]) {
                return bufferName;
            }
        }
        
        return null; // All buffers are already used
    }

    /**
     * Add a new buffer to the configuration
     */
    addBuffer(): string | null {
        if (!this.config) return null;

        const bufferName = this.getNextBufferName();
        if (bufferName) {
            const updatedConfig = {
                ...this.config,
                passes: {
                    ...this.config.passes,
                    [bufferName]: {
                        path: `${bufferName.toLowerCase()}.glsl`,
                        inputs: {}
                    }
                }
            };
            this.updateConfig(updatedConfig);
            return bufferName;
        }
        return null;
    }

    /**
     * Add a specific buffer to the configuration
     */
    addSpecificBuffer(bufferName: string): boolean {
        if (!this.config) return false;

        // Check if buffer already exists
        if (this.config.passes[bufferName as keyof typeof this.config.passes]) return false;

        const updatedConfig = {
            ...this.config,
            passes: {
                ...this.config.passes,
                [bufferName]: {
                    path: '',
                    inputs: {}
                }
            }
        };
        this.updateConfig(updatedConfig);
        return true;
    }

    /**
     * Remove a buffer from the configuration
     */
    removeBuffer(bufferName: string): boolean {
        if (!this.config) return false;

        const updatedPasses = { ...this.config.passes };
        delete updatedPasses[bufferName as keyof typeof updatedPasses];

        const updatedConfig = {
            ...this.config,
            passes: updatedPasses
        };
        this.updateConfig(updatedConfig);
        return true;
    }

    /**
     * Update a buffer's path
     */
    updateBufferPath(bufferName: string, path: string): boolean {
        if (!this.config) return false;

        const currentBuffer = this.config.passes[bufferName as keyof typeof this.config.passes] as BufferPass;
        if (!currentBuffer) return false;

        const updatedConfig = {
            ...this.config,
            passes: {
                ...this.config.passes,
                [bufferName]: {
                    ...currentBuffer,
                    path
                }
            }
        };
        this.updateConfig(updatedConfig);
        return true;
    }

    /**
     * Update an entire buffer configuration
     */
    updateBuffer(bufferName: string, bufferConfig: BufferPass): boolean {
        if (!this.config) return false;

        const updatedConfig = {
            ...this.config,
            passes: {
                ...this.config.passes,
                [bufferName]: bufferConfig
            }
        };
        this.updateConfig(updatedConfig);
        return true;
    }

    /**
     * Update the Image pass configuration
     */
    updateImagePass(imageConfig: ImagePass): boolean {
        if (!this.config) return false;

        const updatedConfig = {
            ...this.config,
            passes: {
                ...this.config.passes,
                Image: imageConfig
            }
        };
        this.updateConfig(updatedConfig);
        return true;
    }

    /**
     * Update the configuration version
     */
    updateVersion(version: string): boolean {
        if (!this.config) return false;

        const updatedConfig = {
            ...this.config,
            version
        };
        this.updateConfig(updatedConfig);
        return true;
    }

    /**
     * Add a common buffer pass to the configuration
     */
    public addCommonBuffer(): boolean {
        if (!this.config || !this.config.passes.common) {
            if (!this.config) return false;
            
            this.config.passes.common = {
                path: "common.glsl"
                // No inputs for common buffer
            };
            
            // Trigger UI update
            this.updateConfig(this.config);
            return true;
        }
        return false; // Already exists
    }

    getBufferList(): string[] {
        if (!this.config) {
            console.log('getBufferList: no config available');
            return [];
        }
        console.log('getBufferList: config is:', this.config);
        const result = ['common', 'BufferA', 'BufferB', 'BufferC', 'BufferD'].filter(
            buffer => {
                const exists = !!this.config!.passes[buffer as keyof typeof this.config.passes];
                console.log(`getBufferList: ${buffer} exists?`, exists);
                return exists;
            }
        );
        console.log('getBufferList: final result:', result);
        return result;
    }    /**
     * Get buffer configuration
     */
    getBuffer(bufferName: string): BufferPass | ImagePass | null {
        if (!this.config) return null;
        const buffer = this.config.passes[bufferName as keyof typeof this.config.passes];
        return (buffer && typeof buffer === 'object') ? buffer as BufferPass | ImagePass : null;
    }

    /**
     * Get the current configuration
     */
    getConfig(): ShaderConfig | null {
        return this.config;
    }

    /**
     * Get configuration as JSON string
     */
    getConfigAsJson(): string {
        return this.config ? JSON.stringify(this.config, null, 2) : '';
    }

    /**
     * Check if configuration is valid
     */
    isValid(): boolean {
        return this.config !== null && typeof this.config === 'object';
    }

    /**
     * Get configuration statistics
     */
    getStats(): {
        version: string;
        bufferCount: number;
        imageInputs: number;
        totalInputs: number;
    } {
        if (!this.config) {
            return {
                version: '',
                bufferCount: 0,
                imageInputs: 0,
                totalInputs: 0
            };
        }

        const buffers = this.getBufferList();
        const imageInputs = Object.keys(this.config.passes.Image.inputs || {}).length;
        const totalInputs = buffers.reduce((total, bufferName) => {
            const buffer = this.getBuffer(bufferName);
            return total + Object.keys(buffer?.inputs || {}).length;
        }, imageInputs);

        return {
            version: this.config.version || '',
            bufferCount: buffers.length,
            imageInputs,
            totalInputs
        };
    }

    /**
     * Update the configuration and notify via transport
     */
    private updateConfig(newConfig: ShaderConfig): void {
        console.log('Updating config:', newConfig);
        this.config = newConfig;

        // Notify change callback
        if (this.onConfigChange) {
            this.onConfigChange(newConfig);
        }

        // Send update back via transport
        if (this.transport) {
            console.log('Sending updateConfig message via transport');
            this.transport.postMessage({
                type: 'updateConfig',
                payload: {
                    config: newConfig,
                    text: JSON.stringify(newConfig, null, 2)
                }
            });
        } else {
            console.warn('Transport not available');
        }
    }

    /**
     * Dispose of event listeners and cleanup
     */
    dispose(): void {
        // Remove event listeners if needed
        // This would be called when the component is destroyed
    }
}
