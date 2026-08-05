import { describe, expect, it } from 'vitest';

import { createModelMatrix, createNormalMatrix3, createPerspectiveMatrix, createViewMatrix, multiplyMatrices, transformPoint } from '../../preview3d/math';

describe('preview 3D math', () => {
  it('builds a column-major perspective matrix for each clip-depth range', () => {
    const webgl = createPerspectiveMatrix(Math.PI / 2, 2, 0.1, 100);
    const webgpu = createPerspectiveMatrix(Math.PI / 2, 1, 0.1, 100, 'webgpu');

    expect(webgl[0]).toBeCloseTo(0.5);
    expect(webgl[5]).toBeCloseTo(1);
    expect(transformPoint(webgl, [0, 0, -0.1])[2]).toBeCloseTo(-1);
    expect(transformPoint(webgpu, [0, 0, -0.1])[2]).toBeCloseTo(0);
  });

  it('builds a view matrix that looks at its target', () => {
    expect(transformPoint(createViewMatrix([0, 0, 5], [0, 0, 0]), [0, 0, 0])).toEqual([0, 0, -5]);
  });

  it('builds a model matrix from translation, rotation, and scale', () => {
    const model = createModelMatrix({ position: [2, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [2, 1, 1] });

    expect(transformPoint(model, [1, 0, 0])[0]).toBeCloseTo(2);
    expect(transformPoint(model, [1, 0, 0])[1]).toBeCloseTo(2);
  });

  it('creates an inverse-transpose normal matrix for non-uniform scale', () => {
    const normal = createNormalMatrix3(createModelMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 4, 5] }));

    expect(normal[0]).toBeCloseTo(0.5);
    expect(normal[4]).toBeCloseTo(0.25);
    expect(normal[8]).toBeCloseTo(0.2);
  });

  it('uses an identity normal matrix for a singular transform', () => {
    const normal = createNormalMatrix3(createModelMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 1, 1] }));

    expect(normal).toEqual(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
  });

  it('multiplies column-major matrices', () => {
    expect(multiplyMatrices(
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]),
      new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]),
    )).toEqual(new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1]));
  });
});
