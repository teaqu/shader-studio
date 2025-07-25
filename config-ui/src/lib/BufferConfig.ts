import type { BufferPass, ImagePass, ConfigInput } from './types/ShaderConfig';

export class BufferConfig {
  private bufferName: string;
  private config: BufferPass | ImagePass;
  private onUpdate?: (bufferName: string, config: BufferPass | ImagePass) => void;

  constructor(
    bufferName: string,
    config: BufferPass | ImagePass,
    onUpdate?: (bufferName: string, config: BufferPass | ImagePass) => void
  ) {
    this.bufferName = bufferName;
    this.config = config;
    this.onUpdate = onUpdate;
  }

  /**
   * Get the buffer name
   */
  getBufferName(): string {
    return this.bufferName;
  }

  /**
   * Get the current configuration
   */
  getConfig(): BufferPass | ImagePass {
    return this.config;
  }

  /**
   * Update the shader file path (only for BufferPass)
   */
  updatePath(path: string): void {
    // Only update path for BufferPass
    if ('path' in this.config) {
      this.config = {
        ...this.config,
        path
      };
      this.notifyUpdate();
    }
  }

  /**
   * Add an input channel
   */
  addInputChannel(channel: string, input: ConfigInput): void {
    this.config = {
      ...this.config,
      inputs: {
        ...this.config.inputs,
        [channel]: input
      }
    };
    this.notifyUpdate();
  }

  /**
   * Remove an input channel
   */
  removeInputChannel(channel: string): void {
    if (!this.config.inputs) return;

    const newInputs = { ...this.config.inputs };
    delete newInputs[channel as keyof typeof newInputs];

    this.config = {
      ...this.config,
      inputs: newInputs
    };
    this.notifyUpdate();
  }

  /**
   * Update an input channel
   */
  updateInputChannel(channel: string, input: ConfigInput): void {
    this.config = {
      ...this.config,
      inputs: {
        ...this.config.inputs,
        [channel]: input
      }
    };
    this.notifyUpdate();
  }

  /**
   * Update an input channel with partial data
   */
  updateInputChannelPartial(channel: string, updates: Partial<ConfigInput>): void {
    const existingInput = this.config.inputs?.[channel as keyof typeof this.config.inputs];

    // Create a properly typed input based on the type
    let updatedInput: ConfigInput;

    if (updates.type === 'buffer') {
      updatedInput = {
        type: 'buffer',
        source: (updates as any).source || (existingInput as any)?.source || 'BufferA'
      };
    } else if (updates.type === 'texture') {
      updatedInput = {
        type: 'texture',
        path: (updates as any).path || (existingInput as any)?.path || ''
      };
    } else if (updates.type === 'keyboard') {
      updatedInput = {
        type: 'keyboard'
      };
    } else {
      // Keep existing type if no type update
      const existing = existingInput as any;
      if (existing?.type === 'buffer') {
        updatedInput = {
          type: 'buffer',
          source: (updates as any).source || existing.source || 'BufferA'
        };
      } else if (existing?.type === 'texture') {
        updatedInput = {
          type: 'texture',
          path: (updates as any).path || existing.path || ''
        };
      } else {
        updatedInput = {
          type: 'keyboard'
        };
      }
    }

    this.updateInputChannel(channel, updatedInput);
  }

  /**
   * Get all input channels
   */
  getInputChannels(): Array<[string, ConfigInput]> {
    return Object.entries(this.config.inputs || {});
  }

  /**
   * Get available channel names
   */
  getAvailableChannels(): string[] {
    const used = Object.keys(this.config.inputs || {});
    return ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3'].filter(
      channel => !used.includes(channel)
    );
  }

  /**
   * Get input channel count
   */
  getInputChannelCount(): number {
    return Object.keys(this.config.inputs || {}).length;
  }

  /**
   * Check if a channel is available
   */
  isChannelAvailable(channel: string): boolean {
    return !this.config.inputs || !this.config.inputs[channel as keyof typeof this.config.inputs];
  }

  /**
   * Get suggested file path based on buffer name
   */
  getSuggestedPath(): string {
    return '';
  }

  /**
   * Validate the buffer configuration
   */
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Only validate path for BufferPass (not ImagePass)
    if ('path' in this.config) {
      if (!this.config.path || this.config.path.trim() === '') {
        errors.push('Shader file path is required');
      }

      if (this.config.path && !this.config.path.endsWith('.glsl')) {
        errors.push('Shader file should have .glsl extension');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Notify parent of configuration update
   */
  private notifyUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.bufferName, this.config);
    }
  }

  /**
   * Set the configuration
   */
  setConfig(config: BufferPass): void {
    this.config = config;
    this.notifyUpdate();
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): BufferPass | ImagePass {
    return this.config;
  }
}
