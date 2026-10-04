import { describe, it, expect } from 'vitest';
import { retainUnchangedFailures } from './shaderListUpdate';
import type { ShaderFile } from './types/ShaderFile';

const shader = (path: string, thumbnailVersion?: number): ShaderFile => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  relativePath: path.slice(1),
  hasConfig: false,
  thumbnailVersion,
});

describe('retainUnchangedFailures', () => {
  it('returns the same set when nothing has failed', () => {
    const failed = new Set<string>();
    expect(retainUnchangedFailures(failed, [shader('/a.glsl', 1)], [shader('/a.glsl', 2)])).toBe(failed);
  });

  it('returns the same set when no failed shader changed', () => {
    const failed = new Set(['/a.glsl']);
    const result = retainUnchangedFailures(
      failed,
      [shader('/a.glsl', 1), shader('/b.glsl', 1)],
      [shader('/a.glsl', 1), shader('/b.glsl', 2)],
    );
    expect(result).toBe(failed);
  });

  it('drops failed shaders whose version changed', () => {
    const failed = new Set(['/a.glsl', '/b.glsl']);
    const result = retainUnchangedFailures(
      failed,
      [shader('/a.glsl', 1), shader('/b.glsl', 1)],
      [shader('/a.glsl', 2), shader('/b.glsl', 1)],
    );
    expect([...result]).toEqual(['/b.glsl']);
    expect(failed.has('/a.glsl')).toBe(true);
  });

  it('drops failed shaders that were removed', () => {
    const result = retainUnchangedFailures(new Set(['/a.glsl']), [shader('/a.glsl', 1)], []);
    expect(result.size).toBe(0);
  });

  it('drops failed shaders that were missing from the previous list', () => {
    const result = retainUnchangedFailures(new Set(['/a.glsl']), [], [shader('/a.glsl', 1)]);
    expect(result.size).toBe(0);
  });

  it('treats a version appearing or disappearing as a change', () => {
    const result = retainUnchangedFailures(
      new Set(['/a.glsl', '/b.glsl']),
      [shader('/a.glsl'), shader('/b.glsl', 1)],
      [shader('/a.glsl', 1), shader('/b.glsl')],
    );
    expect(result.size).toBe(0);
  });
});
