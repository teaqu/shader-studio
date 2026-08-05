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
  test('documents the optional companion, preamble setting, and diagnostics guidance', () => {
    assert.match(extensionReadme, /Shader Validator/i);
    assert.match(extensionReadme, /optional/i);
    assert.match(settingsDoc, /shader-validator\.glsl\.preamble/);
    assert.match(settingsDoc, /\.vscode\/shader-studio-preamble\.glsl/);
    assert.match(settingsDoc, /existing.*unchanged/i);
    assert.match(settingsDoc, /active shader.*\.sha\.json.*pass inputs/i);
    assert.match(settingsDoc, /already-evaluated custom uniforms/i);
    assert.match(settingsDoc, /invalid.*retain.*last-valid shader-specific preamble/i);
    assert.match(settingsDoc, /before any valid update.*stable shader-local Image fallback/i);
    assert.match(troubleshootingDoc, /active shader/i);
    assert.match(troubleshootingDoc, /Shader Language Server|Shader Validator.*Output/i);
    assert.match(troubleshootingDoc, /focus or select.*intended active shader/i);
    assert.match(
      troubleshootingDoc,
      /existing.*shader-validator\.glsl\.preamble.*intentionally preserved/i
    );
    assert.match(troubleshootingDoc, /remove or change.*yourself/i);
  });
});
