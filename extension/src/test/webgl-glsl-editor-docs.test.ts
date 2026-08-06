import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const read = (...parts: string[]) => fs.readFileSync(path.join(repositoryRoot, ...parts), 'utf8');

suite('WebGL GLSL Editor documentation', () => {
  test('documents the optional companion and managed injection settings', () => {
    const readme = read('extension', 'README.md');
    const settings = read('docs', 'help', 'settings.md');

    assert.match(readme, /raczzalan\.webgl-glsl-editor/);
    assert.match(readme, /optional/i);
    assert.match(readme, /disable Shader Validator/i);
    assert.match(settings, /webgl-glsl-editor\.codeInjection/);
    assert.match(settings, /webgl-glsl-editor\.codeInjectionSource/);
    assert.match(settings, /webglGlslEditorIntegration/);
    assert.match(settings, /replaces any existing injection configuration/i);
  });

  test('keeps the companion integration opt-in and warns that it takes ownership', () => {
    const manifest = JSON.parse(read('extension', 'package.json')) as {
      contributes: { configuration: { properties: Record<string, { default: boolean; description: string }> } };
    };
    const setting = manifest.contributes.configuration.properties['shader-studio.webglGlslEditorIntegration'];

    assert.strictEqual(setting.default, false);
    assert.match(setting.description, /WebGL GLSL Editor extension/i);
    assert.match(setting.description, /overwrite/i);
  });
});
