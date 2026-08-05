import { describe, expect, it } from 'vitest';

import type { PreviewMesh, PreviewMeshKind, PreviewSettings } from '../../preview3d/types';

describe('preview 3D types', () => {
  it('preserves the supported mesh kinds and typed mesh buffers', () => {
    const kinds: readonly PreviewMeshKind[] = ['cube', 'sphere', 'plane'];
    const mesh: PreviewMesh = {
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 1, 0]),
      uvs: new Float32Array([0, 0]),
      indices: new Uint16Array([0]),
    };
    const settings: PreviewSettings = {
      object: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      scene: { grid: true, axes: false },
    };

    expect(kinds).toEqual(['cube', 'sphere', 'plane']);
    expect(mesh.indices).toBeInstanceOf(Uint16Array);
    expect(settings.object.scale).toEqual([1, 1, 1]);
  });
});
