import * as path from "path";
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

interface SlangImport {
  moduleName: string;
  relativePath: string;
}

const IMPORT_PATTERN = /^\s*(?:__exported\s+)?import\s+(?:"([^"]+)"|([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))\s*;/gm;

export function collectSlangDependencies(
  options: CollectSlangDependenciesOptions,
): SlangDependencyGraphResult {
  const rootPath = path.normalize(options.rootPath);
  const modules: SlangSourceModule[] = [];
  const errors: SlangDependencyDiagnostic[] = [];
  const visiting = new Set<string>([rootPath]);
  const visited = new Set<string>([rootPath]);

  const visit = (importerPath: string, source: string): void => {
    for (const dependency of findSlangImports(source)) {
      if (isShaderStudioEditorModule(dependency.moduleName)) {
        continue;
      }
      const resolvedPath = path.normalize(path.resolve(path.dirname(importerPath), dependency.relativePath));
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
  return `${moduleName.replace(/\./g, path.sep).replace(/_/g, "-")}.slang`;
}

function moduleNameFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

const INCLUDE_PATTERN = /^[ \t]*(?:#|__)include[ \t]+"([^"]+)"[ \t]*$/gm;

/**
 * Resolve `#include "…"` and `__include "…"` directives in Slang source by
 * inlining the referenced files. The Slang WASM runtime has no filesystem
 * access, so both preprocessor includes and module-level includes must be
 * resolved on the host before the source is handed to the compiler.
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
  const sourceDir = path.dirname(path.normalize(sourcePath));
  const resolved_source = source.replace(INCLUDE_PATTERN, (_match: string, includePath: string) => {
    const resolved = path.normalize(path.resolve(sourceDir, includePath));
    if (visited.has(resolved)) {
      return _match; // cycle — leave unresolved, Slang will report it
    }
    const content = readSource(resolved);
    if (content === null) {
      return _match; // file not found — leave unresolved, Slang will report it
    }
    visited.add(resolved);
    includedPaths.push(resolved);
    return resolveSlangIncludes(content, resolved, readSource, visited, includedPaths).source;
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
  const sourceDir = path.dirname(path.normalize(sourcePath));
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

    const resolved = path.normalize(path.resolve(sourceDir, cleanPath));
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
    inlined = resolveNested(inlined, path.dirname(resolved), readSource, visited);

    return inlined;
  });
}
