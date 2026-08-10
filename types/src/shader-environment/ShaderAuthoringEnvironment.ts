import { GLSL_STABLE_NAMES, SHADER_STUDIO_BUILTIN_UNIFORMS } from "./BuiltinUniforms";

export type ShaderStage = "fragment" | "vertex" | "compute" | "geometry" | "tess-control" | "tess-evaluation";

export type AuthoringValueType = "float" | "vec2" | "vec3" | "vec4" | "bool" | "int";

export interface CustomUniformDeclaration {
  name: string;
  type: AuthoringValueType;
}

export interface AuthoringResource {
  name: string;
  kind: "texture-2d" | "texture-cube" | "texture-3d" | "storage";
  elementType?: string;
}

export interface VirtualShaderFile {
  uri: string;
  text: string;
  version: number;
}

export interface ShaderAuthoringEnvironment {
  documentUri: string;
  languageId: "glsl" | "slang";
  generation: number;
  passName: string;
  stage: ShaderStage;
  entryPoint?: string;
  customUniforms: readonly CustomUniformDeclaration[];
  resources: readonly AuthoringResource[];
  virtualFiles: readonly VirtualShaderFile[];
}

export interface GeneratedAuthoringSource {
  uri: string;
  text: string;
  generatedLineCount: number;
}

export interface ShaderAuthoringEnvironmentValidationIssue {
  code: "invalid-identifier" | "duplicate-identifier" | "reserved-identifier";
  message: string;
}

const SHADER_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHADER_STUDIO_RESERVED_NAMES = new Set([
  ...GLSL_STABLE_NAMES,
  ...SHADER_STUDIO_BUILTIN_UNIFORMS.map(({ name }) => name),
  "iWorldPosition",
  "iNormal",
  "iCameraPosition",
]);
const SHADER_LANGUAGE_KEYWORDS = new Set([
  "attribute", "bool", "break", "buffer", "case", "cbuffer", "centroid", "class", "const", "continue",
  "default", "discard", "do", "double", "else", "enum", "extern", "false", "flat", "float", "for",
  "half", "highp", "if", "in", "inout", "int", "interface", "layout", "lowp", "mat2", "mat3", "mat4",
  "namespace", "nointerpolation", "out", "precision", "public", "return", "SamplerState", "sampler2D",
  "sampler3D", "samplerCube", "static", "struct", "switch", "Texture2D", "Texture3D", "TextureCube", "true",
  "typedef", "uniform", "varying", "vec2", "vec3", "vec4", "void", "while",
]);

function isReservedShaderStudioIdentifier(name: string): boolean {
  return SHADER_STUDIO_RESERVED_NAMES.has(name)
    || SHADER_LANGUAGE_KEYWORDS.has(name)
    || /^iChannel\d+$/.test(name)
    || /^iCh[0-3]$/.test(name);
}

/** Returns validation diagnostics for generated declarations without mutating or throwing. */
export function validateShaderAuthoringEnvironment(
  environment: ShaderAuthoringEnvironment,
): ShaderAuthoringEnvironmentValidationIssue[] {
  const issues: ShaderAuthoringEnvironmentValidationIssue[] = [];
  const names = new Map<string, "custom uniform" | "resource">();
  const validate = (name: string, noun: "custom uniform" | "resource"): void => {
    const displayName = noun === "custom uniform" ? "Custom uniform" : "Resource";
    if (!SHADER_IDENTIFIER.test(name)) {
      issues.push({
        code: "invalid-identifier",
        message: `${displayName} "${name}" is not a valid shader identifier.`,
      });
      return;
    }
    if (isReservedShaderStudioIdentifier(name)) {
      issues.push({
        code: "reserved-identifier",
        message: `${displayName} "${name}" conflicts with a Shader Studio built-in.`,
      });
      return;
    }
    const existing = names.get(name);
    if (existing) {
      issues.push({
        code: "duplicate-identifier",
        message: `${displayName} "${name}" duplicates a ${existing}.`,
      });
      return;
    }
    names.set(name, noun);
  };

  for (const uniform of environment.customUniforms) {
    validate(uniform.name, "custom uniform");
  }
  for (const resource of environment.resources) {
    validate(resource.name, "resource");
  }

  return issues;
}
