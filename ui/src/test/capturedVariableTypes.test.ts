import { describe, expect, it } from 'vitest';
import {
  capturedVectorWidth,
  captureDecoderType,
  isCapturedColorVectorType,
  isCapturedScalarType,
  isCapturedVectorType,
  isSupportedCapturedType,
} from '../lib/capturedVariableTypes';

describe('captured variable type classification', () => {
  it.each(['float', 'int', 'bool', ' f32 ', 'f16', 'i32', 'u32'])(
    'keeps %s as a scalar type',
    (type) => {
      expect(isCapturedScalarType(type)).toBe(true);
      expect(isSupportedCapturedType(type)).toBe(true);
      expect(captureDecoderType(type)).toBe('float');
    },
  );

  it.each([
    ['vec2', 2], ['vec3', 3], ['vec4', 4],
    ['float2', 2], ['float3', 3], ['float4', 4],
    ['vec2f', 2], ['vec2h', 2], ['vec2i', 2], ['vec2u', 2],
    ['vec3f', 3], ['vec3h', 3], ['vec3i', 3], ['vec3u', 3],
    ['vec4f', 4], ['vec4h', 4], ['vec4i', 4], ['vec4u', 4],
    ['vec2<f32>', 2], ['vec2< f16 >', 2], ['vec2 < i32 >', 2], ['vec2 < u32 >', 2],
    ['vec3<f32>', 3], ['vec3< f16 >', 3], ['vec3 < i32 >', 3], ['vec3 < u32 >', 3],
    ['vec4<f32>', 4], ['vec4< f16 >', 4], ['vec4 < i32 >', 4], ['vec4 < u32 >', 4],
  ])('classifies %s as a %i-component vector', (type, width) => {
    expect(capturedVectorWidth(type)).toBe(width);
    expect(isCapturedVectorType(type)).toBe(true);
    expect(isSupportedCapturedType(type)).toBe(true);
    expect(captureDecoderType(type)).toBe(`vec${width}`);
    expect(isCapturedColorVectorType(type)).toBe(width >= 3);
  });

  it.each(['mat2', 'float2x2'])('preserves legacy %s vector handling', (type) => {
    expect(isCapturedVectorType(type)).toBe(true);
    expect(isSupportedCapturedType(type)).toBe(true);
    expect(captureDecoderType(type)).toBe(type);
    expect(isCapturedColorVectorType(type)).toBe(false);
  });

  it.each(['MyStruct', 'array<f32>', 'mat3x3<f32>', 'vec5f', 'vec3<bool>', 'vec3<f64>'])(
    'rejects unsupported capture type %s',
    (type) => {
      expect(isCapturedScalarType(type)).toBe(false);
      expect(capturedVectorWidth(type)).toBeNull();
      expect(isCapturedVectorType(type)).toBe(false);
      expect(isSupportedCapturedType(type)).toBe(false);
      expect(captureDecoderType(type)).toBe(type);
    },
  );
});
