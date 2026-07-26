import { describe, expect, it } from 'vitest';
import { createModelMatrix, createNormalMatrix3, createPerspectiveMatrix, createViewMatrix, transformPoint } from '../../preview3d/math';

describe('preview 3D math', () => {
  it('builds a column-major perspective matrix', () => {
    const projection = createPerspectiveMatrix(Math.PI / 2, 2, 0.1, 100);

    expect(projection[0]).toBeCloseTo(0.5);
    expect(projection[5]).toBeCloseTo(1);
    expect(projection[11]).toBe(-1);
    expect(projection[15]).toBe(0);
  });

  it('supports WebGL and WebGPU clip-depth ranges', () => {
    const webgl = createPerspectiveMatrix(Math.PI / 2, 1, 0.1, 100, 'webgl');
    const webgpu = createPerspectiveMatrix(Math.PI / 2, 1, 0.1, 100, 'webgpu');

    expect(transformPoint(webgl, [0, 0, -0.1])[2]).toBeCloseTo(-1);
    expect(transformPoint(webgl, [0, 0, -100])[2]).toBeCloseTo(1);
    expect(transformPoint(webgpu, [0, 0, -0.1])[2]).toBeCloseTo(0);
    expect(transformPoint(webgpu, [0, 0, -100])[2]).toBeCloseTo(1);
  });

  it('builds a view matrix that looks at the target', () => {
    const view = createViewMatrix([0, 0, 5], [0, 0, 0]);
    const targetInCameraSpace = transformPoint(view, [0, 0, 0]);

    expect(targetInCameraSpace).toEqual([0, 0, -5]);
  });

  it('applies translation, rotation, and scale to a model matrix', () => {
    const model = createModelMatrix({ position: [2, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [2, 1, 1] });
    const transformed = transformPoint(model, [1, 0, 0]);

    expect(transformed[0]).toBeCloseTo(2);
    expect(transformed[1]).toBeCloseTo(2);
    expect(transformed[2]).toBeCloseTo(0);
  });

  it('creates an inverse-transpose normal matrix for non-uniform object scale', () => {
    const model = createModelMatrix({ position: [5, 6, 7], rotation: [0, 0, 0], scale: [2, 3, 4] });

    const normal = createNormalMatrix3(model);
    expect(normal[0]).toBeCloseTo(0.5);
    expect(normal[4]).toBeCloseTo(1 / 3);
    expect(normal[8]).toBeCloseTo(0.25);
    expect(normal[1]).toBeCloseTo(0);
    expect(normal[3]).toBeCloseTo(0);
  });
});
