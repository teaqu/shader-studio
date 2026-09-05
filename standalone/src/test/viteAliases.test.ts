import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { shaderStudioAliases } from '../../../vite.aliases.mjs';

const repoRoot = path.resolve(__dirname, '../../..');

// Added by whichever shell composes them, so they are absent from the shared map.
const hostSuppliedAliases = new Set([
  '@shader-studio/ui',
  '@shader-studio/shader-explorer',
]);

const sourceExtensions = new Set(['.ts', '.mts', '.js', '.mjs', '.svelte']);

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : collectSourceFiles(full);
    }
    return sourceExtensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

function importedScopedPackages(file: string): string[] {
  const contents = fs.readFileSync(file, 'utf8');
  const matches = contents.matchAll(/["'](@shader-studio\/[a-z0-9-]+)(?:\/[^"']*)?["']/g);
  return [...matches].map((match) => match[1]);
}

describe('shared vite source aliases', () => {
  it('points every alias at a directory that exists', () => {
    for (const [name, target] of Object.entries(shaderStudioAliases)) {
      expect(fs.existsSync(target), `${name} -> ${target}`).toBe(true);
    }
  });

  it('aliases every in-repo package the aliased sources import', () => {
    const missing = new Map<string, string>();

    for (const target of Object.values(shaderStudioAliases)) {
      for (const file of collectSourceFiles(target)) {
        for (const pkg of importedScopedPackages(file)) {
          if (pkg in shaderStudioAliases || hostSuppliedAliases.has(pkg)) {
            continue;
          }
          if (!missing.has(pkg)) {
            missing.set(pkg, path.relative(repoRoot, file));
          }
        }
      }
    }

    // Without an alias these fall back to the workspace package's `main`, which
    // only exists after that package has been built — so `npm run
    // build:standalone` on a clean checkout fails to resolve the entry.
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it('aliases @shader-studio/utils to its sources', () => {
    expect(shaderStudioAliases['@shader-studio/utils']).toBe(
      path.resolve(repoRoot, 'utils/src'),
    );
  });
});
