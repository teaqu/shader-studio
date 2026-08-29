import {
  GLSL_STABLE_DECLARATION_LINES,
  SHADER_STUDIO_BUILTIN_UNIFORMS,
} from "./BuiltinUniforms";
import {
  buildGlslCompatibilityUniformDeclarationLines,
  type GlslSamplerType,
} from "../GlslShaderEnvironment";
import {
  isAuthoringValueType,
  resolveAuthoringChannelBindings,
  type AuthoringValueType,
  type AuthoringResource,
  type GeneratedAuthoringSource,
  type ShaderAuthoringEnvironment,
} from "./ShaderAuthoringEnvironment";

const GLSL_VALUE_TYPES = {
  float: "float",
  vec2: "vec2",
  vec3: "vec3",
  vec4: "vec4",
  bool: "bool",
} as const satisfies Record<AuthoringValueType, string>;

const GLSL_RESOURCE_TYPES = {
  "texture-2d": "sampler2D",
  "texture-cube": "samplerCube",
  "texture-3d": "sampler3D",
  // GLSL authoring tools can resolve storage through the sampler-compatible fallback.
  storage: "sampler2D",
} as const;

function glslSamplerTypeFor(resource: AuthoringResource | undefined): GlslSamplerType {
  return resource?.kind === "texture-cube" ? "samplerCube"
    : resource?.kind === "texture-3d" ? "sampler3D"
      : "sampler2D";
}

/** Builds virtual GLSL declarations for editor analysis without changing renderer wrapping. */
export function buildGlslAuthoringPreamble(
  environment: ShaderAuthoringEnvironment,
): GeneratedAuthoringSource {
  const channelBindings = resolveAuthoringChannelBindings(environment.resources);
  const channels = new Map(channelBindings.map(({ slot, resource }) => [slot, resource]));
  const channelCount = Math.max(4, ...Array.from(channels.keys(), (slot) => slot + 1));
  const samplerTypes = Array.from({ length: channelCount }, (_, slot) => glslSamplerTypeFor(channels.get(slot)));
  const lines = [
    ...GLSL_STABLE_DECLARATION_LINES,
    ...SHADER_STUDIO_BUILTIN_UNIFORMS.flatMap((uniform) => (
      uniform.glslDeclaration
      && uniform.languages.includes("glsl")
      && (!uniform.stages || uniform.stages.includes(environment.stage))
        ? [uniform.glslDeclaration]
        : []
    )),
    ...Array.from({ length: channelCount }, (_, slot) => `uniform ${glslSamplerTypeFor(channels.get(slot))} iChannel${slot};`),
    `uniform vec3 iChannelResolution[${channelCount}];`,
    ...buildGlslCompatibilityUniformDeclarationLines(samplerTypes),
    ...environment.customUniforms.flatMap((uniform) => {
      if (!isAuthoringValueType(uniform.type)) {
        return [];
      }
      const typeName = GLSL_VALUE_TYPES[uniform.type];
      return [`uniform ${typeName} ${uniform.name};`];
    }),
    ...channelBindings
      .filter(({ resource, slot }) => resource.name !== `iChannel${slot}`)
      .map(({ resource }) => `uniform ${GLSL_RESOURCE_TYPES[resource.kind]} ${resource.name};`),
    ...environment.resources
      .filter((resource) => resource.kind === "storage" && !/^iChannel\d+$/.test(resource.name))
      .map((resource) => `uniform ${GLSL_RESOURCE_TYPES[resource.kind]} ${resource.name};`),
  ];

  return {
    uri: environment.documentUri,
    text: lines.join("\n"),
    generatedLineCount: lines.length,
  };
}
