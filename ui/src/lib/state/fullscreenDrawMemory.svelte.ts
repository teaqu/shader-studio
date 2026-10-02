import type { FullscreenGeometryConfig } from "@shader-studio/types";

/** The fullscreen-only draw fields a pass loses when it switches to mesh geometry. */
export type FullscreenDrawFields = Pick<FullscreenGeometryConfig, "vertexCount" | "topology">;

/**
 * Fullscreen vertexCount/topology a pass had before switching to a mesh, keyed
 * by shader and pass. Mesh geometry rejects these fields, so the config cannot
 * hold them; switching the pass back to fullscreen restores them. Lives for the
 * webview session so it survives the config panel's tabs being switched.
 */
let remembered = $state<Record<string, FullscreenDrawFields>>({});

function key(shaderPath: string | undefined, passName: string): string {
  return `${shaderPath ?? ""}\u0000${passName}`;
}

export function rememberFullscreenDraw(shaderPath: string | undefined, passName: string, fields: FullscreenDrawFields): void {
  const kept = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as FullscreenDrawFields;
  const next = { ...remembered };
  if (Object.keys(kept).length === 0) {
    delete next[key(shaderPath, passName)];
  } else {
    next[key(shaderPath, passName)] = kept;
  }
  remembered = next;
}

/** Returns and forgets the remembered fields, or undefined when there are none. */
export function takeFullscreenDraw(shaderPath: string | undefined, passName: string): FullscreenDrawFields | undefined {
  const fields = remembered[key(shaderPath, passName)];
  if (fields) {
    const { [key(shaderPath, passName)]: _taken, ...rest } = remembered;
    remembered = rest;
  }
  return fields;
}

export function resetFullscreenDrawMemory(): void {
  remembered = {};
}
