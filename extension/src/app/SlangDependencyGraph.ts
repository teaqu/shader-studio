const SLANG_EXTENSION = '.slang';
const MAX_RAW_DELIMITER_LENGTH = 16;

interface CanonicalUri {
  readonly authority: string;
  readonly pathname: string;
  readonly uri: string;
}

function canonicalFileUri(uri: string): CanonicalUri {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'file:') {
    throw new Error(`Expected file URI, received ${uri}`);
  }
  const pathname = parsed.pathname
    .replaceAll('\\', '/')
    .replace(/^\/([A-Z]):/, (_, drive: string) => `/${drive.toLowerCase()}:`)
    .replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
  const canonical = new URL(`file://${parsed.host.toLowerCase()}${pathname}`);
  return { authority: canonical.host, pathname: canonical.pathname, uri: canonical.toString() };
}

/** Returns a valid encoded file URI without discarding authority or encoded path data. */
export function normalizeSlangUri(uri: string): string {
  return canonicalFileUri(uri).uri;
}

export function isSlangUriWithin(rootUri: string, uri: string): boolean {
  const root = canonicalFileUri(rootUri);
  const candidate = canonicalFileUri(uri);
  const rootPath = root.pathname.replace(/\/$/, '');
  return root.authority === candidate.authority
    && (candidate.pathname === rootPath || candidate.pathname.startsWith(`${rootPath}/`));
}

export function slangWorkspacePath(rootUri: string, uri: string): string | undefined {
  if (!isSlangUriWithin(rootUri, uri)) {
    return undefined;
  }
  const root = canonicalFileUri(rootUri).pathname.replace(/\/$/, '');
  const candidate = canonicalFileUri(uri).pathname;
  const segments = candidate.slice(root.length).split('/').map(decodeWorkspaceSegment);
  if (segments.some((segment) => segment === undefined)) {
    return undefined;
  }
  return `/workspace${segments.join('/')}`;
}

function decodeWorkspaceSegment(segment: string): string | undefined {
  if (/%(?:2f|5c|00)/i.test(segment)) {
    return undefined;
  }
  try {
    const decoded = decodeURIComponent(segment);
    return decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')
      ? undefined
      : decoded;
  } catch {
    return undefined;
  }
}

function asSlangPath(value: string): string {
  return value.endsWith(SLANG_EXTENSION) ? value : `${value}${SLANG_EXTENSION}`;
}

function resolveUri(baseUri: string, operand: string): string {
  return normalizeSlangUri(new URL(operand, baseUri).toString());
}

function encodeLiteralPath(operand: string): string {
  return operand.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
}

/** Replaces comments, ordinary strings, and C++-style raw strings with spaces. */
function maskNonCode(source: string): string {
  let result = '';
  for (let index = 0; index < source.length;) {
    const character = source[index];
    const next = source[index + 1];
    if (character === 'R' && next === '"') {
      const opener = source.slice(index + 2, index + 2 + MAX_RAW_DELIMITER_LENGTH + 1);
      const delimiterEnd = opener.indexOf('(');
      const delimiter = delimiterEnd === -1 ? undefined : opener.slice(0, delimiterEnd);
      const validDelimiter = delimiter !== undefined && !/[\s()\\"]/u.test(delimiter);
      if (!validDelimiter) {
        result += character;
        index += 1;
        continue;
      }
      const terminator = delimiter === undefined ? undefined : `)${delimiter}"`;
      const contentStart = index + 2 + delimiterEnd + 1;
      const end = terminator === undefined ? -1 : source.indexOf(terminator, contentStart);
      const stop = end === -1 ? source.length : Math.max(index + 1, end + terminator!.length);
      result += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else if (character === '/' && next === '/') {
      const ends = [source.indexOf('\n', index), source.indexOf('\r', index)].filter((end) => end !== -1);
      const stop = ends.length === 0 ? source.length : Math.min(...ends);
      result += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      result += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else if (character === '"' || character === "'") {
      const quote = character;
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2;
        } else if (source[end++] === quote) {
          break;
        }
      }
      result += source.slice(index, end).replace(/[^\n]/g, ' ');
      index = end;
    } else {
      result += character;
      index += 1;
    }
  }
  return result;
}

function directiveOperands(source: string): { value: string; module: boolean; dotted: boolean }[] {
  const masked = maskNonCode(source);
  const operands: { value: string; module: boolean; dotted: boolean }[] = [];
  const starts = /\bimport\s+|#include\s*|__include\s*\(\s*/g;
  const directive = /^(?:import\s+(?:([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|"([^"\n]+)")|#include\s*"([^"\n]+)"|__include\s*\(\s*"([^"\n]+)"\s*\))/;
  for (const start of masked.matchAll(starts)) {
    const match = source.slice(start.index).match(directive);
    if (!match) {
      continue;
    }
    const value = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (value) {
      operands.push({ value, module: Boolean(match[1]), dotted: Boolean(match[1]?.includes('.')) });
    }
  }
  return operands;
}

export class SlangDependencyGraph {
  private readonly dependencies = new Map<string, Set<string>>();
  private readonly rootUri: string;

  constructor(rootUri: string) {
    const canonical = normalizeSlangUri(rootUri);
    this.rootUri = canonical.endsWith('/') ? canonical : `${canonical}/`;
  }

  update(uri: string, source: string): void {
    const canonicalUri = normalizeSlangUri(uri);
    const dependencies = new Set<string>();
    for (const operand of directiveOperands(source)) {
      const candidates = operand.dotted ? [operand.value, operand.value.replaceAll('.', '/')] : [operand.value];
      const baseUri = operand.module ? this.rootUri : canonicalUri;
      for (const candidate of candidates) {
        const dependency = resolveUri(baseUri, encodeLiteralPath(asSlangPath(candidate)));
        if (isSlangUriWithin(this.rootUri, dependency)) {
          dependencies.add(dependency);
        }
      }
    }
    this.dependencies.set(canonicalUri, dependencies);
  }

  remove(uri: string): void {
    this.dependencies.delete(normalizeSlangUri(uri));
  }

  directDependencies(uri: string): ReadonlySet<string> {
    return new Set(this.dependencies.get(normalizeSlangUri(uri)) ?? []);
  }

  affectedRoots(uri: string, activeRoots: ReadonlySet<string>): ReadonlySet<string> {
    const target = normalizeSlangUri(uri);
    const reverse = new Map<string, Set<string>>();
    for (const [owner, dependencies] of this.dependencies) {
      for (const dependency of dependencies) {
        const owners = reverse.get(dependency) ?? new Set<string>();
        owners.add(owner);
        reverse.set(dependency, owners);
      }
    }
    const active = new Set([...activeRoots].map(normalizeSlangUri));
    const affected = new Set<string>();
    const pending = [target];
    const visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      if (active.has(current)) {
        affected.add(current);
      }
      for (const owner of reverse.get(current) ?? []) {
        pending.push(owner);
      }
    }
    return affected;
  }
}
