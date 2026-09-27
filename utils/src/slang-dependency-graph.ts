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

function findSlangImports(source: string): SlangImport[] {
  const withoutComments = stripComments(source);
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
  const sourceDir = path.dirname(path.normalize(sourcePath));

  function resolveFile(filePath: string, fallback: () => string): string {
    const resolved = path.normalize(path.resolve(sourceDir, filePath));
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

const MODULE_DECL_PATTERN = /^[ \t]*module\s+[A-Za-z_]\w*\s*;[ \t]*[\r\n]*/m;
const IMPLEMENTING_DECL_PATTERN = /^[ \t]*implementing\s+[A-Za-z_]\w*\s*;[ \t]*[\r\n]*/m;

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
  return replaceSourceLines(source, (match) => {
    const importPath = importPathFromLine(match);
    if (importPath === null) {
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
      .replace(IMPLEMENTING_DECL_PATTERN, "");

    // Recursively resolve imports in the inlined source
    inlined = resolveNested(inlined, path.dirname(resolved), readSource, visited);

    return inlined;
  });
}

function importPathFromLine(line: string): string | null {
  let text = line.trim();
  if (!text.startsWith("import") || (text[6] !== " " && text[6] !== "\t")) {
    return null;
  }
  text = text.slice(7).trim();
  if (text.endsWith(";")) {
    text = text.slice(0, -1).trimEnd();
  }
  if (text.startsWith('"')) {
    return text.length > 2 && text.endsWith('"') && !text.slice(1, -1).includes('"')
      ? text
      : null;
  }
  if (!text || !isIdentifierPath(text)) {
    return null;
  }
  return text;
}

function isIdentifierPath(value: string): boolean {
  return value.split(".").every((part) => /^[A-Za-z_]\w*$/.test(part));
}

function replaceSourceLines(source: string, replace: (line: string) => string): string {
  let output = "";
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline === -1 ? source.length : newline;
    output += replace(source.slice(start, end));
    if (newline === -1) {
      return output;
    }
    output += "\n";
    start = newline + 1;
  }
  return output;
}

function stripComments(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index + 2);
      if (newline === -1) {
        break;
      }
      output += "\n";
      index = newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) {
        output += source.slice(index);
        break;
      }
      index = end + 2;
      continue;
    }
    output += source[index];
    index++;
  }
  return output;
}
