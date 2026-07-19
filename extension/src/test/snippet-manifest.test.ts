import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface CommandContribution {
  command: string;
}

interface SnippetContribution {
  language: string;
  path: string;
}

interface ExtensionManifest {
  contributes: {
    commands: CommandContribution[];
    configuration: {
      properties: Record<string, unknown>;
    };
    snippets: SnippetContribution[];
  };
}

const manifestPath = path.resolve(__dirname, '../../package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ExtensionManifest;

suite('Snippet manifest', () => {
  test('does not contribute the removed Snippet Library command', () => {
    assert.strictEqual(
      manifest.contributes.commands.some(
        ({ command }) => command === 'shader-studio.openSnippetLibrary',
      ),
      false,
    );
  });

  test('retains bundled GLSL snippets and their enable setting', () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        manifest.contributes.configuration.properties,
        'shader-studio.enableSnippets',
      ),
    );
    assert.deepStrictEqual(manifest.contributes.snippets, [
      { language: 'glsl', path: './snippets/sdf-2d.code-snippets' },
      { language: 'glsl', path: './snippets/sdf-3d.code-snippets' },
      { language: 'glsl', path: './snippets/math.code-snippets' },
      { language: 'glsl', path: './snippets/coordinates.code-snippets' },
    ]);
  });
});
