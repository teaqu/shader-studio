import type { ShaderFile } from './types/ShaderFile';

/**
 * Failed shaders whose files changed get another chance: drop them from the
 * failed set so the re-rendered thumbnail decides again. Shaders that no
 * longer exist are dropped too. Returns the original set when nothing changed.
 */
export function retainUnchangedFailures(
  failedPaths: Set<string>,
  previous: readonly ShaderFile[],
  next: readonly ShaderFile[],
): Set<string> {
  if (failedPaths.size === 0) {
    return failedPaths;
  }

  const previousVersions = new Map(previous.map(shader => [shader.path, shader.thumbnailVersion]));
  const nextVersions = new Map(next.map(shader => [shader.path, shader.thumbnailVersion]));
  const retained = new Set(
    [...failedPaths].filter(path => (
      nextVersions.has(path)
      && previousVersions.has(path)
      && nextVersions.get(path) === previousVersions.get(path)
    )),
  );
  return retained.size === failedPaths.size ? failedPaths : retained;
}
