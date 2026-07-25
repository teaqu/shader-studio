import * as path from 'path';

const SLANG_EXTENSION = '.slang';

function normalizedPath(uri: string): string {
  if (uri.startsWith('file:')) {
    const parsed = new URL(uri);
    const pathname = decodeURIComponent(parsed.pathname).replaceAll('\\', '/');
    return path.posix.normalize(pathname.replace(/^\/([A-Z]):/, (_, drive: string) => `/${drive.toLowerCase()}:`));
  }
  return path.posix.normalize(uri.replaceAll('\\', '/'));
}

export function normalizeSlangUri(uri: string): string {
  const pathname = normalizedPath(uri);
  return uri.startsWith('file:') ? `file://${pathname}` : pathname;
}

function asSlangPath(value: string): string {
  return value.endsWith(SLANG_EXTENSION) ? value : `${value}${SLANG_EXTENSION}`;
}

function resolveUri(baseUri: string, operand: string): string {
  const base = normalizedPath(baseUri);
  const resolved = operand.startsWith('/') ? operand : path.posix.resolve(path.posix.dirname(base), operand);
  return baseUri.startsWith('file:') ? `file://${resolved}` : resolved;
}

/** Replaces comments and ordinary strings with spaces, preserving directive path literals. */
function maskNonCode(source: string): string {
  let result = '';
  for (let index = 0; index < source.length;) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
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

function directiveOperands(source: string): { value: string; dotted: boolean }[] {
  const masked = maskNonCode(source);
  const operands: { value: string; dotted: boolean }[] = [];
  const starts = /\bimport\s+|#include\s*|__include\s*\(\s*/g;
  const directive = /^(?:import\s+(?:([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|"([^"\n]+)")|#include\s*"([^"\n]+)"|__include\s*\(\s*"([^"\n]+)"\s*\))/;
  for (const start of masked.matchAll(starts)) {
    const match = source.slice(start.index).match(directive);
    if (!match) {
      continue;
    }
    const value = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (value) {
      operands.push({ value, dotted: Boolean(match[1]?.includes('.')) });
    }
  }
  return operands;
}

export class SlangDependencyGraph {
  private readonly rootPath: string;
  private readonly sources = new Map<string, string>();
  private readonly dependencies = new Map<string, Set<string>>();

  constructor(rootUri: string) {
    this.rootPath = normalizedPath(rootUri);
  }

  update(uri: string, source: string): void {
    const canonicalUri = normalizeSlangUri(uri);
    this.sources.set(canonicalUri, source);
    const dependencies = new Set<string>();
    for (const operand of directiveOperands(source)) {
      const candidates = operand.dotted
        ? [operand.value, operand.value.replaceAll('.', '/')]
        : [operand.value];
      for (const candidate of candidates) {
        const dependency = resolveUri(canonicalUri, asSlangPath(candidate));
        if (normalizedPath(dependency) === this.rootPath || normalizedPath(dependency).startsWith(`${this.rootPath}/`)) {
          dependencies.add(normalizeSlangUri(dependency));
        }
      }
    }
    this.dependencies.set(canonicalUri, dependencies);
  }

  remove(uri: string): void {
    const canonicalUri = normalizeSlangUri(uri);
    this.sources.delete(canonicalUri);
    this.dependencies.delete(canonicalUri);
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
