import type { PreviewObjectTransform, Vec3 } from './types';

export type Mat4 = Float32Array;
export type ClipSpaceDepth = 'webgl' | 'webgpu';

const EPSILON = 0.000001;

export function createPerspectiveMatrix(fieldOfViewRadians: number, aspect: number, near: number, far: number, clipSpaceDepth: ClipSpaceDepth = 'webgl'): Mat4 {
  const f = 1 / Math.tan(fieldOfViewRadians / 2);
  const rangeInverse = 1 / (near - far);
  const depthScale = clipSpaceDepth === 'webgpu' ? far * rangeInverse : (near + far) * rangeInverse;
  const depthOffset = clipSpaceDepth === 'webgpu' ? near * far * rangeInverse : 2 * near * far * rangeInverse;
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, depthScale, -1,
    0, 0, depthOffset, 0,
  ]);
}

export function createViewMatrix(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  const zLength = Math.hypot(zx, zy, zz) || 1;
  zx /= zLength;
  zy /= zLength;
  zz /= zLength;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xLength = Math.hypot(xx, xy, xz) || 1;
  xx /= xLength;
  xy /= xLength;
  xz /= xLength;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

export function multiplyMatrices(left: Mat4, right: Mat4): Mat4 {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        left[row] * right[column * 4] +
        left[4 + row] * right[column * 4 + 1] +
        left[8 + row] * right[column * 4 + 2] +
        left[12 + row] * right[column * 4 + 3];
    }
  }
  return result;
}

export function createModelMatrix(transform: PreviewObjectTransform): Mat4 {
  const [sx, sy, sz] = transform.scale;
  const [rx, ry, rz] = transform.rotation;
  const [tx, ty, tz] = transform.position;
  const sinX = Math.sin(rx); const cosX = Math.cos(rx);
  const sinY = Math.sin(ry); const cosY = Math.cos(ry);
  const sinZ = Math.sin(rz); const cosZ = Math.cos(rz);

  // ZYX Euler rotation, then scale axes, with translation in the final column.
  return new Float32Array([
    (cosZ * cosY) * sx,
    (sinZ * cosY) * sx,
    -sinY * sx,
    0,
    (cosZ * sinY * sinX - sinZ * cosX) * sy,
    (sinZ * sinY * sinX + cosZ * cosX) * sy,
    cosY * sinX * sy,
    0,
    (cosZ * sinY * cosX + sinZ * sinX) * sz,
    (sinZ * sinY * cosX - cosZ * sinX) * sz,
    cosY * cosX * sz,
    0,
    tx, ty, tz, 1,
  ]);
}

/** Inverse-transpose of a model matrix's upper-left 3×3, for surface normals. */
export function createNormalMatrix3(model: Mat4): Float32Array {
  const a00 = model[0]; const a01 = model[4]; const a02 = model[8];
  const a10 = model[1]; const a11 = model[5]; const a12 = model[9];
  const a20 = model[2]; const a21 = model[6]; const a22 = model[10];
  const c00 = a11 * a22 - a12 * a21; const c01 = a12 * a20 - a10 * a22; const c02 = a10 * a21 - a11 * a20;
  const c10 = a02 * a21 - a01 * a22; const c11 = a00 * a22 - a02 * a20; const c12 = a01 * a20 - a00 * a21;
  const c20 = a01 * a12 - a02 * a11; const c21 = a02 * a10 - a00 * a12; const c22 = a00 * a11 - a01 * a10;
  const determinant = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(determinant) < EPSILON) {
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
  const reciprocal = 1 / determinant;
  return new Float32Array([c00 * reciprocal, c10 * reciprocal, c20 * reciprocal, c01 * reciprocal, c11 * reciprocal, c21 * reciprocal, c02 * reciprocal, c12 * reciprocal, c22 * reciprocal]);
}

export function transformPoint(matrix: Mat4, point: Vec3): [number, number, number] {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const reciprocalW = Math.abs(w) > EPSILON ? 1 / w : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * reciprocalW,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * reciprocalW,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * reciprocalW,
  ];
}

export function normalizeVector(vector: Vec3): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < EPSILON) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
