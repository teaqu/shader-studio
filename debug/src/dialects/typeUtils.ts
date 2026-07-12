export function canonicalShaderType(type: string): string {
  switch (type) {
    case 'float2': return 'vec2';
    case 'float3': return 'vec3';
    case 'float4': return 'vec4';
    case 'float2x2': return 'mat2';
    case 'float3x3': return 'mat3';
    case 'float4x4': return 'mat4';
    default: return type;
  }
}
