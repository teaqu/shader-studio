import type { ShaderConfig, BufferPass, ImagePass } from '@shader-studio/types';
import type { Transport } from './transport/MessageTransport';

export class ConfigManager {
    private config: ShaderConfig | null = null;
    private pathMap: Record<string, string> = {};
    private transport: Transport | null = null;
    private onConfigChange?: (config: ShaderConfig) => void;
    private shaderPath: string = "";

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
     * Create a minimal default configuration
     */
    private createDefaultConfig(): ShaderConfig {
        return {
            version: "1.0",
            passes: {
                Image: {
                    inputs: {}
                }
            }
        };
    }

    /**
     * Ensure config exists, creating a default one if needed
     */
    private ensureConfig(): void {
        if (!this.config) {
            this.config = this.createDefaultConfig();
        }
    }

    /**
     * Set the shader file path (used for generating buffer filenames)
     */
    public setShaderPath(shaderPath: string): void {
        this.shaderPath = shaderPath;
    }

    /**
     * Get the shader file path
     */
    public getShaderPath(): string {
        return this.shaderPath;
    }

    /**
     * Generate a buffer file path based on the current shader name
     * e.g., myshader.glsl → myshader.buffera.glsl
     */
    public generateBufferPath(bufferName: string): string {
        if (!this.shaderPath) return '';

        // Extract just the filename without path
        const parts = this.shaderPath.replace(/\\/g, '/').split('/');
        const filename = parts[parts.length - 1];
        const baseName = filename.replace(/\.glsl$/, '');

        const suffix = bufferName.toLowerCase();
        return `${baseName}.${suffix}.glsl`;
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
        // Ensure config exists (create default if null)
        this.ensureConfig();

        // Check if buffer already exists
        if (this.config!.passes[bufferName as keyof typeof this.config.passes]) return false;

        const updatedConfig = {
            ...this.config!,
            passes: {
                ...this.config!.passes,
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
     * Send a message to the extension to create a buffer file
     */
    createBufferFile(bufferName: string, filePath: string): void {
        if (!this.transport) return;
        this.transport.postMessage({
            type: 'createBufferFile',
            payload: {
                bufferName,
                filePath
            }
        });
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
        this.ensureConfig();

        const updatedConfig = {
            ...this.config!,
            passes: {
                ...this.config!.passes,
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
        this.ensureConfig();

        const updatedConfig = {
            ...this.config!,
            passes: {
                ...this.config!.passes,
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
        // Ensure config exists (create default if null)
        this.ensureConfig();

        // Check if common buffer already exists
        if (this.config!.passes.common) {
            return false; // Already exists
        }

        this.config!.passes.common = {
            path: ''
            // No inputs for common buffer
        };

        // Trigger UI update
        this.updateConfig(this.config!);
        return true;
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
            // Strip resolved_path from config before saving - it's only for rendering
            const cleanText = JSON.stringify(newConfig, (key, value) => {
                if (key === 'resolved_path') return undefined;
                return value;
            }, 2);
            this.transport.postMessage({
                type: 'updateConfig',
                payload: {
                    config: newConfig,
                    text: cleanText,
                    shaderPath: this.shaderPath
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
