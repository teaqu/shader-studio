import {
  BLEND_MODES,
  CULL_MODES,
  DEPTH_COMPARE_FUNCTIONS,
  GEOMETRY_TYPES,
  MAX_INSTANCE_COUNT,
  MAX_VERTEX_COUNT,
  MESH_TOPOLOGIES,
  VERTEX_SPACES,
  VERTEX_TOPOLOGIES,
  type GeometryConfig,
  type ShaderConfig,
} from "@shader-studio/types";

const VERTEX_FIELDS = ["vertexCount", "topology", "space"] as const;
/** Draw fields geometry may carry besides `type` (and a model's path fields). */
const GEOMETRY_DRAW_FIELDS: readonly string[] = [...VERTEX_FIELDS, "instanceCount"];
const RENDER_SETTING_FIELDS = ["blend", "clear", "depth", "cull"] as const;
const DEPTH_FLAGS = ["test", "write"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/**
 * Field-specific errors for `vertexCount`, `topology` and `space`. Vertices
 * geometry accepts all three; meshes accept only a mesh `topology`; fullscreen
 * accepts none. Reported separately so the message names the bad field.
 */
function validateGeometryVertexFields(geometry: unknown, passName: string, errors: string[]): void {
  if (!isPlainObject(geometry)) {
    return;
  }
  const { type, vertexCount, topology, space } = geometry;
  if (type !== "vertices") {
    // Unknown types already report the supported list.
    if (!isOneOf(GEOMETRY_TYPES, type)) {
      return;
    }
    for (const field of VERTEX_FIELDS) {
      if (geometry[field] === undefined || (field === "topology" && type !== "fullscreen")) {
        continue;
      }
      errors.push(field === "topology"
        ? `${passName} pass geometry topology is not supported for fullscreen geometry`
        : `${passName} pass geometry ${field} is only supported for vertices geometry, not ${type}`);
    }
    if (type !== "fullscreen" && topology !== undefined && !isOneOf(MESH_TOPOLOGIES, topology)) {
      errors.push(`${passName} pass geometry topology for ${type} geometry must be one of: ${MESH_TOPOLOGIES.join(", ")}`);
    }
    return;
  }
  if (vertexCount !== undefined &&
    (typeof vertexCount !== "number" || !Number.isInteger(vertexCount) || vertexCount < 1 || vertexCount > MAX_VERTEX_COUNT)) {
    errors.push(`${passName} pass geometry vertexCount must be an integer from 1 to ${MAX_VERTEX_COUNT}`);
  }
  if (topology !== undefined && !isOneOf(VERTEX_TOPOLOGIES, topology)) {
    errors.push(`${passName} pass geometry topology must be one of: ${VERTEX_TOPOLOGIES.join(", ")}`);
  }
  if (space !== undefined && !isOneOf(VERTEX_SPACES, space)) {
    errors.push(`${passName} pass geometry space must be one of: ${VERTEX_SPACES.join(", ")}`);
  }
}

/** `instanceCount` is valid on every geometry but fullscreen, which draws once. */
function validateGeometryInstanceCount(geometry: unknown, passName: string, errors: string[]): void {
  if (!isPlainObject(geometry) || geometry.instanceCount === undefined || !isOneOf(GEOMETRY_TYPES, geometry.type)) {
    return;
  }
  const { type, instanceCount } = geometry;
  if (type === "fullscreen") {
    errors.push(`${passName} pass geometry instanceCount is not supported for fullscreen geometry`);
    return;
  }
  if (typeof instanceCount !== "number" || !Number.isInteger(instanceCount) || instanceCount < 1 || instanceCount > MAX_INSTANCE_COUNT) {
    errors.push(`${passName} pass geometry instanceCount must be an integer from 1 to ${MAX_INSTANCE_COUNT}`);
  }
}

function isValidGeometry(geometry: unknown): geometry is GeometryConfig | undefined {
  if (geometry === undefined) {
    return true;
  }
  if (!isPlainObject(geometry)) {
    return false;
  }

  const type = geometry.type;
  if (type === "model") {
    // Draw fields are reported by validateGeometryVertexFields and validateGeometryInstanceCount.
    const { path, mesh, resolved_path, vertexCount: _vertexCount, topology: _topology, space: _space, instanceCount: _instanceCount, ...rest } = geometry;
    return Object.keys(rest).length === 1 && typeof path === "string" && path.length > 0 &&
      (mesh === undefined || typeof mesh === "string") && (resolved_path === undefined || typeof resolved_path === "string");
  }
  const properties = Object.keys(geometry).filter((key) => !GEOMETRY_DRAW_FIELDS.includes(key));
  return properties.length === 1 && properties[0] === "type" && isOneOf(GEOMETRY_TYPES, type);
}

/**
 * Geometry errors for a renderable pass. Shared with the config panel's pass
 * model so both report the same messages.
 */
export function validatePassGeometry(geometry: unknown, passName: string): string[] {
  const errors: string[] = [];
  if (!isValidGeometry(geometry)) {
    errors.push(`${passName} pass geometry type must be one of: ${GEOMETRY_TYPES.join(", ")}`);
  }
  validateGeometryVertexFields(geometry, passName, errors);
  validateGeometryInstanceCount(geometry, passName, errors);
  return errors;
}

function validateDepth(depth: unknown, passName: string, errors: string[]): void {
  if (!isPlainObject(depth)) {
    errors.push(`${passName} pass depth must be an object with test, write and compare`);
    return;
  }
  for (const key of Object.keys(depth)) {
    if (key !== "compare" && !DEPTH_FLAGS.includes(key as (typeof DEPTH_FLAGS)[number])) {
      errors.push(`${passName} pass depth ${key} is not a depth setting; use test, write or compare`);
    }
  }
  for (const flag of DEPTH_FLAGS) {
    if (depth[flag] !== undefined && typeof depth[flag] !== "boolean") {
      errors.push(`${passName} pass depth ${flag} must be true or false`);
    }
  }
  if (depth.compare !== undefined && !isOneOf(DEPTH_COMPARE_FUNCTIONS, depth.compare)) {
    errors.push(`${passName} pass depth compare must be one of: ${DEPTH_COMPARE_FUNCTIONS.join(", ")}`);
  }
}

function validateClear(clear: unknown, passName: string, errors: string[]): void {
  if (!Array.isArray(clear) || clear.length !== 4 || clear.some((component) => (
    typeof component !== "number" || !Number.isFinite(component) || component < 0 || component > 1
  ))) {
    errors.push(`${passName} pass clear must be four numbers from 0 to 1`);
  }
}

/**
 * Geometry plus blend/depth/cull errors for one pass. Compute and common
 * passes reject the render settings; fullscreen geometry, including an
 * omitted geometry, rejects depth and cull. Shared with the config panel.
 */
export function validatePassRenderSettings(pass: unknown, passName: string): string[] {
  if (!isPlainObject(pass)) {
    return [];
  }
  const errors: string[] = [];
  if (passName !== "common") {
    errors.push(...validatePassGeometry(pass.geometry, passName));
  }
  if (passName === "common" || pass.type === "compute") {
    const kind = passName === "common" ? "common" : `${passName} compute`;
    for (const field of RENDER_SETTING_FIELDS) {
      if (pass[field] !== undefined) {
        errors.push(`${kind} pass cannot define ${field}`);
      }
    }
    return errors;
  }
  if (pass.blend !== undefined && !isOneOf(BLEND_MODES, pass.blend)) {
    errors.push(`${passName} pass blend must be one of: ${BLEND_MODES.join(", ")}`);
  }
  if (pass.clear !== undefined) {
    validateClear(pass.clear, passName, errors);
  }
  if (pass.depth !== undefined) {
    validateDepth(pass.depth, passName, errors);
  }
  if (pass.cull !== undefined && !isOneOf(CULL_MODES, pass.cull)) {
    errors.push(`${passName} pass cull must be one of: ${CULL_MODES.join(", ")}`);
  }
  const geometryType = pass.geometry === undefined ? "fullscreen" : isPlainObject(pass.geometry) ? pass.geometry.type : undefined;
  if (geometryType === "fullscreen") {
    if (pass.depth !== undefined) {
      errors.push(`${passName} pass depth is not supported for fullscreen geometry, which has no depth buffer`);
    }
    if (pass.cull !== undefined) {
      errors.push(`${passName} pass cull is not supported for fullscreen geometry`);
    }
  }
  return errors;
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
      if (passName !== "common" && passName.toLowerCase() === "common") {
        errors.push(`Invalid pass name: ${passName} (did you mean "common"?)`);
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
    if (pass.outputFormat !== undefined) {
      errors.push("Image pass cannot define outputFormat");
    }
    errors.push(...validatePassRenderSettings(pass, "Image"));

    if (pass.inputs) {
      this.validateInputs(pass.inputs, 'Image', errors);
    }
  }

  private static validateBufferPass(pass: any, passName: string, errors: string[]): void {
    // path can be empty or missing (buffer not yet configured) — just skip validation
    if (pass.path !== undefined && typeof pass.path !== 'string') {
      errors.push(`${passName} pass path must be a string`);
    }
    if (pass.outputFormat !== undefined && !['auto', 'rgba16float', 'rgba32float'].includes(pass.outputFormat)) {
      errors.push(`${passName} pass outputFormat must be auto, rgba16float, or rgba32float`);
    }

    errors.push(...validatePassRenderSettings(pass, passName));

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
    errors.push(...validatePassRenderSettings(pass, "common"));
  }

  private static channelLimit = 32;
  private static readonly GLSL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  static setChannelLimit(limit: number): void {
    ConfigValidator.channelLimit = Math.max(1, limit);
  }

  static getChannelLimit(): number {
    return ConfigValidator.channelLimit;
  }

  private static validateInputs(inputs: any, passName: string, errors: string[]): void {
    if (typeof inputs !== 'object') {
      errors.push(`${passName} pass inputs must be an object`);
      return;
    }

    const keys = Object.keys(inputs);

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
    if (typeof input.source !== 'string' ||
        input.source.length === 0 ||
        !this.GLSL_IDENTIFIER.test(input.source) ||
        input.source === 'Image' ||
        input.source === 'common') {
      return false;
    }
    if (input.filter !== undefined && !['linear', 'nearest'].includes(input.filter)) {
      return false;
    }
    return input.wrap === undefined || ['repeat', 'clamp'].includes(input.wrap);
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
