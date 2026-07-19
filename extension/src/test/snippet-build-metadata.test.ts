import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageManifest {
  workspaces?: string[];
  scripts: Record<string, string>;
}

const rootManifestPath = path.resolve(__dirname, '../../../package.json');
const extensionManifestPath = path.resolve(__dirname, '../../package.json');
const rootManifest = JSON.parse(
  fs.readFileSync(rootManifestPath, 'utf8'),
) as PackageManifest;
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
  });
});
