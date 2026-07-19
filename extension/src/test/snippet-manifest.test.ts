import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SNIPPET_CONTRIBUTIONS } from '../app/SnippetContributions';

interface CommandContribution {
  command: string;
}

interface SnippetContribution {
  language: string;
  path: string;
}

interface ConfigurationProperty {
  description: string;
}

interface ExtensionManifest {
  contributes: {
    commands: CommandContribution[];
    configuration: {
      properties: Record<string, ConfigurationProperty>;
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

  test('retains all bundled snippets and their enable setting', () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        manifest.contributes.configuration.properties,
        'shader-studio.enableSnippets',
      ),
    );
    assert.strictEqual(
      manifest.contributes.configuration.properties[
        'shader-studio.enableSnippets'
      ].description,
      'Enable bundled GLSL and Slang code snippets (requires restart)',
    );
    assert.deepStrictEqual(
      manifest.contributes.snippets,
      SNIPPET_CONTRIBUTIONS,
    );
  });
});
