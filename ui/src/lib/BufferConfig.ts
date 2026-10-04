import { validatePassRenderSettings } from '@shader-studio/rendering';
import type {
  BufferPass,
  ComputePass,
  ConfigInput,
  ImagePass
} from '@shader-studio/types';

export class BufferConfig {
  private bufferName: string;
  private config: BufferPass | ImagePass | ComputePass;
  private onUpdate?: (bufferName: string, config: BufferPass | ImagePass | ComputePass) => void;
  constructor(
    bufferName: string,
    config: BufferPass | ImagePass | ComputePass,
    onUpdate?: (bufferName: string, config: BufferPass | ImagePass | ComputePass) => void
  ) {
    this.bufferName = bufferName;
    this.config = config;
    this.onUpdate = onUpdate;
  }

  /**
   * Get the current configuration
   */
  getConfig(): BufferPass | ImagePass | ComputePass {
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
   * Remove an input channel
   */
  removeInputChannel(channel: string): void {
    if (!this.config.inputs) {
      return;
    }

    const newInputs = { ...this.config.inputs };
    delete newInputs[channel];

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

  getInputChannel(channel: string): ConfigInput | undefined {
    return this.config.inputs ? this.config.inputs[channel] : undefined;
  }

  /**
   * Rename an input channel key
   */
  renameInputChannel(oldName: string, newName: string): void {
    if (!this.config.inputs || oldName === newName) {
      return;
    }
    if (!newName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName)) {
      return;
    }
    if (this.config.inputs[newName]) {
      return;
    } // name already taken

    const input = this.config.inputs[oldName];
    if (!input) {
      return;
    }

    const newInputs: Record<string, ConfigInput> = {};
    for (const [key, value] of Object.entries(this.config.inputs)) {
      if (key === oldName) {
        newInputs[newName] = value;
      } else {
        newInputs[key] = value;
      }
    }

    this.config = {
      ...this.config,
      inputs: newInputs
    };
    this.notifyUpdate();
  }

  /**
   * Validate the buffer configuration
   */
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.bufferName === 'common') {
      if (this.config.inputs !== undefined) {
        errors.push('common pass cannot define inputs');
      }
      if (this.config.resolution !== undefined) {
        errors.push('common pass cannot define resolution');
      }
      if (this.config.geometry !== undefined) {
        errors.push('common pass cannot define geometry');
      }
      if (this.config.vertex !== undefined) {
        errors.push('common pass cannot define vertex');
      }
      if ('outputFormat' in this.config && this.config.outputFormat !== undefined) {
        errors.push('common pass cannot define outputFormat');
      }
      errors.push(...validatePassRenderSettings(this.config, 'common'));
    } else {
      if ('outputFormat' in this.config && this.config.outputFormat !== undefined &&
          !['auto', 'rgba16float', 'rgba32float'].includes(this.config.outputFormat)) {
        errors.push(`${this.bufferName} pass outputFormat must be auto, rgba16float, or rgba32float`);
      }
      errors.push(...validatePassRenderSettings(this.config, this.bufferName));
      if (this.config.vertex !== undefined && (typeof this.config.vertex !== 'string' || this.config.vertex.trim() === '')) {
        errors.push(`${this.bufferName} pass vertex path must be a non-empty string`);
      }

      // Validate input channels
      if (this.config.inputs) {
        for (const [channelName, input] of Object.entries(this.config.inputs)) {
          if (!this.validateInput(input)) {
            errors.push(`${this.bufferName} pass has invalid input configuration for ${channelName}`);
          }
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
      case 'cubemap':
        // Cubemaps use the same path and sampler options as textures.
        return this.validateTextureInput(input);
      case 'video':
        return this.validateVideoInput(input);
      case 'system-audio':
      case 'microphone':
      case 'webcam':
        return Object.keys(input).every(key => key === 'type');
      case 'screen':
        return this.validateScreenInput(input);
      case 'keyboard':
        return this.validateKeyboardInput(input);
      case 'audio':
        return this.validateAudioInput(input);
      default:
        return false;
    }
  }

  private validateScreenInput(input: any): boolean {
    if (!Object.keys(input).every(key => ['type', 'filter', 'wrap', 'vflip'].includes(key))) {
      return false;
    }
    return (input.filter === undefined || ['linear', 'nearest', 'mipmap'].includes(input.filter)) &&
      (input.wrap === undefined || ['repeat', 'clamp'].includes(input.wrap)) &&
      (input.vflip === undefined || typeof input.vflip === 'boolean');
  }

  private static readonly GLSL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  private validateBufferInput(input: any): boolean {
    if (typeof input.source !== 'string' ||
        input.source.length === 0 ||
        !BufferConfig.GLSL_IDENTIFIER.test(input.source) ||
        input.source === 'Image' ||
        input.source === 'common') {
      return false;
    }
    if (input.filter !== undefined && !['linear', 'nearest'].includes(input.filter)) {
      return false;
    }
    return input.wrap === undefined || ['repeat', 'clamp'].includes(input.wrap);
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

  private validateAudioInput(input: any): boolean {
    return !!input.path && typeof input.path === 'string';
  }

  /**
   * Notify parent of configuration update
   */
  private notifyUpdate(): void {
    if (this.onUpdate) {
      this.onUpdate(this.bufferName, this.config);
    }
  }

}
