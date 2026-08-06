import { Primitive, WebIO, type Accessor } from '@gltf-transform/core';
import type { PreviewMesh } from './types';

/**
 * Loads the deliberately small static-mesh subset used by the preview renderer.
 * Materials, animation, morph targets, compression, and multi-primitive meshes
 * remain outside this first GLB integration.
 */
export async function loadGlbMesh(data: Uint8Array, meshName?: string): Promise<PreviewMesh> {
  const document = await new WebIO().readBinary(data);
  const meshes = document.getRoot().listMeshes();
  const mesh = meshName ? meshes.find((candidate) => candidate.getName() === meshName) : meshes[0];
  if (!mesh) {
    throw new Error(meshName ? `GLB mesh not found: ${meshName}` : 'GLB contains no meshes');
  }
  const primitives = mesh.listPrimitives();
  if (primitives.length !== 1) {
    throw new Error(`GLB mesh "${mesh.getName() || meshName}" must contain exactly one primitive`);
  }
  const primitive = primitives[0];
  if (primitive.getMode() !== Primitive.Mode.TRIANGLES) {
    throw new Error('GLB mesh primitive must use triangle topology');
  }

  const positions = floatAttribute(primitive.getAttribute('POSITION'), 'POSITION');
  const normals = floatAttribute(primitive.getAttribute('NORMAL'), 'NORMAL');
  const uvs = floatAttribute(primitive.getAttribute('TEXCOORD_0'), 'TEXCOORD_0');
  if (positions.length / 3 !== normals.length / 3 || positions.length / 3 !== uvs.length / 2) {
    throw new Error('GLB mesh POSITION, NORMAL, and TEXCOORD_0 attribute counts must match');
  }
  const indexArray = primitive.getIndices()?.getArray();
  const indices = indexArray ? new Uint32Array(indexArray) : sequentialIndices(positions.length / 3);
  if (indices.length % 3 !== 0) {
    throw new Error('GLB mesh index count must be divisible by three');
  }
  return { positions, normals, uvs, indices };
}

/** Returns named meshes that can be selected by the preview configuration UI. */
export async function listGlbMeshNames(data: Uint8Array): Promise<string[]> {
  const document = await new WebIO().readBinary(data);
  return document.getRoot().listMeshes().map((mesh, index) => mesh.getName() || `Mesh ${index + 1}`);
}

function floatAttribute(accessor: Accessor | null, semantic: string): Float32Array {
  const array = accessor?.getArray();
  if (!array) {
    throw new Error('GLB mesh must provide POSITION, NORMAL, and TEXCOORD_0 attributes');
  }
  if (!(array instanceof Float32Array)) {
    throw new Error(`GLB ${semantic} attribute must use float32 components`);
  }
  return new Float32Array(array);
}

function sequentialIndices(vertexCount: number): Uint32Array {
  if (vertexCount % 3 !== 0) {
    throw new Error('Unindexed GLB mesh vertex count must be divisible by three');
  }
  return Uint32Array.from({ length: vertexCount }, (_, index) => index);
}
