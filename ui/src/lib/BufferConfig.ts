import {
  GEOMETRY_TYPES,
  type BufferPass,
  type ComputePass,
  type ConfigInput,
  type GeometryConfig,
  type ImagePass
} from '@shader-studio/types';

function isValidGeometry(geometry: unknown): geometry is GeometryConfig | undefined {
  if (geometry === undefined) {
    return true;
  }
  if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) {
    return false;
  }

  const type = (geometry as { type?: unknown }).type;
  if (type === 'model') {
    const { path, mesh, resolved_path, ...rest } = geometry as { path?: unknown; mesh?: unknown; resolved_path?: unknown; type?: unknown };
    return Object.keys(rest).length === 1 && typeof path === 'string' && path.length > 0 &&
      (mesh === undefined || typeof mesh === 'string') && (resolved_path === undefined || typeof resolved_path === 'string');
  }
  const properties = Object.keys(geometry);
  return properties.length === 1 && properties[0] === 'type' &&
    typeof type === 'string' && GEOMETRY_TYPES.includes(type as GeometryConfig['type']);
}

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
    } else {
      if (!isValidGeometry(this.config.geometry)) {
        errors.push(`${this.bufferName} pass geometry type must be one of: ${GEOMETRY_TYPES.join(', ')}`);
      }
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
      case 'keyboard':
        return this.validateKeyboardInput(input);
      case 'audio':
        return this.validateAudioInput(input);
      default:
        return false;
    }
  }

  private static readonly GLSL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  private validateBufferInput(input: any): boolean {
    return typeof input.source === 'string' &&
           input.source.length > 0 &&
           BufferConfig.GLSL_IDENTIFIER.test(input.source) &&
           input.source !== 'Image' &&
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
