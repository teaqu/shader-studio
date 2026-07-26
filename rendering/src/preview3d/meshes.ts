import type { PreviewMeshKind } from './types';

export interface PreviewMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

export interface LineMesh {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
}

export function createPreviewMesh(kind: PreviewMeshKind): PreviewMesh {
  switch (kind) {
    case 'plane': return createPlaneMesh();
    case 'cube': return createCubeMesh();
    case 'sphere': return createSphereMesh();
  }
}

export function createPlaneMesh(): PreviewMesh {
  return {
    positions: new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  };
}

export function createCubeMesh(): PreviewMesh {
  const faces = [
    { normal: [1, 0, 0], vertices: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]] },
    { normal: [-1, 0, 0], vertices: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]] },
    { normal: [0, 1, 0], vertices: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, -1, 0], vertices: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
    { normal: [0, 0, 1], vertices: [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]] },
    { normal: [0, 0, -1], vertices: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]] },
  ] as const;
  const positions: number[] = []; const normals: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  const faceUvs = [0, 0, 1, 0, 1, 1, 0, 1];
  faces.forEach((face, faceIndex) => {
    face.vertices.forEach((vertex) => positions.push(...vertex));
    for (let index = 0; index < 4; index += 1) {
      normals.push(...face.normal);
    }
    uvs.push(...faceUvs);
    const base = faceIndex * 4;
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

export function createSphereMesh(latitudeSegments = 16, longitudeSegments = 32): PreviewMesh {
  const positions: number[] = []; const normals: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const v = latitude / latitudeSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta); const cosTheta = Math.cos(theta);
    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const u = longitude / longitudeSegments;
      const phi = u * Math.PI * 2;
      const x = -Math.cos(phi) * sinTheta;
      const y = cosTheta;
      const z = Math.sin(phi) * sinTheta;
      positions.push(x, y, z); normals.push(x, y, z); uvs.push(u, v);
    }
  }
  const rowLength = longitudeSegments + 1;
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const topLeft = latitude * rowLength + longitude;
      const bottomLeft = topLeft + rowLength;
      indices.push(topLeft, bottomLeft, topLeft + 1, topLeft + 1, bottomLeft, bottomLeft + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

export function createGridMesh(halfExtent = 5, divisions = 10): LineMesh {
  const positions: number[] = []; const colors: number[] = []; const indices: number[] = [];
  for (let line = 0; line <= divisions; line += 1) {
    const offset = -halfExtent + (line / divisions) * halfExtent * 2;
    const base = positions.length / 3;
    positions.push(-halfExtent, 0, offset, halfExtent, 0, offset, offset, 0, -halfExtent, offset, 0, halfExtent);
    colors.push(0.34, 0.37, 0.42, 0.34, 0.37, 0.42, 0.34, 0.37, 0.42, 0.34, 0.37, 0.42);
    indices.push(base, base + 1, base + 2, base + 3);
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint16Array(indices) };
}

export function createAxesMesh(length = 1.5): LineMesh {
  return {
    positions: new Float32Array([0, 0, 0, length, 0, 0, 0, 0, 0, 0, length, 0, 0, 0, 0, 0, 0, length]),
    colors: new Float32Array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 3, 4, 5]),
  };
}

/** Lift each built-in primitive onto the ground without changing user transforms. */
export function getPreviewMeshGroundOffset(kind: PreviewMeshKind): number {
  return kind === 'plane' ? 0.001 : 1;
}
