const WGSL_SCALAR_TYPES = new Set(['f32', 'f16', 'i32', 'u32']);
const LEGACY_SCALAR_TYPES = new Set(['float', 'int', 'bool']);
const LEGACY_VECTOR_TYPES = new Set([
  'vec2', 'vec3', 'vec4', 'mat2',
  'float2', 'float3', 'float4', 'float2x2',
]);

function wgslVectorWidth(type: string): 2 | 3 | 4 | null {
  const compact = type.replace(/\s+/g, '');
  const alias = /^vec([234])[fhiu]$/.exec(compact);
  const generic = /^vec([234])<(?:f32|f16|i32|u32)>$/.exec(compact);
  const match = alias ?? generic;
  return match ? Number(match[1]) as 2 | 3 | 4 : null;
}

export function isCapturedScalarType(type: string): boolean {
  return LEGACY_SCALAR_TYPES.has(type.trim()) || WGSL_SCALAR_TYPES.has(type.trim());
}

export function capturedVectorWidth(type: string): 2 | 3 | 4 | null {
  const trimmed = type.trim();
  if (trimmed === 'vec2' || trimmed === 'float2') {
    return 2;
  }
  if (trimmed === 'vec3' || trimmed === 'float3') {
    return 3;
  }
  if (trimmed === 'vec4' || trimmed === 'float4') {
    return 4;
  }
  return wgslVectorWidth(trimmed);
}

/** `mat2x2f` / `mat2x2<f32>`: packed column-major into RGBA like GLSL mat2 and Slang float2x2. */
function isWgslMatrix2x2(type: string): boolean {
  return /^mat2x2(?:f|<f32>)$/.test(type.replace(/\s+/g, ''));
}

export function isCapturedVectorType(type: string): boolean {
  return LEGACY_VECTOR_TYPES.has(type.trim()) || capturedVectorWidth(type) !== null || isWgslMatrix2x2(type);
}

export function isCapturedColorVectorType(type: string): boolean {
  const width = capturedVectorWidth(type);
  return width === 3 || width === 4;
}

export function isSupportedCapturedType(type: string): boolean {
  return isCapturedScalarType(type) || isCapturedVectorType(type);
}

/** Converts WGSL spellings to the decoder's existing cross-language shapes. */
export function captureDecoderType(type: string): string {
  if (isCapturedScalarType(type)) {
    return 'float';
  }
  if (isWgslMatrix2x2(type)) {
    return 'mat2';
  }
  const width = capturedVectorWidth(type);
  return width ? `vec${width}` : type.trim();
}
