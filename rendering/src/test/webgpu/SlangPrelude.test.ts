import { describe, expect, it } from 'vitest';
import { wrapSlangImageSource } from '../../webgpu/SlangPrelude';

const image = 'float4 mainImage(float2 fragCoord) { return float4(1); }';
const vertex = 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.y += 1; }';

describe('wrapSlangImageSource vertex hooks', () => {
  it('runs a fullscreen vertex hook before returning clip-space position', () => {
    const source = wrapSlangImageSource(image, { vertexCode: vertex });
    expect(source).toContain(vertex);
    expect(source).toContain('mainVertex(position, normal, uv);');
    expect(source.indexOf('mainVertex(position, normal, uv);')).toBeGreaterThan(source.indexOf(vertex));
  });

  it('runs a mesh vertex hook before computing mesh world varyings', () => {
    const source = wrapSlangImageSource(image, { geometry: 'cube', vertexCode: vertex });
    expect(source.indexOf('mainVertex(position, normal, uv);')).toBeLessThan(source.indexOf('float4 worldPosition'));
    expect(source).toContain('output.uv = uv;');
  });
});
