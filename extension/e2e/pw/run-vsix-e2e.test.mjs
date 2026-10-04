import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../../scripts/run-vsix-e2e.mjs', import.meta.url));

// Exercise the real entry point and archive verifier while replacing the two
// external commands. Neither packaging nor launching VS Code belongs in this
// regression for caller argument forwarding.
function invoke(selectors, grepInvert) {
  const root = mkdtempSync(join(tmpdir(), 'ss-vsix-argv-'));
  try {
    const extension = join(root, 'fixture', 'extension');
    mkdirSync(join(extension, 'dist'), { recursive: true });
    writeFileSync(join(extension, 'dist', 'extension.js'), '// bundle\n'.repeat(20000));
    // A valid module with a custom section larger than the packaging floor.
    const payload = Buffer.concat([Buffer.from([1, 97]), Buffer.alloc(1048576)]);
    let size = payload.length;
    const length = [];
    do {
      const byte = size & 127;
      size >>>= 7;
      length.push(size ? byte | 128 : byte);
    } while (size);
    writeFileSync(join(extension, 'dist', 'esbuild.wasm'), Buffer.concat([
      Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0]), Buffer.from(length), payload,
    ]));
    const vsix = join(root, 'fixture.vsix');
    writeFileSync(vsix, 'archive extraction is supplied by the command double');
    const calls = join(root, 'calls.json');
    const preload = join(root, 'commands.cjs');
    writeFileSync(preload, `
const child = require('node:child_process');
const fs = require('node:fs');
child.execFileSync = (command, args, options) => {
  if (command === 'unzip') {
    fs.cpSync(${JSON.stringify(join(root, 'fixture'))}, args[args.indexOf('-d') + 1], { recursive: true });
    return '';
  }
  if (command !== 'npx') throw new Error('unexpected command: ' + command);
  fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, env: { SHADER_STUDIO_E2E_GREP_INVERT: options.env.SHADER_STUDIO_E2E_GREP_INVERT } }));
  return '';
};
require('node:module').syncBuiltinESMExports();
`);
    const env = { ...process.env, SHADER_STUDIO_E2E_VSIX: vsix };
    delete env.SHADER_STUDIO_E2E_GREP_INVERT;
    if (grepInvert !== undefined) {
      env.SHADER_STUDIO_E2E_GREP_INVERT = grepInvert;
    }
    const result = spawnSync(process.execPath, ['--require', preload, script, ...selectors], {
      env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(calls, 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('installed wrapper forwards caller file selectors and flags to Playwright', () => {
  const selectors = ['e2e/pw/wgsl-script-uniform-debug.e2e.mjs', 'e2e/pw/script-context.e2e.mjs', '--grep', 'script-driven WGSL'];
  const call = invoke(selectors, '(?!)');
  assert.deepEqual(call.args, ['playwright', 'test', '--config', './e2e/pw/playwright.config.mjs', ...selectors]);
  assert.equal(call.env.SHADER_STUDIO_E2E_GREP_INVERT, '(?!)');
});

test('installed wrapper without selectors preserves the default CI invocation', () => {
  const call = invoke([]);
  assert.deepEqual(call.args, ['playwright', 'test', '--config', './e2e/pw/playwright.config.mjs']);
  assert.equal(call.env.SHADER_STUDIO_E2E_GREP_INVERT, '@gpu');
});
