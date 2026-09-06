import { basename, dirname, extname, normalize, resolve } from "pathe";
import type { SlangDependencyDiagnostic, SlangSourceModule } from "@shader-studio/types";

interface CollectSlangDependenciesOptions {
  rootPath: string;
  rootSource: string;
  ownerPass: string;
  readSource: (filePath: string) => string | null;
}

export interface SlangDependencyGraphResult {
  modules: SlangSourceModule[];
  errors: SlangDependencyDiagnostic[];
}

export type AsyncSlangReadSource = (filePath: string) => Promise<string | null>;

/**
 * Runs a synchronous traversal to a fixpoint over an asynchronous file
 * reader. Each round records the paths the traversal asked for, fetches them,
 * and reruns with a fuller cache; the first round with no misses sees every
 * file the synchronous version would have seen, so its result is identical.
 * Only the final round's result is kept — earlier rounds may report spurious
 * "not found" errors for files that simply had not been fetched yet.
 */
async function driveAsyncTraversal<T>(
  run: (readSource: (filePath: string) => string | null) => T,
  readSource: AsyncSlangReadSource,
): Promise<T> {
  const cache = new Map<string, string | null>();
  for (;;) {
    const missing = new Set<string>();
    const syncRead = (filePath: string): string | null => {
      if (cache.has(filePath)) {
        return cache.get(filePath) ?? null;
      }
      missing.add(filePath);
      return null;
    };
    const result = run(syncRead);
    if (missing.size === 0) {
      return result;
    }
    await Promise.all([...missing].map(async (filePath) => {
      if (!cache.has(filePath)) {
        cache.set(filePath, await readSource(filePath));
      }
    }));
  }
}

export interface CollectSlangDependenciesAsyncOptions {
  rootPath: string;
  rootSource: string;
  ownerPass: string;
  readSource: AsyncSlangReadSource;
}

/** Async variant of {@link collectSlangDependencies} for hosts without sync file access. */
export function collectSlangDependenciesAsync(
  options: CollectSlangDependenciesAsyncOptions,
): Promise<SlangDependencyGraphResult> {
  return driveAsyncTraversal(
    (readSource) => collectSlangDependencies({ ...options, readSource }),
    options.readSource,
  );
}

/** Async variant of {@link resolveSlangIncludes} for hosts without sync file access. */
export function resolveSlangIncludesAsync(
  source: string,
  sourcePath: string,
  readSource: AsyncSlangReadSource,
): Promise<ResolvedIncludesResult> {
  return driveAsyncTraversal(
    (syncRead) => resolveSlangIncludes(source, sourcePath, syncRead),
    readSource,
  );
}

interface SlangImport {
  moduleName: string;
  relativePath: string;
}

const IMPORT_PATTERN = /^\s*(?:__exported\s+)?import\s+(?:"([^"]+)"|([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))\s*;/gm;

export function collectSlangDependencies(
  options: CollectSlangDependenciesOptions,
): SlangDependencyGraphResult {
  const rootPath = normalize(options.rootPath);
  const modules: SlangSourceModule[] = [];
  const errors: SlangDependencyDiagnostic[] = [];
  const visiting = new Set<string>([rootPath]);
  const visited = new Set<string>([rootPath]);

  const visit = (importerPath: string, source: string): void => {
    for (const dependency of findSlangImports(source)) {
      if (isShaderStudioEditorModule(dependency.moduleName)) {
        continue;
      }
      const resolvedPath = normalize(resolve(dirname(importerPath), dependency.relativePath));
      if (visiting.has(resolvedPath) || visited.has(resolvedPath)) {
        continue;
      }

      const dependencySource = options.readSource(resolvedPath);
      if (dependencySource === null) {
        errors.push({
          code: "slang-module-not-found",
          importerPath,
          moduleName: dependency.moduleName,
          resolvedPath,
          message: `Cannot resolve Slang module '${dependency.moduleName}' imported by ${importerPath}`,
        });
        continue;
      }

      visiting.add(resolvedPath);
      visit(resolvedPath, dependencySource);
      visiting.delete(resolvedPath);
      visited.add(resolvedPath);
      modules.push({
        moduleName: dependency.moduleName,
        path: resolvedPath,
        source: dependencySource,
        ownerPass: options.ownerPass,
      });
    }
  };

  visit(rootPath, options.rootSource);
  return { modules, errors };
}

function isShaderStudioEditorModule(moduleName: string): boolean {
  return moduleName === "shader_studio" || moduleName === "shader-studio";
}

function findSlangImports(source: string): SlangImport[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const imports: SlangImport[] = [];
  for (const match of withoutComments.matchAll(IMPORT_PATTERN)) {
    const quotedPath = match[1];
    const moduleName = match[2] ?? moduleNameFromPath(quotedPath);
    imports.push({
      moduleName,
      relativePath: quotedPath ?? moduleNameToPath(moduleName),
    });
  }
  return imports;
}

function moduleNameToPath(moduleName: string): string {
  return `${moduleName.replace(/\./g, '/').replace(/_/g, "-")}.slang`;
}

function moduleNameFromPath(filePath: string): string {
  return basename(filePath, extname(filePath));
}

