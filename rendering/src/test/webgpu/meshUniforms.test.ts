import { describe, expect, it } from 'vitest';
import { OrbitCamera } from '../../preview3d/OrbitCamera';
import { packDefaultMeshUniforms } from '../../webgpu/meshUniforms';

describe('mesh uniform packing', () => {
  it('preserves identity model, normal transform and camera position', () => {
    const camera = new OrbitCamera();
    const packed = packDefaultMeshUniforms(camera, 64, 32);
    expect(packed).toHaveLength(64);
    expect(Array.from(packed.slice(0, 16), value => value || 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(Array.from(packed.slice(32, 48), value => value || 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(Array.from(packed.slice(48, 52))).toEqual([...camera.getPosition().map(Math.fround), 1]);
    expect(Array.from(packedDefaultSquare(camera))).not.toEqual(Array.from(packed.slice(16, 32)));
  });
});
function packedDefaultSquare(camera: OrbitCamera): Float32Array {
  return packDefaultMeshUniforms(camera, 32, 32).slice(16, 32);
}
