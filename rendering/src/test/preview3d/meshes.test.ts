import { describe, expect, it } from 'vitest';
import { createAxesMesh, createGridMesh, createPreviewMesh, getPreviewMeshGroundOffset } from '../../preview3d/meshes';

function bounds(positions: Float32Array) {
  const result = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      result.min[axis] = Math.min(result.min[axis], positions[index + axis]);
      result.max[axis] = Math.max(result.max[axis], positions[index + axis]);
    }
  }
  return result;
}

describe('preview 3D meshes', () => {
  it.each(['plane', 'cube', 'sphere'] as const)('winds %s triangles toward their vertex normals', (kind) => {
    const mesh = createPreviewMesh(kind);
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const a = mesh.indices[index] * 3;
      const b = mesh.indices[index + 1] * 3;
      const c = mesh.indices[index + 2] * 3;
      const ab = [mesh.positions[b] - mesh.positions[a], mesh.positions[b + 1] - mesh.positions[a + 1], mesh.positions[b + 2] - mesh.positions[a + 2]];
      const ac = [mesh.positions[c] - mesh.positions[a], mesh.positions[c + 1] - mesh.positions[a + 1], mesh.positions[c + 2] - mesh.positions[a + 2]];
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const normal = [mesh.normals[a], mesh.normals[a + 1], mesh.normals[a + 2]];
      const areaSquared = cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
      if (areaSquared > 0.000001) {
        expect(cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2]).toBeGreaterThan(0);
      }
    }
  });

  it('creates a unit plane with UVs and upward normals', () => {
    const mesh = createPreviewMesh('plane');

    expect(mesh.positions).toHaveLength(12);
    expect(mesh.normals).toEqual(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]));
    expect(mesh.uvs).toEqual(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]));
    expect(mesh.indices).toHaveLength(6);
  });

  it('creates a cube with separate UV seams for every face', () => {
    const mesh = createPreviewMesh('cube');

    expect(mesh.positions).toHaveLength(24 * 3);
    expect(mesh.uvs).toHaveLength(24 * 2);
    expect(mesh.indices).toHaveLength(36);
    expect(bounds(mesh.positions)).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });
  });

  it('creates a UV sphere with a duplicated seam and complete index topology', () => {
    const mesh = createPreviewMesh('sphere');
    const firstRingStart = 0;
    const firstRingEnd = 32 * 2;

    expect(mesh.positions.length / 3).toBe((16 + 1) * (32 + 1));
    expect(mesh.indices).toHaveLength(16 * 32 * 6);
    expect(mesh.uvs[firstRingStart]).toBe(0);
    expect(mesh.uvs[firstRingEnd]).toBe(1);
  });

  it('creates finite grid lines and RGB axes', () => {
    const grid = createGridMesh();
    const axes = createAxesMesh();

    expect(grid.indices.length).toBeGreaterThan(0);
    expect(bounds(grid.positions)).toEqual({ min: [-5, 0, -5], max: [5, 0, 5] });
    expect(axes.colors).toEqual(new Float32Array([
      1, 0, 0, 1, 0, 0,
      0, 1, 0, 0, 1, 0,
      0, 0, 1, 0, 0, 1,
    ]));
  });

  it('keeps user object transforms centered while reporting mesh ground offsets', () => {
    expect(getPreviewMeshGroundOffset('cube')).toBe(1);
    expect(getPreviewMeshGroundOffset('sphere')).toBe(1);
    expect(getPreviewMeshGroundOffset('plane')).toBeGreaterThan(0);
    expect(getPreviewMeshGroundOffset('plane')).toBeLessThan(0.01);
  });
});
