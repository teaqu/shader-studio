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

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid latitude segment count of %s', (latitudeSegments) => {
    expect(() => createSphereMesh(latitudeSegments, 1)).toThrow(new RangeError('latitudeSegments must be a finite positive integer'));
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid longitude segment count of %s', (longitudeSegments) => {
    expect(() => createSphereMesh(1, longitudeSegments)).toThrow(new RangeError('longitudeSegments must be a finite positive integer'));
  });

  it('rejects segment counts that exceed the Uint16 vertex-index capacity', () => {
    expect(() => createSphereMesh(256, 256)).toThrow(new RangeError('sphere mesh vertex count exceeds Uint16Array index capacity'));
  });

  it('supports the largest sphere topology representable by Uint16 indices', () => {
    const mesh = createSphereMesh(255, 255);

    expect(mesh.positions.length / 3).toBe(65_536);
    expect(mesh.indices.includes(65_535)).toBe(true);
  });

  it('dispatches meshes with coherent typed-array topology', () => {
    expect(createPreviewMesh('plane').indices).toHaveLength(6);
    expect(createPreviewMesh('cube').indices).toHaveLength(36);
    expect(createPreviewMesh('sphere').indices.length).toBeGreaterThan(0);
  });
});
