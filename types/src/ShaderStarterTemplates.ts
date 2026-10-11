import type { ShaderLanguageId } from './shader-environment/ShaderLanguages';

const templates: Record<ShaderLanguageId, string> = {
  glsl: `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord / iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0, 2, 4));

    // Output to screen
    fragColor = vec4(col, 1.0);
}
`,
  slang: `float4 mainImage(float2 fragCoord)
{
    // Normalized pixel coordinates (from 0 to 1)
    float2 uv = fragCoord / iResolution.xy;

    // Time varying pixel color
    float3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));

    // Output to screen
    return float4(col, 1.0);
}
`,
  wgsl: `fn mainImage(fragCoord: vec2f) -> vec4f
{
    // Normalized pixel coordinates (from 0 to 1)
    let uv = fragCoord / iResolution.xy;

    // Time varying pixel color
    let col = vec3f(0.5) + vec3f(0.5) * cos(iTime + uv.xyx + vec3f(0, 2, 4));

    // Output to screen
    return vec4f(col, 1.0);
}
`,
};

/** Shared animated image starter for host-specific creation workflows. */
export function shaderStarterTemplate(language: ShaderLanguageId): string {
  return templates[language];
}
