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
    console.log(`Updating input channel ${channel} with updates:`, updates);
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
        path: this.newElseExistingInput((updates as any).path, (existingInput as any)?.path),
        filter: this.newElseExistingInput((updates as any).filter, (existingInput as any)?.filter),
        wrap: this.newElseExistingInput((updates as any).wrap, (existingInput as any)?.wrap),
        vflip: this.newElseExistingInput((updates as any).vflip, (existingInput as any)?.vflip),
        grayscale: this.newElseExistingInput((updates as any).grayscale, (existingInput as any)?.grayscale)
      };
    } else if (updates.type === 'video') {
      updatedInput = {
        type: 'video',
        path: this.newElseExistingInput((updates as any).path, (existingInput as any)?.path),
        filter: this.newElseExistingInput((updates as any).filter, (existingInput as any)?.filter),
        wrap: this.newElseExistingInput((updates as any).wrap, (existingInput as any)?.wrap),
        vflip: this.newElseExistingInput((updates as any).vflip, (existingInput as any)?.vflip)
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
          path: (updates as any).path || existing.path || '',
          filter: (updates as any).filter || existing.filter,
          wrap: (updates as any).wrap || existing.wrap,
          vflip: (updates as any).vflip !== undefined ? (updates as any).vflip : existing.vflip,
          grayscale: (updates as any).grayscale !== undefined ? (updates as any).grayscale : existing.grayscale
        };
      } else if (existing?.type === 'video') {
        updatedInput = {
          type: 'video',
          path: (updates as any).path || existing.path || '',
          filter: (updates as any).filter || existing.filter,
          wrap: (updates as any).wrap || existing.wrap,
          vflip: (updates as any).vflip !== undefined ? (updates as any).vflip : existing.vflip
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

  getInputChannel(channel: string): ConfigInput | undefined {
    return this.config.inputs ? this.config.inputs[channel as keyof typeof this.config.inputs] : undefined;
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

    // Validate input channels
    if (this.config.inputs) {
      for (const [channelName, input] of Object.entries(this.config.inputs)) {
        if (!this.validateInput(input)) {
          errors.push(`${this.bufferName} pass has invalid input configuration for ${channelName}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private validateInput(input: any): boolean {
    if (!input || typeof input !== 'object' || !input.type) {
      return false;
    }

    switch (input.type) {
      case 'buffer':
        return this.validateBufferInput(input);
      case 'texture':
        return this.validateTextureInput(input);
      case 'video':
        return this.validateVideoInput(input);
      case 'keyboard':
        return this.validateKeyboardInput(input);
      default:
        return false;
    }
  }

  private validateBufferInput(input: any): boolean {
    const validSources = ['BufferA', 'BufferB', 'BufferC', 'BufferD'];
    return input.source &&
           validSources.includes(input.source) &&
           input.source !== 'common';
  }

  private validateTextureInput(input: any): boolean {
    if (!input.path || typeof input.path !== 'string') {
      return false;
    }

    if (input.filter && !['linear', 'nearest', 'mipmap'].includes(input.filter)) {
      return false;
    }

    if (input.wrap && !['repeat', 'clamp'].includes(input.wrap)) {
      return false;
    }

    if (input.vflip !== undefined && typeof input.vflip !== 'boolean') {
      return false;
    }

    return true;
  }

  private validateVideoInput(input: any): boolean {
    if (!input.path || typeof input.path !== 'string') {
      return false;
    }

    if (input.filter && !['linear', 'nearest', 'mipmap'].includes(input.filter)) {
      return false;
    }

    if (input.wrap && !['repeat', 'clamp'].includes(input.wrap)) {
      return false;
    }

    if (input.vflip !== undefined && typeof input.vflip !== 'boolean') {
      return false;
    }

    return true;
  }

  private validateKeyboardInput(input: any): boolean {
    return input.type === 'keyboard';
  }

  /**
   * Notify parent of configuration update
   */
  private notifyUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.bufferName, this.config);
    }
  }

  private newElseExistingInput(newInput: any, existing: any): any {
    return newInput == undefined ? existing : newInput;
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
