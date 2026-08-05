import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const extensionReadme = fs.readFileSync(
  path.join(repositoryRoot, 'extension', 'README.md'),
  'utf8'
);
const settingsDoc = fs.readFileSync(
  path.join(repositoryRoot, 'docs', 'help', 'settings.md'),
  'utf8'
);
const troubleshootingDoc = fs.readFileSync(
  path.join(repositoryRoot, 'docs', 'help', 'troubleshooting.md'),
  'utf8'
);

suite('Shader Validator documentation', () => {
  test('documents installation and rendering independence of the optional companion', () => {
    assert.match(extensionReadme, /optional.*Shader Validator|Shader Validator.*Optional/i);
    assert.match(extensionReadme, /antaalt\.shader-validator/);
    assert.match(extensionReadme, /install.*separately/i);
    assert.match(extensionReadme, /uninstalling.*does not affect rendering/i);
  });

  test('documents the generated preamble content and non-destructive setting ownership', () => {
    assert.match(settingsDoc, /\.vscode\/shader-studio-preamble\.glsl/);
    assert.match(settingsDoc, /active GLSL pass/i);
    assert.match(settingsDoc, /stable built-in uniforms/i);
    assert.match(settingsDoc, /configured channels and aliases/i);
    assert.match(settingsDoc, /successfully inferred custom uniforms/i);
    assert.match(settingsDoc, /shader-validator\.glsl\.preamble/);
    assert.match(settingsDoc, /only when you have not already configured the setting/i);
    assert.match(settingsDoc, /existing global, workspace, and folder values remain unchanged/i);
    assert.match(settingsDoc, /one.*workspace folder/i);
  });

  test('documents the workspace-wide active-shader limitation and stale-diagnostics recovery', () => {
    assert.match(troubleshootingDoc, /active shader/i);
    assert.match(troubleshootingDoc, /currently active Shader Studio pass/i);
    assert.match(troubleshootingDoc, /\.vscode\/shader-studio-preamble\.glsl/);
    assert.match(troubleshootingDoc, /Shader Studio output/i);
    assert.match(troubleshootingDoc, /Shader Language Server or Shader Validator Output/i);
    assert.match(troubleshootingDoc, /Restart the companion server/i);
  });
});
