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
