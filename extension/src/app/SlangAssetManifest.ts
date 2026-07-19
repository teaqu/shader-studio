import * as fs from 'fs';
import * as path from 'path';

export interface SlangAssetPaths {
  scriptPath: string;
  wasmPath: string;
  workerPath: string;
}

type SlangAssetKey = 'script' | 'wasm' | 'worker';

interface PathSemantics {
  readonly sep: string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
}

export function isPathOutsideRoot(
  rootPath: string,
  resolvedPath: string,
  pathSemantics: PathSemantics = path,
): boolean {
  const relativePath = pathSemantics.relative(rootPath, resolvedPath);
  return relativePath === '..'
    || relativePath.startsWith(`..${pathSemantics.sep}`)
    || pathSemantics.isAbsolute(relativePath);
}

export function loadSlangAssetPaths(extensionPath: string): SlangAssetPaths {
  const uiDistPath = path.resolve(extensionPath, 'ui-dist');
  const manifestPath = path.join(uiDistPath, 'slang-assets.json');
  const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('Slang asset manifest must be an object');
  }

  const resolveAssetPath = (key: SlangAssetKey): string => {
    const relativePath = (manifest as Record<string, unknown>)[key];
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error(`Slang asset manifest is missing string key "${key}"`);
    }

    const resolvedPath = path.resolve(uiDistPath, relativePath);
    if (isPathOutsideRoot(uiDistPath, resolvedPath)) {
      throw new Error(`Slang asset path escapes ui-dist: ${relativePath}`);
    }

    return resolvedPath;
  };

  return {
    scriptPath: resolveAssetPath('script'),
    wasmPath: resolveAssetPath('wasm'),
    workerPath: resolveAssetPath('worker'),
  };
}
