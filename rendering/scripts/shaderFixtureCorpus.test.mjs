import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadShaderFixtureCorpus, loadShaderFixtureSources } from './shaderFixtureCorpus.mjs';

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

test('WGSL projects retain original paths for configured and vertex sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-corpus-wgsl-paths-'));
  try {
    fs.mkdirSync(path.join(root, 'passes'));
    fs.writeFileSync(path.join(root, 'image.wgsl'), 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.0); }');
    fs.writeFileSync(path.join(root, 'passes', 'buffer.wgsl'), 'fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.0); }');
    fs.writeFileSync(path.join(root, 'image.vert.wgsl'), 'fn mainVertex() {}');
    fs.writeFileSync(path.join(root, 'image.sha.json'), JSON.stringify({ version: '1', passes: {
      Image: { vertex: 'image.vert.wgsl' }, BufferA: { path: 'passes/buffer.wgsl' },
    } }));
    const [project] = loadShaderFixtureCorpus(root);
    assert.equal(project.slangSourcePath, path.join(root, 'image.wgsl'));
    assert.deepEqual(project.slangSourcePaths, {
      BufferA: path.join(root, 'passes', 'buffer.wgsl'),
      '__shader_studio_vertex__:Image': path.join(root, 'image.vert.wgsl'),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gravity simulation serializes a local force snapshot without barriers', () => {
  const corpusRoot = fileURLToPath(new URL('../../tests/fixtures/shader-corpus/', import.meta.url));
  for (const language of ['wgsl', 'slang']) {
    const extension = language === 'wgsl' ? 'wgsl' : 'slang';
    const source = fs.readFileSync(path.join(corpusRoot, language, 'gravity', `sim.${extension}`), 'utf8');
    const config = JSON.parse(fs.readFileSync(path.join(corpusRoot, language, 'gravity', 'gravity.sha.json'), 'utf8'));

    assert.equal(config.passes.ComputeSim.entryPoint, 'simulateBodies');
    assert.equal(config.passes.ComputeSim.dispatchCount, 4);
    assert.match(source, /if \(id\.x != 0u?\) \{ return; \}/);
    assert.match(source, /(?:var\s+)?Body forceSources\[32\]|var forceSources: array<Body, 32>/);
    assert.match(source, /forceSources\[source\]\s*=\s*bodies\[source\]/);
    assert.match(source, /gravityForce\(current, forceSources\[j\]\)/);
    assert.match(source, /bodies\[body\]\s*=\s*current/);
    assert.doesNotMatch(source, /(?:workgroupBarrier|GroupMemoryBarrierWithGroupSync|groupshared|var<workgroup>)/);
  }
});
