import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it as test } from 'vitest';
import { loadShaderFixtureCorpus } from './shaderFixtureCorpus.mjs';

test('uses portable project identifiers while retaining native filesystem source paths', () => {
  let repository = process.cwd();
  while (!fs.existsSync(path.join(repository, 'tests/fixtures/shader-corpus'))) {
    const parent = path.dirname(repository);
    assert.notEqual(parent, repository, 'Expected the real shader fixture corpus');
    repository = parent;
  }
  const root = path.join(repository, 'tests/fixtures/shader-corpus');
  const projects = loadShaderFixtureCorpus(root);
  for (const name of ['wgsl/intellisense.wgsl', 'slang/compute-lab/game-of-life.slang']) {
    const project = projects.find(candidate => candidate.name === name);
    assert.ok(project, `Expected corpus identifier ${name}`);
    assert.equal(project.path, path.join(root, ...name.split('/')));
    assert.ok(fs.existsSync(project.path));
  }
  assert.ok(projects.every(project => !project.name.includes('\\')));
});
