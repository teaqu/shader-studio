import { GEOMETRY_TYPES, type GeometryConfig, type ShaderConfig } from "@shader-studio/types";

function isValidGeometry(geometry: unknown): geometry is GeometryConfig | undefined {
  if (geometry === undefined) {
    return true;
  }
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
    return false;
  }

  const type = (geometry as { type?: unknown }).type;
  if (type === "model") {
    const { path, mesh, resolved_path, ...rest } = geometry as { path?: unknown; mesh?: unknown; resolved_path?: unknown; type?: unknown };
    return Object.keys(rest).length === 1 && typeof path === "string" && path.length > 0 &&
      (mesh === undefined || typeof mesh === "string") && (resolved_path === undefined || typeof resolved_path === "string");
  }
  const properties = Object.keys(geometry);
  return properties.length === 1 && properties[0] === "type" &&
    typeof type === "string" && GEOMETRY_TYPES.includes(type as GeometryConfig["type"]);
}

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

    // Validate buffer passes (any key except Image)
    for (const passName of Object.keys(config.passes)) {
      if (passName === 'Image') {
        continue;
      }
      if (!this.GLSL_IDENTIFIER.test(passName)) {
        errors.push(`Invalid pass name: ${passName}`);
        continue;
      }
      const pass = config.passes[passName];
      if (pass) {
        if (passName === "common") {
          this.validateCommonPass(pass, errors);
        } else {
          this.validateBufferPass(pass, passName, errors);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private static validateImagePass(pass: any, errors: string[]): void {
    if (!isValidGeometry(pass.geometry)) {
      errors.push(`Image pass geometry type must be one of: ${GEOMETRY_TYPES.join(", ")}`);
    }

    if (pass.inputs) {
      this.validateInputs(pass.inputs, 'Image', errors);
    }
  }

  private static validateBufferPass(pass: any, passName: string, errors: string[]): void {
    // path can be empty or missing (buffer not yet configured) — just skip validation
    if (pass.path !== undefined && typeof pass.path !== 'string') {
      errors.push(`${passName} pass path must be a string`);
    }

    if (!isValidGeometry(pass.geometry)) {
      errors.push(`${passName} pass geometry type must be one of: ${GEOMETRY_TYPES.join(", ")}`);
    }

    if (pass.inputs) {
      this.validateInputs(pass.inputs, passName, errors);
    }
  }

  private static validateCommonPass(pass: any, errors: string[]): void {
    if (pass.path !== undefined && typeof pass.path !== "string") {
      errors.push("common pass path must be a string");
    }
    if (pass.inputs !== undefined) {
      errors.push("common pass cannot define inputs");
    }
    if (pass.resolution !== undefined) {
      errors.push("common pass cannot define resolution");
    }
    if (pass.geometry !== undefined) {
      errors.push("common pass cannot define geometry");
    }
  }

  private static readonly MAX_CHANNELS = 16;
  private static readonly GLSL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  private static validateInputs(inputs: any, passName: string, errors: string[]): void {
    if (typeof inputs !== 'object') {
      errors.push(`${passName} pass inputs must be an object`);
      return;
    }

    const keys = Object.keys(inputs);
    if (keys.length > this.MAX_CHANNELS) {
      errors.push(`${passName} pass has too many input channels (max ${this.MAX_CHANNELS})`);
    }

    for (const channel of keys) {
      if (!this.GLSL_IDENTIFIER.test(channel)) {
        errors.push(`${passName} pass has invalid input channel name: ${channel}`);
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
      case 'cubemap':
        return this.validateCubemapInput(input);
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

  private static validateBufferInput(input: any): boolean {
    return typeof input.source === 'string' &&
           input.source.length > 0 &&
           this.GLSL_IDENTIFIER.test(input.source) &&
           input.source !== 'Image' &&
           input.source !== 'common';
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

  private static validateCubemapInput(input: any): boolean {
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

  private static validateAudioInput(input: any): boolean {
    return input.path && typeof input.path === 'string';
  }

  private static validateVideoInput(input: any): boolean {
    if (!input.path || typeof input.path !== 'string') {
      return false;
    }

    // Validate optional properties (same as texture)
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
}
