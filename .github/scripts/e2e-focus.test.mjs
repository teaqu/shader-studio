import assert from 'node:assert/strict';
import test from 'node:test';
import { focusCommand } from './e2e-focus.mjs';

const vsix = { SHADER_STUDIO_E2E_VSIX: '/work/shader-studio-1.0.0.vsix' };

test('standalone runs the selected specs, title filter and repeats in one Playwright project', () => {
  assert.deepEqual(focusCommand({ suite: 'standalone', specs: 'web.e2e.mjs, files.e2e.mjs', grep: 'Open Files|tab order', repeat: '3' }), {
    cwd: 'standalone',
    command: 'npx',
    args: ['playwright', 'test', '--config', 'e2e/playwright.config.mjs', '--project=chromium',
      'web.e2e.mjs', 'files.e2e.mjs', '--grep', 'Open Files|tab order', '--repeat-each', '3'],
    env: {},
  });
  assert.deepEqual(focusCommand({ suite: 'standalone', project: 'mobile-chromium' }).args.at(-1), '--project=mobile-chromium');
});

test('VS Code without a GPU skips @gpu specs; the GPU runner keeps every selected spec', () => {
  const linux = focusCommand({ suite: 'vscode', specs: 'local-mcp' }, vsix);
  assert.deepEqual(linux, {
    cwd: 'extension',
    command: 'node',
    args: ['scripts/run-vsix-e2e.mjs', 'local-mcp'],
    env: { ...vsix, SHADER_STUDIO_E2E_WINDOW: '1600x1000', SHADER_STUDIO_E2E_GREP_INVERT: '@gpu' },
  });
  assert.equal(focusCommand({ suite: 'vscode-gpu', grep: 'WGSL debug parity' }, vsix).env.SHADER_STUDIO_E2E_GREP_INVERT, '(?!)');
  assert.throws(() => focusCommand({ suite: 'vscode' }), /SHADER_STUDIO_E2E_VSIX/);
});

test('rendering runs Vitest browser files and names, without Playwright-only repeats', () => {
  assert.deepEqual(focusCommand({ suite: 'rendering', specs: 'PointerInput', grep: 'pointer' }), {
    cwd: 'rendering',
    command: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.browser.config.mts', 'PointerInput', '--testNamePattern', 'pointer'],
    env: {},
  });
  assert.throws(() => focusCommand({ suite: 'rendering', repeat: '2' }), /only supported for Playwright/);
  assert.deepEqual(focusCommand({ suite: 'rendering-corpus', specs: 'corpus' }).args,
    ['vitest', 'run', '--config', 'vitest.corpus.config.mts', 'corpus']);
  assert.deepEqual(focusCommand({ suite: 'ui', grep: 'Export tabs' }), {
    cwd: 'ui',
    command: 'npx',
    args: ['vitest', 'run', '--config', 'vitest.browser.config.mts', '--testNamePattern', 'Export tabs'],
    env: {},
  });
});

test('the extension-host corpus runs its Playwright config against the shader corpus workspace', () => {
  assert.deepEqual(focusCommand({ suite: 'vscode-corpus', specs: 'corpus-scripts', repeat: '2' }), {
    cwd: 'extension',
    command: 'npx',
    args: ['playwright', 'test', '--config', './e2e/pw/playwright.corpus.config.mjs', 'corpus-scripts', '--repeat-each', '2'],
    env: { SHADER_STUDIO_E2E_WORKSPACE: '../tests/fixtures/shader-corpus' },
  });
});

test('rejects unknown suites and inputs that could escape the selected suite', () => {
  assert.throws(() => focusCommand({ suite: 'everything' }), /Unknown suite/);
  assert.throws(() => focusCommand({ suite: 'standalone', specs: '../../secrets' }), /Invalid spec/);
  assert.throws(() => focusCommand({ suite: 'standalone', specs: '-c other.config.mjs' }), /Invalid spec/);
  assert.throws(() => focusCommand({ suite: 'standalone', specs: Array.from({ length: 21 }, (_, i) => `s${i}`).join(' ') }), /at most 20/);
  assert.throws(() => focusCommand({ suite: 'standalone', project: 'chromium --headed' }), /Invalid Playwright project/);
  assert.throws(() => focusCommand({ suite: 'standalone', grep: 'a\nb' }), /single line/);
  assert.throws(() => focusCommand({ suite: 'standalone', grep: '(' }), /Invalid regular expression/);
  for (const repeat of ['0', '21', '1.5', 'x']) {
    assert.throws(() => focusCommand({ suite: 'standalone', repeat }), /repeat must be/);
  }
});

test('blank optional inputs run the whole selected suite once', () => {
  assert.deepEqual(focusCommand({ suite: 'standalone', specs: '', grep: '', repeat: '' }).args,
    ['playwright', 'test', '--config', 'e2e/playwright.config.mjs', '--project=chromium']);
});

test('standalone specs stay positional after the project option, as the Playwright CLI parses them', () => {
  const { args } = focusCommand({ suite: 'standalone', specs: 'files.e2e.mjs vr.e2e.mjs' });
  const project = args.findIndex(arg => arg.startsWith('--project'));
  assert.equal(args[project], '--project=chromium');
  assert.deepEqual(args.slice(project + 1), ['files.e2e.mjs', 'vr.e2e.mjs']);
});
