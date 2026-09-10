/**
 * User source ↔ assembled module positions. The WGSL wrapper prepends
 * `preludeLineCount` generated lines before the user's line 1 (Phase 5), so an
 * assembled-module line maps back by subtracting that offset. All lines here
 * are 1-based, matching compiler diagnostics.
 */

export interface WgslAssembledMapping {
  /** Generated lines preceding the user's line 1. */
  readonly preludeLineCount: number;
  /** Lines in the user's source. */
  readonly userLineCount: number;
}

export function buildWgslAssembledMapping(preludeLineCount: number, userLineCount: number): WgslAssembledMapping {
  return { preludeLineCount, userLineCount };
}

/** Maps a 1-based assembled-module line onto its 1-based user line, clamped into range. */
export function assembledLineToUserLine(mapping: WgslAssembledMapping, assembledLine: number): number {
  return Math.min(Math.max(1, assembledLine - mapping.preludeLineCount), Math.max(1, mapping.userLineCount));
}

/** Maps a 1-based user line onto its 1-based assembled-module line. */
export function userLineToAssembledLine(mapping: WgslAssembledMapping, userLine: number): number {
  return Math.max(1, userLine) + mapping.preludeLineCount;
}
