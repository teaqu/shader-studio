/** A fixed-size tuple used by preview scene APIs. */
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export type PreviewMode = '2d' | '3d';
export type PreviewMeshKind = 'cube' | 'sphere' | 'plane';
export type PreviewWrapMode = 'repeat' | 'mirror' | 'clamp';
export type PreviewLightingMode = 'unlit' | 'lit';

export interface PreviewMappingSettings {
  readonly scale: Vec2;
  readonly offset: Vec2;
  readonly rotation: number;
  readonly wrap: PreviewWrapMode;
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

/**
 * UI-owned preferences for previewing a ShaderToy `mainImage` function on a
 * built-in mesh. These deliberately do not form part of ShaderConfig.
 */
export interface PreviewSettings {
  readonly mode: PreviewMode;
  readonly mesh: PreviewMeshKind;
  readonly mapping: PreviewMappingSettings;
  readonly object: PreviewObjectTransform;
  readonly lighting: PreviewLightingMode;
  readonly scene: PreviewSceneSettings;
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = Object.freeze({
  mode: '2d',
  mesh: 'cube',
  mapping: Object.freeze({
    scale: Object.freeze([1, 1] as [number, number]),
    offset: Object.freeze([0, 0] as [number, number]),
    rotation: 0,
    wrap: 'repeat',
  }),
  object: Object.freeze({
    position: Object.freeze([0, 0, 0] as [number, number, number]),
    rotation: Object.freeze([0, 0, 0] as [number, number, number]),
    scale: Object.freeze([1, 1, 1] as [number, number, number]),
  }),
  lighting: 'unlit',
  scene: Object.freeze({ grid: true, axes: true }),
});

/** Returns an immutable copy so callers never mutate the defaults or each other. */
export function createDefaultPreviewSettings(): PreviewSettings {
  return clonePreviewSettings(DEFAULT_PREVIEW_SETTINGS);
}

/** Makes a deeply frozen snapshot suitable for renderer ownership. */
export function clonePreviewSettings(settings: PreviewSettings): PreviewSettings {
  return Object.freeze({
    mode: settings.mode,
    mesh: settings.mesh,
    mapping: Object.freeze({
      scale: Object.freeze([...settings.mapping.scale]) as Vec2,
      offset: Object.freeze([...settings.mapping.offset]) as Vec2,
      rotation: settings.mapping.rotation,
      wrap: settings.mapping.wrap,
    }),
    object: Object.freeze({
      position: Object.freeze([...settings.object.position]) as Vec3,
      rotation: Object.freeze([...settings.object.rotation]) as Vec3,
      scale: Object.freeze([...settings.object.scale]) as Vec3,
    }),
    lighting: settings.lighting,
    scene: Object.freeze({ grid: settings.scene.grid, axes: settings.scene.axes }),
  });
}
