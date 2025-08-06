import type { ShaderConfig } from "@shader-studio/types";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class ConfigValidator {
  public static validateConfig(config: ShaderConfig | null): ValidationResult {
    if (!config) {
      return { isValid: true, errors: [] };
    }

    const errors: string[] = [];

    // Validate version
    if (!config.version || typeof config.version !== 'string') {
      errors.push('Config must have a valid version string');
    }

    // Validate passes
    if (!config.passes || typeof config.passes !== 'object') {
      errors.push('Config must have a passes object');
      return { isValid: false, errors };
    }

    // Validate Image pass (required)
    if (!config.passes.Image || typeof config.passes.Image !== 'object') {
      errors.push('Config must have an Image pass');
    } else {
      this.validateImagePass(config.passes.Image, errors);
    }

    // Validate optional buffer passes
    const bufferPassNames = ['BufferA', 'BufferB', 'BufferC', 'BufferD'] as const;
    bufferPassNames.forEach(passName => {
      const pass = config.passes[passName];
      if (pass) {
        this.validateBufferPass(pass, passName, errors);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private static validateImagePass(pass: any, errors: string[]): void {
    if (pass.inputs) {
      this.validateInputs(pass.inputs, 'Image', errors);
    }
  }

  private static validateBufferPass(pass: any, passName: string, errors: string[]): void {
    if (!pass.path || typeof pass.path !== 'string') {
      errors.push(`${passName} pass must have a valid path string`);
    }

    if (pass.inputs) {
      this.validateInputs(pass.inputs, passName, errors);
    }
  }

  private static validateInputs(inputs: any, passName: string, errors: string[]): void {
    if (typeof inputs !== 'object') {
      errors.push(`${passName} pass inputs must be an object`);
      return;
    }

    const validChannels = ['iChannel0', 'iChannel1', 'iChannel2', 'iChannel3'];
    
    for (const channel in inputs) {
      if (!validChannels.includes(channel)) {
        errors.push(`${passName} pass has invalid input channel: ${channel}`);
        continue;
      }

      const input = inputs[channel];
      if (!this.validateConfigInput(input)) {
        errors.push(`${passName} pass has invalid input configuration for ${channel}`);
      }
    }
  }

  private static validateConfigInput(input: any): boolean {
    if (!input || typeof input !== 'object' || !input.type) {
      return false;
    }

    switch (input.type) {
      case 'buffer':
        return this.validateBufferInput(input);
      case 'texture':
        return this.validateTextureInput(input);
      case 'keyboard':
        return this.validateKeyboardInput(input);
      default:
        return false;
    }
  }

  private static validateBufferInput(input: any): boolean {
    const validSources = ['BufferA', 'BufferB', 'BufferC', 'BufferD'];
    return input.source && validSources.includes(input.source);
  }

  private static validateTextureInput(input: any): boolean {
    if (!input.path || typeof input.path !== 'string') {
      return false;
    }

    // Validate optional properties
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

  private static validateKeyboardInput(input: any): boolean {
    // Keyboard input only needs the type field
    return input.type === 'keyboard';
  }
}
