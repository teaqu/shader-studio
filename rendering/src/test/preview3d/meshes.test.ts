import { describe, expect, it } from 'vitest';

import { createCubeMesh, createPlaneMesh, createPreviewMesh, createSphereMesh } from '../../preview3d/meshes';

describe('preview meshes', () => {
  it('creates a plane with full-range UVs', () => {
    expect(createPlaneMesh().positions).toHaveLength(12);
    expect(createPlaneMesh().uvs).toEqual(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]));
  });

  it('creates a cube made from twelve triangles', () => {
    const mesh = createCubeMesh();

    expect(mesh.indices).toHaveLength(36);
    expect(mesh.positions).toHaveLength(24 * 3);
    expect(mesh.uvs).toHaveLength(24 * 2);
  });

  it('creates a sphere with normalized UV coordinates', () => {
    const mesh = createSphereMesh(16, 32);

    expect(mesh.uvs.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(mesh.positions.length / 3).toBe((16 + 1) * (32 + 1));
    expect(mesh.indices).toHaveLength(16 * 32 * 6);
  });

  it('dispatches meshes with coherent typed-array topology', () => {
    expect(createPreviewMesh('plane').indices).toHaveLength(6);
    expect(createPreviewMesh('cube').indices).toHaveLength(36);
    expect(createPreviewMesh('sphere').indices.length).toBeGreaterThan(0);
  });
});
