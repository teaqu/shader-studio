import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { shaderStudioAliasEntries, shaderStudioAliases } from '../../../vite.aliases.mjs';

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

type AliasEntry = { find: string | RegExp; replacement: string };

/** Mirrors Vite's alias step: the first matching entry rewrites the specifier. */
function applyAliases(specifier: string, entries: AliasEntry[]): string {
  for (const { find, replacement } of entries) {
    if (typeof find === 'string') {
      if (specifier === find || specifier.startsWith(`${find}/`)) {
        return replacement + specifier.slice(find.length);
      }
    } else if (find.test(specifier)) {
      return specifier.replace(find, replacement);
    }
  }
  return specifier;
}

/** Resolves a specifier the way the bundle would from `fromFile`, or null. */
function resolveFrom(fromFile: string, specifier: string, entries: AliasEntry[]): string | null {
  const aliased = applyAliases(specifier, entries);
  if (path.isAbsolute(aliased)) {
    return fs.existsSync(aliased) ? aliased : null;
  }
  try {
    return fs.realpathSync(createRequire(fromFile).resolve(aliased));
  } catch {
    return null;
  }
}

describe('monaco-editor deep imports in bundled dependencies', () => {
  const require = createRequire(__filename);
  const monacoVimEntry = require.resolve('monaco-vim').replace(/index\.cjs$/, 'index.mjs');
  const monacoVimSpecifiers = [
    ...new Set(
      [...fs.readFileSync(monacoVimEntry, 'utf8').matchAll(/from\s+["'](monaco-editor\/[^"']+)["']/g)]
        .map((match) => match[1]),
    ),
  ];

  it('finds the monaco-editor imports monaco-vim makes', () => {
    expect(monacoVimSpecifiers).toContain('monaco-editor/esm/vs/editor/editor.api');
  });

  // Monaco 0.57 added an exports map that roots deep imports at esm/vs/, so
  // monaco-vim's pre-0.57 `monaco-editor/esm/vs/...` paths stopped resolving.
  // Vite then leaves them as bare specifiers the webview cannot load, and the
  // whole app fails to start.
  it('resolves every monaco-editor path monaco-vim imports', () => {
    const unresolved = monacoVimSpecifiers.filter(
      (specifier) => resolveFrom(monacoVimEntry, specifier, shaderStudioAliasEntries) === null,
    );
    expect(unresolved).toEqual([]);
  });

  it('gives monaco-vim the same editor API module the app imports', () => {
    const appEditorApi = fs.realpathSync(require.resolve('monaco-editor/editor/editor.api.js'));
    expect(
      resolveFrom(monacoVimEntry, 'monaco-editor/esm/vs/editor/editor.api', shaderStudioAliasEntries),
    ).toBe(appEditorApi);
  });

  it('leaves current monaco-editor specifiers to the package exports map', () => {
    for (const specifier of ['monaco-editor', 'monaco-editor/editor/editor.api.js']) {
      expect(applyAliases(specifier, shaderStudioAliasEntries)).toBe(specifier);
    }
  });
});
