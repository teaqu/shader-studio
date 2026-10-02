import type { DepthSettings, CullMode, VerticesGeometryConfig } from "@shader-studio/types";

/**
 * Fields a pass loses when its geometry changes: vertexCount/topology/space
 * when it leaves vertices geometry, and depth/cull when it becomes fullscreen.
 */
export interface RememberedDrawFields {
  vertices?: Pick<VerticesGeometryConfig, "vertexCount" | "topology" | "space">;
  depth?: DepthSettings;
  cull?: CullMode;
}

/**
 * Remembered draw fields keyed by shader and pass. Other geometry rejects
 * them, so the config cannot hold them; switching the pass back restores
 * them. Lives for the webview session so it survives the config panel's tabs
 * being switched, and is never written to the config file.
 */
let remembered = $state<Record<string, RememberedDrawFields>>({});

function key(shaderPath: string | undefined, passName: string): string {
  return `${shaderPath ?? ""}\u0000${passName}`;
}

function withoutUndefined<T extends object>(value: T | undefined): T | undefined {
  if (!value) {
    return undefined;
  }
  const kept = Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/** Merges fields into the pass's memory; undefined fields leave earlier memory alone. */
export function rememberDrawFields(shaderPath: string | undefined, passName: string, fields: RememberedDrawFields): void {
  const id = key(shaderPath, passName);
  const vertices = withoutUndefined(fields.vertices);
  const depth = withoutUndefined(fields.depth);
  const merged: RememberedDrawFields = {
    ...remembered[id],
    ...(vertices ? { vertices } : {}),
    ...(depth ? { depth } : {}),
    ...(fields.cull !== undefined ? { cull: fields.cull } : {}),
  };
  if (Object.keys(merged).length === 0) {
    return;
  }
  remembered = { ...remembered, [id]: merged };
}

/** Returns and forgets one remembered field group, or undefined when there is none. */
export function takeDrawField<K extends keyof RememberedDrawFields>(
  shaderPath: string | undefined,
  passName: string,
  field: K,
): RememberedDrawFields[K] | undefined {
  const id = key(shaderPath, passName);
  const entry = remembered[id];
  const value = entry?.[field];
  if (value === undefined) {
    return undefined;
  }
  const { [field]: _taken, ...rest } = entry;
  const next = { ...remembered };
  if (Object.keys(rest).length === 0) {
    delete next[id];
  } else {
    next[id] = rest;
  }
  remembered = next;
  return value;
}

export function resetVerticesDrawMemory(): void {
  remembered = {};
}
