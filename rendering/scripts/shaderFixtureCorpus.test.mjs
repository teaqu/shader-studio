import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadShaderFixtureSources } from './shaderFixtureCorpus.mjs';

test('raw inventory includes auxiliary sources, filters extensions and sorts paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-corpus-inventory-'));
  try {
    fs.mkdirSync(path.join(root, 'passes'));
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'z.wgsl'), 'root');
    fs.writeFileSync(path.join(root, 'passes', 'a.wgsl'), 'auxiliary');
    fs.writeFileSync(path.join(root, 'z.sha.json'), '{}');
    fs.writeFileSync(path.join(root, 'other.glsl'), 'GLSL');
    fs.writeFileSync(path.join(root, '.git', 'ignored.wgsl'), 'ignored');
    assert.deepEqual(loadShaderFixtureSources(root, '.wgsl'), [
      { name: path.join('passes', 'a.wgsl'), source: 'auxiliary' },
      { name: 'z.wgsl', source: 'root' },
    ]);
    assert.deepEqual(loadShaderFixtureSources(root, '.slang'), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing corpus fails explicitly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-shader-corpus-'));
  fs.rmSync(root, { recursive: true });
  assert.throws(() => loadShaderFixtureSources(root, '.wgsl'), /Shader fixture corpus not found/);
});
