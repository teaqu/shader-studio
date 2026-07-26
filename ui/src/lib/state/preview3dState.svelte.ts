import {
  clonePreviewSettings,
  createDefaultPreviewSettings,
  type PreviewLightingMode,
  type PreviewMeshKind,
  type PreviewMode,
  type PreviewSettings,
  type PreviewWrapMode,
  type Vec2,
  type Vec3,
} from '@shader-studio/rendering';

export const PREVIEW_3D_STORAGE_KEY = 'shader-studio-preview-3d:v1';
const STORAGE_VERSION = 1;

const MAPPING_SCALE_RANGE = [0.05, 16] as const;
const MAPPING_OFFSET_RANGE = [-16, 16] as const;
const ROTATION_RANGE = [-Math.PI * 2, Math.PI * 2] as const;
const POSITION_RANGE = [-20, 20] as const;
const OBJECT_SCALE_RANGE = [0.05, 10] as const;

let previewSettings = $state.raw<PreviewSettings>(createDefaultPreviewSettings());
let cameraResetToken = $state(0);

function clamp(value: number, range: readonly [number, number]): number {
  if (!Number.isFinite(value)) {
    return range[0];
  }
  return Math.min(range[1], Math.max(range[0], value));
}

function validNumber(value: unknown, fallback: number, range: readonly [number, number]): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, range) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function enumOrDefault<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;
}

function tuple2(value: unknown, fallback: Vec2, range: readonly [number, number]): Vec2 {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return Object.freeze([
    validNumber(value[0], fallback[0], range),
    validNumber(value[1], fallback[1], range),
  ]) as Vec2;
}

function tuple3(value: unknown, fallback: Vec3, range: readonly [number, number]): Vec3 {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return Object.freeze([
    validNumber(value[0], fallback[0], range),
    validNumber(value[1], fallback[1], range),
    validNumber(value[2], fallback[2], range),
  ]) as Vec3;
}

function parseSettings(value: unknown): PreviewSettings {
  const defaults = createDefaultPreviewSettings();
  if (!isRecord(value)) {
    return defaults;
  }

  const mapping = isRecord(value.mapping) ? value.mapping : {};
  const object = isRecord(value.object) ? value.object : {};
  const scene = isRecord(value.scene) ? value.scene : {};

  return clonePreviewSettings({
    mode: enumOrDefault(value.mode, ['2d', '3d'], defaults.mode),
    mesh: enumOrDefault(value.mesh, ['cube', 'sphere', 'plane'], defaults.mesh),
    mapping: {
      scale: tuple2(mapping.scale, defaults.mapping.scale, MAPPING_SCALE_RANGE),
      offset: tuple2(mapping.offset, defaults.mapping.offset, MAPPING_OFFSET_RANGE),
      rotation: validNumber(mapping.rotation, defaults.mapping.rotation, ROTATION_RANGE),
      wrap: enumOrDefault(mapping.wrap, ['repeat', 'mirror', 'clamp'], defaults.mapping.wrap),
    },
    object: {
      position: tuple3(object.position, defaults.object.position, POSITION_RANGE),
      rotation: tuple3(object.rotation, defaults.object.rotation, ROTATION_RANGE),
      scale: tuple3(object.scale, defaults.object.scale, OBJECT_SCALE_RANGE),
    },
    lighting: enumOrDefault(value.lighting, ['unlit', 'lit'], defaults.lighting),
    scene: {
      grid: typeof scene.grid === 'boolean' ? scene.grid : defaults.scene.grid,
      axes: typeof scene.axes === 'boolean' ? scene.axes : defaults.scene.axes,
    },
  });
}

function persist(): void {
  try {
    localStorage.setItem(PREVIEW_3D_STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, settings: previewSettings }));
  } catch (error) {
    console.warn('Failed to save 3D preview settings to localStorage:', error);
  }
}

function update(updater: (current: PreviewSettings) => PreviewSettings): void {
  previewSettings = clonePreviewSettings(updater(previewSettings));
  persist();
}

function setVec2(index: 0 | 1, value: number, current: Vec2, range: readonly [number, number]): Vec2 {
  const next: [number, number] = [current[0], current[1]];
  next[index] = clamp(value, range);
  return next;
}

function setVec3(index: 0 | 1 | 2, value: number, current: Vec3, range: readonly [number, number]): Vec3 {
  const next: [number, number, number] = [current[0], current[1], current[2]];
  next[index] = clamp(value, range);
  return next;
}

