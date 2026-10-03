import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const environmentsPath = resolve(root, 'extension/e2e/pw/expected-environments.json');

export function inventory(report) {
  if (report.errors?.length) {
    throw new Error(`Test discovery failed: ${report.errors.map(error => error.message).join('; ')}`);
  }
  const cases = [];
  function visit(node, parents) {
    for (const spec of node.specs ?? []) {
      for (const test of spec.tests ?? []) {
        cases.push({
          id: `${spec.id}:${test.projectName ?? ''}`,
          title: [...parents, spec.title].join(' › '),
          file: spec.file, line: spec.line, project: test.projectName ?? '',
          tags: spec.tags ?? [], expectedStatus: test.expectedStatus,
        });
      }
    }
    for (const child of node.suites ?? []) {
      visit(child, [...parents, child.title]);
    }
  }
  visit(report, []);
  if (!cases.length) {
    throw new Error('Test discovery returned no cases');
  }
  return cases;
}

export function assertPartition(all, selections) {
  const expected = new Set(all.map(test => test.id));
  const found = selections.flat().map(test => test.id);
  const selected = new Set(found);
  if (expected.size !== all.length || selected.size !== found.length
    || selected.size !== expected.size || [...expected].some(id => !selected.has(id))) {
    throw new Error('GPU/non-GPU discovery must partition every intended test exactly once');
  }
}

export function assertExpectedEnvironments(cases, expected) {
  const byId = new Map(cases.map(test => [test.id, test]));
  if (byId.size !== expected.length || new Set(expected.map(test => test.id)).size !== expected.length) {
    throw new Error('Test inventory changed; review and refresh the expected environment manifest');
  }
  for (const entry of expected) {
    const actual = byId.get(entry.id);
    const environment = actual?.tags.includes('gpu') ? 'gpu' : 'non-gpu';
    if (!actual || actual.title !== entry.title || environment !== entry.environment) {
      throw new Error(`Expected ${entry.environment} contract is missing or moved: ${entry.title}`);
    }
  }
}

export function discover(config, selectors = {}, run = execFileSync) {
  const env = { ...process.env };
  delete env.SHADER_STUDIO_E2E_GREP;
  delete env.SHADER_STUDIO_E2E_GREP_INVERT;
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const report = run(process.execPath, [resolve(root, 'node_modules/playwright/cli.js'),
    'test', '--config', config, '--list', '--reporter=json'], {
    cwd: root, env: { ...env, ...selectors }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  return inventory(JSON.parse(report));
}

export function collect({ refreshEnvironments = false } = {}) {
  const config = 'extension/e2e/pw/playwright.config.mjs';
  const extension = discover(config);
  const gpu = discover(config, { SHADER_STUDIO_E2E_GREP: '@gpu', SHADER_STUDIO_E2E_GREP_INVERT: '(?!)' });
  const nonGpu = discover(config, { SHADER_STUDIO_E2E_GREP_INVERT: '@gpu' });
  assertPartition(extension, [gpu, nonGpu]);
  const expected = extension.map(test => ({
    id: test.id, title: test.title, environment: test.tags.includes('gpu') ? 'gpu' : 'non-gpu',
  }));
  if (refreshEnvironments) {
    writeFileSync(environmentsPath, `${JSON.stringify(expected, null, 2)}\n`);
  } else {
    assertExpectedEnvironments(extension, JSON.parse(readFileSync(environmentsPath, 'utf8')));
  }
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    extension, gpu, nonGpu,
    corpus: discover('extension/e2e/pw/playwright.corpus.config.mjs'),
    standalone: discover('standalone/e2e/playwright.config.mjs'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) {
    throw new Error('Usage: node .github/scripts/e2e-inventory.mjs OUTPUT.json (build workspace dependencies first)');
  }
  const data = collect({ refreshEnvironments: process.argv[3] === '--refresh-environments' });
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Verified discovery: ${data.extension.length} extension (${data.gpu.length} GPU + ${data.nonGpu.length} non-GPU), ${data.corpus.length} corpus, ${data.standalone.length} standalone cases`);
}
