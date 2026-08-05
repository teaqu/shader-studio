import type { PreviewMesh, PreviewMeshKind } from './types';

const UINT16_VERTEX_CAPACITY = 65_536;

export function createPreviewMesh(kind: PreviewMeshKind): PreviewMesh {
  switch (kind) {
    case 'plane': return createPlaneMesh(); case 'cube': return createCubeMesh(); case 'sphere': return createSphereMesh(); 
  }
}

export function createPlaneMesh(): PreviewMesh {
  return { positions: new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: new Uint16Array([0, 2, 1, 0, 3, 2]) };
}

export function createCubeMesh(): PreviewMesh {
  const faces = [{ normal: [1, 0, 0], vertices: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]] }, { normal: [-1, 0, 0], vertices: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]] }, { normal: [0, 1, 0], vertices: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] }, { normal: [0, -1, 0], vertices: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] }, { normal: [0, 0, 1], vertices: [[1, -1, 1], [-1, -1, 1], [-1, 1, 1], [1, 1, 1]] }, { normal: [0, 0, -1], vertices: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]] }] as const;
  const positions: number[] = []; const normals: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  faces.forEach((face, faceIndex) => {
    face.vertices.forEach((vertex) => positions.push(...vertex)); for (let index = 0; index < 4; index += 1) {
      normals.push(...face.normal);
    } uvs.push(0, 0, 1, 0, 1, 1, 0, 1); const base = faceIndex * 4; indices.push(base, base + 2, base + 1, base, base + 3, base + 2); 
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

export function createSphereMesh(latitudeSegments = 16, longitudeSegments = 32): PreviewMesh {
  assertValidSegmentCount(latitudeSegments, 'latitudeSegments');
  assertValidSegmentCount(longitudeSegments, 'longitudeSegments');
  if ((latitudeSegments + 1) * (longitudeSegments + 1) > UINT16_VERTEX_CAPACITY) {
    throw new RangeError('sphere mesh vertex count exceeds Uint16Array index capacity');
  }
  const positions: number[] = []; const normals: number[] = []; const uvs: number[] = []; const indices: number[] = [];
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const v = latitude / latitudeSegments; const theta = v * Math.PI; const sinTheta = Math.sin(theta); const cosTheta = Math.cos(theta); for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const u = longitude / longitudeSegments; const phi = u * Math.PI * 2; const x = -Math.cos(phi) * sinTheta; const y = cosTheta; const z = Math.sin(phi) * sinTheta; positions.push(x, y, z); normals.push(x, y, z); uvs.push(u, v); 
    } 
  }
  const rowLength = longitudeSegments + 1;
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const topLeft = latitude * rowLength + longitude; const bottomLeft = topLeft + rowLength; indices.push(topLeft, bottomLeft, topLeft + 1, topLeft + 1, bottomLeft, bottomLeft + 1); 
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

function assertValidSegmentCount(segmentCount: number, name: string): void {
  if (!Number.isFinite(segmentCount) || !Number.isInteger(segmentCount) || segmentCount <= 0) {
    throw new RangeError(`${name} must be a finite positive integer`);
  }
}
