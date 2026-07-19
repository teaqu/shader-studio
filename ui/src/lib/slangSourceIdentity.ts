import type { SlangWorkspaceFile, SlangWorkspaceSnapshot } from '@shader-studio/types';

export type SlangSourceResolution =
  | { status: 'matched'; file: SlangWorkspaceFile }
  | { status: 'unmatched' | 'ambiguous' };

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathValue(value: string): string {
  const rawPath = decoded(value).replaceAll('\\', '/');
  if (/^[A-Za-z]:\//.test(rawPath)) {
    return `/${rawPath}`;
  }
  try {
    return decoded(new URL(value).pathname).replaceAll('\\', '/');
  } catch {
    return rawPath;
  }
}

export function cloneSlangWorkspace(snapshot: SlangWorkspaceSnapshot): SlangWorkspaceSnapshot {
  return { rootUri: snapshot.rootUri, files: snapshot.files.map((file) => ({ ...file })) };
}

export function resolveSlangWorkspaceFile(
  snapshot: SlangWorkspaceSnapshot,
  selector: string,
): SlangSourceResolution {
  const windows = /^file:\/\/[A-Za-z]:/i.test(snapshot.rootUri)
    || /^\/[A-Za-z]:\//.test(pathValue(snapshot.rootUri));
  const normalize = (value: string) => {
    const result = pathValue(value).replace(/\/$/, '');
    return windows ? result.toLowerCase() : result;
  };
  const selected = normalize(selector);
  const isAbsoluteSelector = /^[A-Za-z]:[\\/]/.test(selector)
    || selector.startsWith('/')
    || /^[A-Za-z][A-Za-z\d+.-]*:/.test(selector);
  const matches = snapshot.files.filter((file) => {
    const uriPath = normalize(file.uri);
    const internal = normalize(file.path);
    const relative = internal.replace(/^\/workspace\/?/, '');
    const selectedRelative = selected.replace(/^\/+/, '');
    if (isAbsoluteSelector) {
      return selected === uriPath || selected === internal;
    }
    return selectedRelative === relative || relative.endsWith(`/${selectedRelative}`);
  });
  if (matches.length === 1) {
    return { status: 'matched', file: matches[0] };
  }
  return { status: matches.length === 0 ? 'unmatched' : 'ambiguous' };
}
