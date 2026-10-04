import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import istanbul from '@vitest/coverage-istanbul';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { instrumentBarrelEntries } from './module-entry-coverage.mjs';

const require = createRequire(import.meta.url);

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'shader-studio-module-entry-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    rmSync(directory, { recursive: true });
  });
  const id = join(directory, 'barrel.ts');
  const source = "export * from './dependency.cjs';\n";
  writeFileSync(id, source);
  writeFileSync(join(directory, 'dependency.cjs'), 'exports.value = 42;\n');
  const sourceMap = { version: 3, names: [], sources: [id], sourcesContent: [source], mappings: 'AAAA' };
  const result = instrumentBarrelEntries(source, id, sourceMap);
  const provider = await istanbul.getProvider();
  await provider.initialize({
    version: provider.version,
    _coverageOptions: { include: ['**/*.ts'], reporter: [] },
    config: { root: directory.replaceAll('\\', '/') }, logger: { warn() {} },
  });
  const instrumented = provider.onFileTransform(result.code, id, { getCombinedSourcemap: () => result.map });
  const initial = provider.instrumenter.lastFileCoverage();
  const executable = ts.transpileModule(instrumented.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const modulePath = join(directory, 'barrel.cjs');
  writeFileSync(modulePath, executable);
  return { id, initial, result, importModule: () => require(modulePath) };
}

test('counts actual evaluation of a re-export-only module', async (t) => {
  const { id, initial, result, importModule } = await fixture(t);
  assert.equal(importModule().value, 42);
  assert.equal(Object.keys(initial.s).length, 1, 'a real module-entry statement is measurable');
  assert.deepEqual(Object.values(globalThis.__VITEST_COVERAGE__[id].s), [1]);
  assert.deepEqual(originalPositionFor(new TraceMap(result.map), { line: 1, column: 0 }), {
    source: id, line: 1, column: 0, name: null,
  });
});

test('leaves an unimported re-export module uncovered', async (t) => {
  const { initial } = await fixture(t);
  assert.equal(Object.keys(initial.s).length, 1, 'unimported boundaries remain in the denominator');
  assert.deepEqual(Object.values(initial.s), [0]);
});

test('preserves type-only and executable modules', () => {
  for (const source of ["export type { Value } from './types';", "export { type Value } from './types';", 'export const value = 42;', 'export {};', "import './side-effect';"]) {
    const map = { version: 3, names: [], sources: ['module.ts'], sourcesContent: [source], mappings: 'AAAA' };
    assert.deepEqual(instrumentBarrelEntries(source, 'module.ts', map), { code: source, map });
  }
});

test('preserves generated code positions after recording multiple re-export entries', () => {
  const source = "export type { Value } from './types';\nexport * from './one';\nexport { result } from './two';\n";
  const code = "export * from './one';\nexport { result } from './two';\n";
  const map = { version: 3, names: [], sources: ['module.ts'], sourcesContent: [source], mappings: 'AACA;AACA' };
  const result = instrumentBarrelEntries(code, 'module.ts', map);
  assert.equal(result.code, 'void 0;\nvoid 0;\n' + code);
  const before = new TraceMap(map);
  const after = new TraceMap(result.map);
  for (const line of [1, 2]) {
    assert.deepEqual(originalPositionFor(after, { line: line + 2, column: 0 }), originalPositionFor(before, { line, column: 0 }));
  }
  assert.equal(originalPositionFor(after, { line: 1, column: 0 }).line, 2);
  assert.equal(originalPositionFor(after, { line: 2, column: 0 }).line, 3);
});

test('leaves non-TypeScript modules and missing maps untouched', () => {
  const source = "export * from './dependency';";
  const map = { version: 3, names: [], sources: ['module.js'], sourcesContent: [source], mappings: 'AAAA' };
  assert.deepEqual(instrumentBarrelEntries(source, 'module.js', map), { code: source, map });
  assert.deepEqual(instrumentBarrelEntries(source, 'module.ts', undefined), { code: source, map: undefined });
});
