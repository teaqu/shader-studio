import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageManifest {
  workspaces?: string[];
  scripts: Record<string, string>;
}

const rootManifestPath = path.resolve(__dirname, '../../../package.json');
const rootVitestConfigPath = path.resolve(
  __dirname,
  '../../../vitest.config.ts',
);
const rootLockfilePath = path.resolve(__dirname, '../../../package-lock.json');
const extensionManifestPath = path.resolve(__dirname, '../../package.json');
const removedPackagePath = path.resolve(__dirname, '../../../snippet-library');
const generatedDistPath = path.resolve(__dirname, '../../snippet-library-dist');
const rootManifest = JSON.parse(
  fs.readFileSync(rootManifestPath, 'utf8'),
) as PackageManifest;
const rootVitestConfig = fs.readFileSync(rootVitestConfigPath, 'utf8');
const rootLockfile = fs.readFileSync(rootLockfilePath, 'utf8');
const extensionManifest = JSON.parse(
  fs.readFileSync(extensionManifestPath, 'utf8'),
) as PackageManifest;

suite('Snippet build metadata', () => {
  test('does not include the removed webview package or build scripts', () => {
    assert.ok(!rootManifest.workspaces?.includes('snippet-library'));
    assert.ok(!Object.hasOwn(rootManifest.scripts, 'build:snippet-library'));
    assert.ok(!Object.hasOwn(rootManifest.scripts, 'dev:snippet-library'));
    assert.ok(!rootManifest.scripts.compile.includes('snippet-library-ui'));
    assert.ok(
      !Object.hasOwn(extensionManifest.scripts, 'build:snippet-library'),
    );
    assert.ok(
      !extensionManifest.scripts.package.includes('build:snippet-library'),
    );
    assert.ok(
      !rootVitestConfig.includes('snippet-library'),
      'root Vitest config should not reference the removed snippet library',
    );
    assert.ok(
      !rootVitestConfig.includes('snippet-library-ui'),
      'root Vitest config should not reference the removed workspace name',
    );
    assert.ok(
      !rootLockfile.includes('snippet-library'),
      'root lockfile should not contain the removed snippet library path',
    );
    assert.ok(
      !rootLockfile.includes('snippet-library-ui'),
      'root lockfile should not contain the removed workspace package name',
    );
    assert.ok(
      !fs.existsSync(removedPackagePath),
      'the removed snippet-library workspace directory should not exist',
    );
    assert.ok(
      !fs.existsSync(generatedDistPath),
      'generated extension snippet-library-dist artifacts should not exist',
    );
  });
});
