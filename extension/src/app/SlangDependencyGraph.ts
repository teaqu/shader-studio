interface ExtractedReference {
  kind: "module" | "path";
  value: string;
}

function canonicalUri(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid Slang workspace URI "${uri}"`);
  }
  if (parsed.protocol !== "file:") {
    throw new Error(`Unsupported Slang workspace URI "${uri}"`);
  }
  if (parsed.hostname.toLowerCase() === "localhost") {
    parsed.hostname = "";
  }
  if (/^\/[A-Za-z]:(?:\/|$)/.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.toLowerCase();
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.href;
}

function isWithinRoot(uri: string, rootUri: string): boolean {
  const root = canonicalUri(rootUri).replace(/\/$/, "");
  const candidate = canonicalUri(uri);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function resolvePath(ownerUri: string, reference: string, rootUri?: string): string {
  const normalizedReference = reference.replaceAll("\\", "/");
  const resolved = normalizedReference.startsWith("@/")
    ? rootUri === undefined
      ? new URL(normalizedReference.slice(2), new URL("./", canonicalUri(ownerUri))).href
      : new URL(normalizedReference.slice(2), `${canonicalUri(rootUri).replace(/\/$/, "")}/`).href
    : new URL(normalizedReference, canonicalUri(ownerUri)).href;
  const canonical = canonicalUri(resolved);
  if (rootUri !== undefined && !isWithinRoot(canonical, rootUri)) {
    throw new Error(`Dependency "${reference}" is outside the Slang workspace root "${rootUri}"`);
  }
  return canonical;
}

function maskCommentsAndStrings(source: string): string {
  // String indexing is UTF-16 code-unit based. split("") preserves that same
  // indexing, unlike the code-point iteration used by the spread operator.
  const result = source.split("");
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    if (current === "/" && next === "/") {
      result[index++] = " ";
      result[index++] = " ";
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") {
        result[index++] = " ";
      }
      continue;
    }
    if (current === "/" && next === "*") {
      result[index++] = " ";
      result[index++] = " ";
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          result[index++] = " ";
          result[index++] = " ";
          break;
        }
        if (source[index] !== "\n" && source[index] !== "\r") {
          result[index] = " ";
        }
        index++;
      }
      continue;
    }
    if (current === '"' || current === "'") {
      const quote = current;
      result[index++] = " ";
      while (index < source.length) {
        const character = source[index];
        result[index] = character === "\n" || character === "\r" ? character : " ";
        index++;
        if (character === "\\" && index < source.length) {
          if (source[index] !== "\n" && source[index] !== "\r") {
            result[index] = " ";
          }
          index++;
        } else if (character === quote) {
          break;
        }
      }
      continue;
    }
    index++;
  }
  return result.join("");
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? "")) {
    index++;
  }
  return index;
}

function quotedValue(source: string, start: number): { value: string; end: number } | undefined {
  const opener = source[start];
  const closer = opener === "<" ? ">" : opener;
  if (opener !== '"' && opener !== "'" && opener !== "<") {
    return undefined;
  }
  let value = "";
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (character === closer) {
      return { value, end: index + 1 };
    }
    if (character === "\\" && opener !== "<" && index + 1 < source.length) {
      const escaped = source[index + 1];
      if (escaped === opener) {
        value += escaped;
      } else if (escaped === "\\") {
        value += "\\";
      } else {
        // Slang accepts Windows-style paths in quoted dependency references.
        // Preserve a non-escape backslash for resolvePath() to normalize.
        value += `\\${escaped}`;
      }
      index++;
    } else if (character === "\n" || character === "\r") {
      return undefined;
    } else {
      value += character;
    }
  }
  return undefined;
}

function extractReferences(source: string): ExtractedReference[] {
  const mask = maskCommentsAndStrings(source);
  const references: ExtractedReference[] = [];

  for (const match of mask.matchAll(/\bimport\b/g)) {
    let index = skipWhitespace(source, (match.index ?? 0) + match[0].length);
    const quoted = quotedValue(source, index);
    if (quoted !== undefined) {
      references.push({ kind: "path", value: quoted.value });
      continue;
    }
    const module = source.slice(index).match(/^([A-Za-z_]\w*(?:\s*(?:\.|::)\s*[A-Za-z_]\w*)*)\s*;/);
    if (module?.[1]) {
      references.push({ kind: "module", value: module[1].replace(/\s+/g, "") });
    }
  }

  for (const match of mask.matchAll(/#\s*include\b|\b__include\b/g)) {
    let index = skipWhitespace(source, (match.index ?? 0) + match[0].length);
    if (source[index] === "(") {
      index = skipWhitespace(source, index + 1);
    }
    const quoted = quotedValue(source, index);
    if (quoted !== undefined) {
      references.push({ kind: "path", value: quoted.value });
    }
  }

  return references;
}

export class SlangDependencyGraph {
  private readonly forward = new Map<string, Set<string>>();
  private readonly reverse = new Map<string, Set<string>>();
  private readonly ambiguousModuleOwners = new Set<string>();
  private readonly moduleImportsByOwner = new Map<string, Set<string>>();
  private readonly moduleImporters = new Map<string, Set<string>>();
  private readonly declaredModules = new Map<string, string>();
  private readonly moduleInvalidationOwners = new Map<string, Set<string>>();
  private readonly knownSources = new Set<string>();
  private readonly rootUri?: string;

  constructor(rootUri?: string) {
    this.rootUri = rootUri === undefined ? undefined : canonicalUri(rootUri);
  }

  update(uri: string, source: string): void {
    const owner = canonicalUri(uri);
    if (this.rootUri !== undefined && !isWithinRoot(owner, this.rootUri)) {
      throw new Error(`URI "${uri}" is outside the Slang workspace root "${this.rootUri}"`);
    }

    const dependencies = new Set<string>();
    const references = extractReferences(source);
    const moduleImports = new Set(
      references
        .filter((reference) => reference.kind === "module")
        .map((reference) => reference.value.replaceAll("::", ".")),
    );
    for (const reference of references) {
      if (reference.kind === "path") {
        dependencies.add(resolvePath(owner, reference.value, this.rootUri));
        if (!/\.[^/]+$/.test(reference.value)) {
          dependencies.add(resolvePath(owner, `${reference.value}.slang`, this.rootUri));
        }
        continue;
      }
      const dotted = reference.value.replaceAll("::", ".");
      dependencies.add(resolvePath(owner, `${dotted}.slang`, this.rootUri));
      if (this.rootUri !== undefined) {
        dependencies.add(resolvePath(owner, `@/${dotted}.slang`, this.rootUri));
      }
      if (dotted.includes(".")) {
        const nested = `${dotted.replaceAll(".", "/")}.slang`;
        dependencies.add(resolvePath(owner, nested, this.rootUri));
        if (this.rootUri !== undefined) {
          dependencies.add(resolvePath(owner, `@/${nested}`, this.rootUri));
        }
      }
    }

    const declaration = maskCommentsAndStrings(source).match(
      /\bmodule\s+([A-Za-z_]\w*(?:\s*(?:\.|::)\s*[A-Za-z_]\w*)*)\s*;/,
    );
    const declaredModule = declaration?.[1]
      ?.replace(/\s+/g, "")
      .replaceAll("::", ".");
    const invalidationOwners = new Set<string>();
    for (const moduleName of [this.declaredModules.get(owner), declaredModule]) {
      if (moduleName) {
        for (const importer of this.moduleImporters.get(moduleName) ?? []) {
          invalidationOwners.add(importer);
        }
      }
    }

    this.clearOutgoing(owner);
    this.knownSources.add(owner);
    this.forward.set(owner, dependencies);
    if (moduleImports.size > 0) {
      this.ambiguousModuleOwners.add(owner);
    }
    this.moduleImportsByOwner.set(owner, moduleImports);
    for (const moduleName of moduleImports) {
      const importers = this.moduleImporters.get(moduleName) ?? new Set<string>();
      importers.add(owner);
      this.moduleImporters.set(moduleName, importers);
    }
    this.moduleInvalidationOwners.set(owner, invalidationOwners);
    if (declaredModule) {
      this.declaredModules.set(owner, declaredModule);
    } else {
      this.declaredModules.delete(owner);
    }
    for (const dependency of dependencies) {
      const owners = this.reverse.get(dependency) ?? new Set<string>();
      owners.add(owner);
      this.reverse.set(dependency, owners);
    }
  }

  remove(uri: string): void {
    const canonical = canonicalUri(uri);
    const invalidationOwners = new Set<string>();
    const declaredModule = this.declaredModules.get(canonical);
    if (declaredModule) {
      for (const importer of this.moduleImporters.get(declaredModule) ?? []) {
        invalidationOwners.add(importer);
      }
    }
    this.clearOutgoing(canonical);
    this.forward.delete(canonical);
    this.declaredModules.delete(canonical);
    this.moduleInvalidationOwners.set(canonical, invalidationOwners);
  }

  directDependencies(uri: string): ReadonlySet<string> {
    return new Set(this.forward.get(canonicalUri(uri)) ?? []);
  }

  affectedRoots(
    uri: string,
    activeRoots: ReadonlySet<string>,
    conservativeModuleInvalidation = true,
  ): ReadonlySet<string> {
    const roots = new Set([...activeRoots].map(canonicalUri));
    const affected = new Set<string>();
    const visited = new Set<string>();
    const changedUri = canonicalUri(uri);
    const pending = [changedUri];
    const moduleOwners = this.moduleInvalidationOwners.get(changedUri);
    if (moduleOwners !== undefined) {
      pending.push(...moduleOwners);
    } else if (conservativeModuleInvalidation && !this.knownSources.has(changedUri)) {
      pending.push(...this.ambiguousModuleOwners);
    }

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);
      if (roots.has(current)) {
        affected.add(current);
      }
      for (const owner of this.reverse.get(current) ?? []) {
        pending.push(owner);
      }
    }

    return affected;
  }

  private clearOutgoing(owner: string): void {
    this.ambiguousModuleOwners.delete(owner);
    for (const moduleName of this.moduleImportsByOwner.get(owner) ?? []) {
      const importers = this.moduleImporters.get(moduleName);
      importers?.delete(owner);
      if (importers?.size === 0) {
        this.moduleImporters.delete(moduleName);
      }
    }
    this.moduleImportsByOwner.delete(owner);
    for (const dependency of this.forward.get(owner) ?? []) {
      const owners = this.reverse.get(dependency);
      owners?.delete(owner);
      if (owners?.size === 0) {
        this.reverse.delete(dependency);
      }
    }
  }
}
