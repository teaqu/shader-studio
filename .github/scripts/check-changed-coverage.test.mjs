import test from 'node:test';
import assert from 'node:assert/strict';
import { changedLines, checkChangedCoverage } from './check-changed-coverage.mjs';
const file = 'rendering/src/existing.ts';
const location = (start, end = start) => ({ start: { line: start, column: 0 }, end: { line: end, column: 10 } });
const data = (hits = 1) => ({ statementMap: { 0: location(2), 1: location(8) }, s: { 0: hits, 1: 0 }, branchMap: { 0: { loc: location(2), locations: [location(2), location(3)] } }, b: { 0: [hits, hits] }, fnMap: { 0: { loc: location(1, 4) } }, f: { 0: hits } });
const run = (coverage = data(), lines = [2], source = 'export const value = 1;') => checkChangedCoverage({ ['/repo/' + file]: coverage }, new Map([[file, new Set(lines)]]), '/repo', () => source);
test('extracts added lines, including replacements, but not deleted lines or context', () => {
  assert.deepEqual([...changedLines('@@ -1,2 +1,3 @@\n-a\n+b\n+c\n d\n@@ -8,2 +9,0 @@\n-x\n-y\n@@ -12 +12 @@\n-z\n+q')], [1, 2, 12]);
});
test('uncovered edits fail even when unchanged code has coverage', () => {
  const result = run(data(0));
  assert.equal(result.files.length, 1);
  assert.equal(result.errors.length, 4);
  assert.match(result.errors.join('\n'), /lines 0.00%/);
});
test('covered edits pass without requiring coverage of unrelated legacy code', () => {
  assert.deepEqual(run().errors, []);
});
test('changed branch paths and enclosing function must be exercised', () => {
  const coverage = data();
  coverage.b[0] = [1, 0];
  coverage.f[0] = 0;
  assert.match(run(coverage).errors.join('\n'), /branches 50.00%/);
  assert.match(run(coverage).errors.join('\n'), /functions 0.00%/);
});
test('missing instrumentation and malformed hit counts fail closed', () => {
  assert.match(run(null).errors.join('\n'), /missing/);
  const coverage = data();
  coverage.s[0] = -1;
  assert.match(run(coverage).errors.join('\n'), /invalid/);
  coverage.b[0] = [1];
  assert.match(run(coverage).errors.join('\n'), /invalid/);
});
test('type-only files and non-executable edits do not demand artificial tests', () => {
  assert.deepEqual(run(data(), [6]).errors, []);
  assert.equal(run(null, [2], 'export interface Value { value: string }').files.length, 0);
});
test('multiple statements on one changed line require every statement to execute', () => {
  const coverage = data();
  coverage.statementMap[1] = location(2);
  const result = run(coverage);
  assert.match(result.errors.join('\n'), /lines 0.00%/);
});
test('CLI gates an existing-file edit across the whole branch, and writes a summary', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = mkdtempSync(join(tmpdir(), 'changed-coverage-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Coverage', '-c', 'user.email=coverage@localhost', 'commit', '-m', 'fixture');
  };
  try {
    git('init', '-q');
    mkdirSync(join(root, 'rendering/src'), { recursive: true });
    writeFileSync(join(root, file), '\nexport const value = 1;\n');
    commit();
    git('tag', 'base');
    writeFileSync(join(root, file), '\nexport const value = 2;\n');
    commit();
    writeFileSync(join(root, 'README.md'), 'unrelated later commit');
    commit();
    mkdirSync(join(root, 'coverage'));
    const report = join(root, 'coverage/coverage-final.json');
    const summary = join(root, 'summary.md');
    const script = fileURLToPath(new URL('./check-changed-coverage.mjs', import.meta.url));
    const runCli = (args = ['base']) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
    writeFileSync(report, '{}');
    assert.match(runCli().stderr, /missing unit coverage/);
    writeFileSync(report, JSON.stringify({ [join(root, file)]: data(0) }));
    assert.equal(runCli().status, 1);
    writeFileSync(report, JSON.stringify({ [join(root, file)]: data() }));
    const passing = runCli();
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(readFileSync(summary, 'utf8'), /Changed-source unit coverage/);
    assert.notEqual(runCli([]).status, 0);
    assert.notEqual(runCli(['missing-base']).status, 0);
    writeFileSync(report, 'broken json');
    assert.notEqual(runCli().status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a type-only export added to a runtime barrel does not need a coverage map', () => {
  const source = "export { Renderer } from './Renderer';\nexport type { RenderingEngine } from './types';";
  assert.deepEqual(run(null, [2], source), { files: [], errors: [] });
});
test('erased declarations are exempt but executable edits still fail closed', () => {
  const source = "export const value = 1;\nimport type { Value } from './types';\ninterface Settings { value: Value }\ntype Options = Settings;";
  assert.deepEqual(run(null, [2, 3, 4], source), { files: [], errors: [] });
  assert.match(run(null, [1, 2], source).errors.join('\n'), /missing unit coverage/);
  assert.match(run(null, [1], "export type { Value } from './types'; export const value = 1;").errors.join('\n'), /missing unit coverage/);
});
test('multiline type exports are exempt while value re-exports require instrumentation', () => {
  assert.deepEqual(run(null, [2, 3], "export const value = 1;\nexport type {\n  Value,\n} from './types';").errors, []);
  assert.match(run(null, [2], "export const value = 1;\nexport { Renderer } from './Renderer';").errors.join('\n'), /missing unit coverage/);
});

test('barrel re-export changes are exempt but runtime statements in a barrel still require maps', () => {
  const barrel = "export * from './StorageLayout';";
  assert.deepEqual(run(null, [1], barrel), { files: [], errors: [] });
  assert.match(run(null, [2], barrel + '\nexport const value = 1;').errors.join('\n'), /missing unit coverage/);
});
