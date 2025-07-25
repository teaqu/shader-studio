import type { ShaderConfig, BufferPass, ImagePass } from '@shader-view/types';

export class ConfigEditor {
    private config: ShaderConfig | null = null;
    private vsCodeApi: any = null;
    private onConfigUpdate?: (config: ShaderConfig | null) => void;
    private onError?: (error: string | null) => void;

    constructor(
        onConfigUpdate?: (config: ShaderConfig | null) => void,
        onError?: (error: string | null) => void
    ) {
        this.onConfigUpdate = onConfigUpdate;
        this.onError = onError;
    }

    /**
     * Initialize the config editor with VS Code API
     */
    initialize(): void {
        // Initialize VS Code API if available
        if (typeof (window as any).acquireVsCodeApi !== 'undefined') {
            this.vsCodeApi = (window as any).acquireVsCodeApi();
        }

        // Listen for config updates from VS Code
        window.addEventListener('message', (event) => {
            this.handleMessage(event.data);
        });
    }

    /**
     * Handle messages from VS Code
     */
    private handleMessage(message: any): void {
        switch (message.type) {
            case 'update':
                this.parseAndUpdateConfig(message.text);
                break;
        }
    }

    /**
     * Parse config text and update internal state
     */
    private parseAndUpdateConfig(text: string): void {
        try {
            const trimmedText = text.trim();
            if (trimmedText) {
                const parsedConfig = JSON.parse(trimmedText);
                console.log('Parsed config from VS Code:', parsedConfig);
                this.setConfig(parsedConfig);
                this.setError(null);
            } else {
                // Initialize with default config structure
                const defaultConfig: ShaderConfig = {
                    version: "1.0",
                    Image: {
                        inputs: {}
                    }
                };
                console.log('Using default config');
                this.setConfig(defaultConfig);
                this.setError(null);
            }
        } catch (e) {
            const errorMessage = `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
            console.error('Config parse error:', errorMessage);
            this.setError(errorMessage);
            this.setConfig(null);
        }
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
                [bufferName]: {
                    path: `${bufferName.toLowerCase()}.glsl`,
                    inputs: {}
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
        if (this.config[bufferName as keyof ShaderConfig]) return false;

        const updatedConfig = {
            ...this.config,
            [bufferName]: {
                path: '',
                inputs: {}
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

        const updatedConfig = { ...this.config };
        delete updatedConfig[bufferName as keyof ShaderConfig];
        this.updateConfig(updatedConfig);
        return true;
    }

    /**
     * Update a buffer's path
     */
    updateBufferPath(bufferName: string, path: string): boolean {
        if (!this.config) return false;

        const currentBuffer = this.config[bufferName as keyof ShaderConfig] as BufferPass;
        if (!currentBuffer) return false;

        const updatedConfig = {
            ...this.config,
            [bufferName]: {
                ...currentBuffer,
                path
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
            [bufferName]: bufferConfig
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
            Image: imageConfig
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
     * Get the next available buffer name
     */
    getNextBufferName(): string | null {
        if (!this.config) return 'BufferA';

        const buffers = ['BufferA', 'BufferB', 'BufferC', 'BufferD'];
        return buffers.find(buffer => !this.config![buffer as keyof ShaderConfig]) || null;
    }

  /**
   * Get list of configured buffers
   */
  getBufferList(): string[] {
    if (!this.config) {
      console.log('getBufferList: no config available');
      return [];
    }
    console.log('getBufferList: config is:', this.config);
    const result = ['BufferA', 'BufferB', 'BufferC', 'BufferD'].filter(
      buffer => {
        const exists = !!this.config![buffer as keyof ShaderConfig];
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
        const buffer = this.config[bufferName as keyof ShaderConfig];
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
        const imageInputs = Object.keys(this.config.Image.inputs || {}).length;
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
     * Update the configuration and notify VS Code
     */
    private updateConfig(newConfig: ShaderConfig): void {
        console.log('Updating config:', newConfig);
        this.setConfig(newConfig);

        // Send update back to VS Code
        if (this.vsCodeApi) {
            console.log('Sending updateConfig message to VS Code');
            this.vsCodeApi.postMessage({
                type: 'updateConfig',
                config: newConfig,
                text: JSON.stringify(newConfig, null, 2)
            });
        } else {
            console.warn('VS Code API not available');
        }
    }

    /**
     * Set the configuration and notify listeners
     */
    private setConfig(config: ShaderConfig | null): void {
        this.config = config;
        if (this.onConfigUpdate) {
            this.onConfigUpdate(config);
        }
    }

    /**
     * Set error state and notify listeners
     */
    private setError(error: string | null): void {
        if (this.onError) {
            this.onError(error);
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