const INCLUDE_STRING_PATTERN = /^[ \t]*(?:#include[ \t]+"([^"]+)"|__include[ \t]+"([^"]+)")[ \t]*$/gm;
const INCLUDE_IDENT_PATTERN = /^[ \t]*__include[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*;?[ \t]*$/gm;

/**
 * Resolve `#include "…"`, `__include "…"`, and `__include identifier` directives
 * in Slang source by inlining the referenced files. The Slang WASM runtime has
 * no filesystem access, so includes must be resolved on the host before the
 * source is handed to the compiler.
 *
 * The identifier form (`__include dir.file_name`) is translated per the Slang
 * spec: underscores become hyphens, dots become path separators, and `.slang`
 * is appended.
 *
 * Resolution is relative to the source file's directory and is recursive (an
 * included file may itself include other files). Cycles are detected and left
 * as unresolved directives.
 */
export interface ResolvedIncludesResult {
  source: string;
  includedPaths: string[];
}

export function resolveSlangIncludes(
  source: string,
  sourcePath: string,
  readSource: (filePath: string) => string | null,
  visited = new Set<string>(),
  includedPaths: string[] = [],
): ResolvedIncludesResult {
  const sourceDir = dirname(normalize(sourcePath));

  function resolveFile(filePath: string, fallback: () => string): string {
    const resolved = normalize(resolve(sourceDir, filePath));
    if (visited.has(resolved)) {
      return fallback();
    }
    const content = readSource(resolved);
    if (content === null) {
      return fallback();
    }
    visited.add(resolved);
    includedPaths.push(resolved);
    return resolveSlangIncludes(content, resolved, readSource, visited, includedPaths).source;
  }

  // String form: #include "path" / __include "path"
  const afterStrings = source.replace(INCLUDE_STRING_PATTERN, (_match: string, hashPath: string, usPath: string) => {
    const filePath = hashPath || usPath;
    return resolveFile(filePath, () => _match);
  });

  // Identifier form: __include dir.file_name
  const resolved_source = afterStrings.replace(INCLUDE_IDENT_PATTERN, (_match: string, identPath: string) => {
    // Slang spec: _ → -, . → /, append .slang
    const filePath = identPath.replace(/_/g, "-").replace(/\./g, "/") + ".slang";
    return resolveFile(filePath, () => _match);
  });

  return { source: resolved_source, includedPaths };
}

const IMPORT_PATTERN_HOST = /^[ \t]*import[ \t]+((?:[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|"[^"]+")[ \t]*;?[ \t]*$/gm;
const MODULE_DECL_PATTERN = /^[ \t]*module\s+[A-Za-z_]\w*\s*;[ \t]*[\r\n]*/m;
const IMPLEMENTING_DECL_PATTERN = /^[ \t]*implementing\s+[A-Za-z_]\w*\s*;[ \t]*[\r\n]*/m;
const SHADER_STUDIO_MODULE_DECL_PATTERN = /^[ \t]*module\s+(shader_studio|shader-studio)\s*;[ \t]*[\r\n]*/m;

/**
 * Resolve `import` declarations by inlining the imported module's source.
 * The Slang WASM runtime cannot open files, so imports must be resolved on
 * the host before the source reaches the compiler.
 *
 * The imported module's `module` and `implementing` declarations are stripped
 * from the inlined source so the symbols become part of the importing module.
 * Resolution is recursive and relative to the source file's directory.
 */
export function resolveSlangImports(
  source: string,
  sourcePath: string,
  readSource: (filePath: string) => string | null,
): string {
  const sourceDir = dirname(normalize(sourcePath));
  const visited = new Set<string>();
  return resolveNested(source, sourceDir, readSource, visited);
}

function resolveNested(
  source: string,
  sourceDir: string,
  readSource: (filePath: string) => string | null,
  visited: Set<string>,
): string {
  return source.replace(IMPORT_PATTERN_HOST, (match: string, importPath: string) => {
    // Skip shader_studio editor imports — handled separately
    if (importPath === "shader_studio" || importPath === '"shader-studio.slang"' || importPath === '"shader-studio"') {
      return match;
    }

    // Strip quotes for string form: "path/to/file.slang" → path/to/file.slang
    const cleanPath = importPath.startsWith('"')
      ? importPath.slice(1, -1)
      : importPath.replace(/_/g, "-").replace(/\./g, "/") + ".slang";

    const resolved = normalize(resolve(sourceDir, cleanPath));
    if (visited.has(resolved)) {
      return match; // cycle
    }
    const content = readSource(resolved);
    if (content === null) {
      return match; // file not found — leave for Slang to report
    }
    visited.add(resolved);

    // Strip module/implementing declarations from inlined source
    let inlined = content
      .replace(MODULE_DECL_PATTERN, "")
      .replace(IMPLEMENTING_DECL_PATTERN, "")
      .replace(SHADER_STUDIO_MODULE_DECL_PATTERN, "");

    // Recursively resolve imports in the inlined source
    inlined = resolveNested(inlined, dirname(resolved), readSource, visited);

    return inlined;
  });
}
