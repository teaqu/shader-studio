import { Document, WebIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { listGlbMeshNames, loadGlbMesh } from '../../preview3d/GltfMeshLoader';

describe('loadGlbMesh', () => {
  it('returns shader-ready data for the named GLB mesh', async () => {
    const document = new Document();
    const buffer = document.createBuffer();
    const primitive = document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer))
      .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer))
      .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2])).setBuffer(buffer));
    document.createMesh('Preview').addPrimitive(primitive);

    const mesh = await loadGlbMesh(await new WebIO().writeBinary(document), 'Preview');

    expect(mesh.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('rejects a primitive without normals or UVs', async () => {
    const document = new Document();
    const buffer = document.createBuffer();
    document.createMesh('Incomplete').addPrimitive(document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0])).setBuffer(buffer)));

    await expect(loadGlbMesh(await new WebIO().writeBinary(document), 'Incomplete')).rejects.toThrow('POSITION, NORMAL, and TEXCOORD_0');
  });

  it('lists the named meshes available for selection', async () => {
    const document = new Document();
    document.createMesh('Body');
    document.createMesh('Visor');

    await expect(listGlbMeshNames(await new WebIO().writeBinary(document))).resolves.toEqual(['Body', 'Visor']);
  });

});