export function getDefaultPreviewSettings(): PreviewSettings {
  return createDefaultPreviewSettings();
}

/** A frozen copy suitable for handing to a renderer. */
export function getPreviewSettings(): PreviewSettings {
  return clonePreviewSettings(previewSettings);
}

export function getPreviewCameraResetToken(): number {
  return cameraResetToken;
}

export function restorePreviewSettingsFromStorage(): void {
  try {
    const stored = localStorage.getItem(PREVIEW_3D_STORAGE_KEY);
    if (!stored) {
      previewSettings = createDefaultPreviewSettings();
      return;
    }
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
      previewSettings = createDefaultPreviewSettings();
      return;
    }
    previewSettings = parseSettings(parsed.settings);
  } catch (error) {
    console.warn('Failed to load 3D preview settings from localStorage:', error);
    previewSettings = createDefaultPreviewSettings();
  }
}

export function setPreviewMode(mode: PreviewMode): void {
  update((current) => ({ ...current, mode: enumOrDefault(mode, ['2d', '3d'], current.mode) }));
}

export function setPreviewMesh(mesh: PreviewMeshKind): void {
  update((current) => ({ ...current, mesh: enumOrDefault(mesh, ['cube', 'sphere', 'plane'], current.mesh) }));
}

export function setPreviewMappingScale(index: 0 | 1, value: number): void {
  update((current) => ({ ...current, mapping: { ...current.mapping, scale: setVec2(index, value, current.mapping.scale, MAPPING_SCALE_RANGE) } }));
}

export function setPreviewMappingOffset(index: 0 | 1, value: number): void {
  update((current) => ({ ...current, mapping: { ...current.mapping, offset: setVec2(index, value, current.mapping.offset, MAPPING_OFFSET_RANGE) } }));
}

/** Mapping and object rotations are always expressed in radians. */
export function setPreviewMappingRotation(rotation: number): void {
  update((current) => ({ ...current, mapping: { ...current.mapping, rotation: clamp(rotation, ROTATION_RANGE) } }));
}

export function setPreviewWrapMode(wrap: PreviewWrapMode): void {
  update((current) => ({ ...current, mapping: { ...current.mapping, wrap: enumOrDefault(wrap, ['repeat', 'mirror', 'clamp'], current.mapping.wrap) } }));
}

export function setPreviewObjectPosition(index: 0 | 1 | 2, value: number): void {
  update((current) => ({ ...current, object: { ...current.object, position: setVec3(index, value, current.object.position, POSITION_RANGE) } }));
}

export function setPreviewObjectRotation(index: 0 | 1 | 2, rotation: number): void {
  update((current) => ({ ...current, object: { ...current.object, rotation: setVec3(index, rotation, current.object.rotation, ROTATION_RANGE) } }));
}

/** The current UI deliberately exposes a uniform object scale. */
export function setPreviewObjectScale(scale: number): void {
  const clamped = clamp(scale, OBJECT_SCALE_RANGE);
  update((current) => ({ ...current, object: { ...current.object, scale: [clamped, clamped, clamped] } }));
}

export function setPreviewLightingMode(lighting: PreviewLightingMode): void {
  update((current) => ({ ...current, lighting: enumOrDefault(lighting, ['unlit', 'lit'], current.lighting) }));
}

export function setPreviewGridVisible(grid: boolean): void {
  update((current) => ({ ...current, scene: { ...current.scene, grid: typeof grid === 'boolean' ? grid : current.scene.grid } }));
}

export function setPreviewAxesVisible(axes: boolean): void {
  update((current) => ({ ...current, scene: { ...current.scene, axes: typeof axes === 'boolean' ? axes : current.scene.axes } }));
}

export function resetPreviewMapping(): void {
  const defaults = createDefaultPreviewSettings();
  update((current) => ({ ...current, mapping: defaults.mapping }));
}

export function resetPreviewObject(): void {
  const defaults = createDefaultPreviewSettings();
  update((current) => ({ ...current, object: defaults.object }));
}

export function resetPreviewSettings(): void {
  previewSettings = createDefaultPreviewSettings();
  persist();
}

/** Camera position is engine-owned and intentionally never persisted. */
export function resetPreviewCamera(): void {
  cameraResetToken += 1;
}
