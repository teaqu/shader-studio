import { GLSL_STABLE_DECLARATION_LINES } from "./BuiltinUniforms";
import {
  buildGlslCompatibilityUniformDeclarationLines,
  type GlslSamplerType,
} from "../GlslShaderEnvironment";
import type { AuthoringResource, GeneratedAuthoringSource, ShaderAuthoringEnvironment } from "./ShaderAuthoringEnvironment";

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

function channelSlot(resource: AuthoringResource): number | null {
  const match = /^iChannel(\d+)$/.exec(resource.name);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function glslSamplerTypeFor(resource: AuthoringResource | undefined): GlslSamplerType {
  return resource?.kind === "texture-cube" ? "samplerCube"
    : resource?.kind === "texture-3d" ? "sampler3D"
      : "sampler2D";
}

/** Builds virtual GLSL declarations for editor analysis without changing renderer wrapping. */
export function buildGlslAuthoringPreamble(
  environment: ShaderAuthoringEnvironment,
): GeneratedAuthoringSource {
  const channels = new Map<number, AuthoringResource>();
  for (const resource of environment.resources) {
    const slot = channelSlot(resource);
    if (slot !== null) {
      channels.set(slot, resource);
    }
  }
  const channelCount = Math.max(4, ...Array.from(channels.keys(), (slot) => slot + 1));
  const samplerTypes = Array.from({ length: 4 }, (_, slot) => glslSamplerTypeFor(channels.get(slot)));
  const lines = [
    ...GLSL_STABLE_DECLARATION_LINES,
    ...Array.from({ length: channelCount }, (_, slot) => `uniform ${glslSamplerTypeFor(channels.get(slot))} iChannel${slot};`),
    `uniform vec3 iChannelResolution[${channelCount}];`,
    ...buildGlslCompatibilityUniformDeclarationLines(samplerTypes),
    ...environment.customUniforms.map((uniform) => `uniform ${GLSL_VALUE_TYPES[uniform.type]} ${uniform.name};`),
    ...environment.resources
      .filter((resource) => channelSlot(resource) === null)
      .map((resource) => `uniform ${GLSL_RESOURCE_TYPES[resource.kind]} ${resource.name};`),
  ];

  return {
    uri: environment.documentUri,
    text: lines.join("\n"),
    generatedLineCount: lines.length,
  };
}
