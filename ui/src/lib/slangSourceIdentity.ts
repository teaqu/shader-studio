import type { SlangWorkspaceFile, SlangWorkspaceSnapshot } from '@shader-studio/types';

export type SlangSourceResolution =
  | { status: 'matched'; file: SlangWorkspaceFile }
  | { status: 'unmatched' | 'ambiguous' };

export function cloneSlangWorkspace(workspace: SlangWorkspaceSnapshot): SlangWorkspaceSnapshot {
  return {
    rootUri: workspace.rootUri,
    files: workspace.files.map((file) => ({ ...file })),
  };
}

export function resolveSlangWorkspaceFile(
  workspace: SlangWorkspaceSnapshot,
  selector: string,
): SlangSourceResolution {
  const exactMatch = workspace.files.find((file) => file.uri === selector || file.path === selector);
  if (exactMatch) {
    return { status: 'matched', file: exactMatch };
  }

  const normalizedSelector = selector.replace(/\\/g, '/').replace(/^\.\//, '');
  const suffixMatches = workspace.files.filter((file) => {
    const path = file.path.replace(/\\/g, '/');
    const uriPath = decodeURIComponent(new URL(file.uri).pathname);
    return path.endsWith(`/${normalizedSelector}`) || uriPath.endsWith(`/${normalizedSelector}`);
  });

  if (suffixMatches.length === 1) {
    return { status: 'matched', file: suffixMatches[0] };
  }

  return { status: suffixMatches.length === 0 ? 'unmatched' : 'ambiguous' };
}
