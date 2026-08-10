import { GLSL_DEFAULT_CHANNEL_DECLARATION_LINES, GLSL_STABLE_DECLARATION_LINES } from "./BuiltinUniforms";
import type { GeneratedAuthoringSource, ShaderAuthoringEnvironment } from "./ShaderAuthoringEnvironment";

const GLSL_VALUE_TYPES = {
  float: "float",
  vec2: "vec2",
  vec3: "vec3",
  vec4: "vec4",
  bool: "bool",
  int: "int",
} as const;

const GLSL_RESOURCE_TYPES = {
  "texture-2d": "sampler2D",
  "texture-cube": "samplerCube",
  "texture-3d": "sampler3D",
  // GLSL authoring tools can resolve storage through the sampler-compatible fallback.
  storage: "sampler2D",
} as const;

/** Builds virtual GLSL declarations for editor analysis without changing renderer wrapping. */
export function buildGlslAuthoringPreamble(
  environment: ShaderAuthoringEnvironment,
): GeneratedAuthoringSource {
  const lines = [
    ...GLSL_STABLE_DECLARATION_LINES,
    ...GLSL_DEFAULT_CHANNEL_DECLARATION_LINES,
    ...environment.customUniforms.map((uniform) => `uniform ${GLSL_VALUE_TYPES[uniform.type]} ${uniform.name};`),
    ...environment.resources.map((resource) => `uniform ${GLSL_RESOURCE_TYPES[resource.kind]} ${resource.name};`),
  ];

  return {
    uri: environment.documentUri,
    text: lines.join("\n"),
    generatedLineCount: lines.length,
  };
}
