/** A fixed-size tuple used by preview scene APIs. */
export type Vec3 = readonly [number, number, number];

export type PreviewMeshKind = 'cube' | 'sphere' | 'plane';

export interface PreviewMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

export interface PreviewObjectTransform {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export interface PreviewSceneSettings {
  readonly grid: boolean;
  readonly axes: boolean;
}

export interface PreviewSettings {
  readonly object: PreviewObjectTransform;
  readonly scene: PreviewSceneSettings;
}
