import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FULL_RUN_LABEL,
  AUDIT_INTERVAL,
  decide,
  formatSummary,
  selectedJobs,
  selectionOutputs,
  suiteOutput,
  suites,
  taskNames,
  turboAffected,
} from './select-e2e.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const turbo = path.join(root, 'node_modules/turbo/bin/turbo');

const item = (fullName, typename = 'TaskFileChanged') => ({
  name: fullName.split('#')[1],
  fullName,
  reason: { __typename: typename },
});
const unreachable = () => assert.fail('Turbo should not be queried');

for (const eventName of ['push', 'workflow_dispatch', 'schedule', '']) {
  test(`${eventName || 'an unknown'} event selects everything without querying Turbo`, () => {
    const decision = decide({ eventName, labels: [], queryAffected: unreachable });
    assert.equal(decision.full, true);
    assert.equal(decision.reason, `${eventName || 'unknown'} events verify everything`);
  });
}

test(`the ${FULL_RUN_LABEL} label selects everything`, () => {
  const decision = decide({ eventName: 'pull_request', labels: ['bug', FULL_RUN_LABEL], queryAffected: unreachable });
  assert.equal(decision.full, true);
  assert.equal(decision.reason, `the pull request is labelled ${FULL_RUN_LABEL}`);
});

test('a failed Turbo query selects everything', () => {
  const decision = decide({
    eventName: 'pull_request',
    labels: [],
    queryAffected: () => {
      throw new Error('bad revision');
    },
  });
  assert.equal(decision.full, true);
  assert.equal(decision.reason, 'Turbo could not compare the change: bad revision');
});

test('every tenth workflow run audits every PR suite without querying Turbo', () => {
  const decision = decide({ eventName: 'pull_request', labels: [], runNumber: AUDIT_INTERVAL * 2, queryAffected: unreachable });
  assert.equal(decision.full, true);
  assert.match(decision.reason, /periodic full audit/);
  assert.equal(selectionOutputs(decision).allowed_skips, '');
});

test('ordinary runs and invalid run numbers do not accidentally trigger audits', () => {
  for (const runNumber of [1, 9, 11, 0, -10, NaN, undefined, 10.5]) {
    assert.equal(decide({ eventName: 'pull_request', labels: [], runNumber, queryAffected: () => [] }).full, false);
  }
});

test('malformed Turbo responses fail open to full verification', () => {
  for (const response of [null, {}, [null], [{ fullName: 'task' }]]) {
    const decision = decide({ eventName: 'pull_request', labels: [], queryAffected: () => response });
    assert.equal(decision.full, true);
    assert.equal(selectionOutputs(decision).allowed_skips, '');
  }
});

test('suite outputs narrow individual steps within a selected job', () => {
  const outputs = selectionOutputs(decide({ eventName: 'pull_request', labels: [], queryAffected: () => [item('shader-studio-ui#test:e2e')] }));
  assert.equal(outputs.rendering_e2e, true);
  assert.equal(outputs[suiteOutput(suites[0])], false);
  assert.equal(outputs[suiteOutput(suites[1])], false);
  assert.equal(outputs[suiteOutput(suites[2])], true);
  assert.equal(outputs.allowed_skips, 'standalone-e2e,vscode-e2e,vscode-e2e-linux');
});

test('suite output names are unique and every job is allowed to skip only when no suite is selected', () => {
  assert.equal(new Set(suites.map(suiteOutput)).size, suites.length);
  for (const affected of [[], ...suites.map(suite => [item(suite.task)])]) {
    const decision = decide({ eventName: 'pull_request', labels: [], queryAffected: () => affected });
    const outputs = selectionOutputs(decision);
    const skipped = outputs.allowed_skips.split(',').filter(Boolean);
    for (const [job, selected] of Object.entries(selectedJobs(decision))) {
      assert.equal(skipped.includes(job), !selected);
      assert.equal(selected, suites.filter(suite => suite.job === job).some(suite => outputs[suiteOutput(suite)]));
    }
  }
});

test('CLI publishes full selection and summary for pushes, explicit overrides and periodic audits', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'select-e2e-outputs-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  for (const [eventName, labels, runNumber] of [['push', [], 1], ['pull_request', [FULL_RUN_LABEL], 1], ['pull_request', [], 10]]) {
    const eventFile = path.join(temp, 'event.json');
    const outputFile = path.join(temp, 'outputs');
    const summaryFile = path.join(temp, 'summary');
    fs.writeFileSync(eventFile, JSON.stringify({ pull_request: { labels: labels.map(name => ({ name })) } }));
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(summaryFile, '');
    execFileSync(process.execPath, [path.join(root, '.github/scripts/select-e2e.mjs')], {
      cwd: root,
      env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventFile, GITHUB_RUN_NUMBER: String(runNumber), GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile },
    });
    const outputs = Object.fromEntries(fs.readFileSync(outputFile, 'utf8').trimEnd().split('\n').map(line => line.split('=')));
    const expected = Object.fromEntries(Object.entries(selectionOutputs(decide({ eventName: 'push', labels: [], queryAffected: unreachable }))).map(([key, value]) => [key, String(value)]));
    assert.deepEqual(outputs, expected);
    assert.match(fs.readFileSync(summaryFile, 'utf8'), /Every suite selected/);
  }
});

test('a pull request selects the jobs of the affected tasks', () => {
  const decision = decide({
    eventName: 'pull_request',
    labels: [],
    queryAffected: () => [item('shader-studio-ui#test:e2e'), item('some-other#test:e2e')],
  });
  assert.equal(decision.full, false);
  assert.deepEqual(selectedJobs(decision), {
    'rendering-e2e': true,
    'standalone-e2e': false,
    'vscode-e2e': false,
    'vscode-e2e-linux': false,
  });
});

test('the installed-VSIX task selects both the GPU and the no-GPU job', () => {
  const decision = decide({
    eventName: 'pull_request',
    labels: [],
    queryAffected: () => [item('shader-studio#test:e2e:vsix')],
  });
  assert.deepEqual(selectedJobs(decision), {
    'rendering-e2e': false,
    'standalone-e2e': false,
    'vscode-e2e': true,
    'vscode-e2e-linux': true,
  });
});

test('a pull request that affects nothing selects no E2E job', () => {
  const decision = decide({ eventName: 'pull_request', labels: [], queryAffected: () => [] });
  assert.ok(Object.values(selectedJobs(decision)).every(selected => !selected));
});

test('a full selection selects every job', () => {
  const decision = decide({ eventName: 'push', labels: [], queryAffected: unreachable });
  assert.ok(Object.values(selectedJobs(decision)).every(Boolean));
});

test('formatSummary explains each decision', () => {
  const narrowed = formatSummary(decide({
    eventName: 'pull_request',
    labels: [],
    queryAffected: () => [item('@shader-studio/standalone#test:e2e', 'TaskDependencyTaskChanged')],
  }));
  assert.match(narrowed, /Only selected suites run/);
  assert.match(narrowed, /\| standalone-e2e \| Run all standalone browser projects \| `@shader-studio\/standalone#test:e2e` \| yes \(TaskDependencyTaskChanged\) \|/);
  assert.match(narrowed, /\| vscode-e2e-linux \| Run installed-VSIX E2E tests \| `shader-studio#test:e2e:vsix` \| no \|/);
  assert.doesNotMatch(narrowed, /Every suite selected/);

  const full = formatSummary(decide({ eventName: 'push', labels: [], queryAffected: unreachable }));
  assert.match(full, /Every suite selected: push events verify everything\./);
  assert.match(full, /\| `shader-studio#test:e2e:vsix` \| yes \|/);
});

test('turboAffected compares HEAD with its first parent', () => {
  const calls = [];
  const items = turboAffected((command, args) => {
    calls.push([command, ...args]);
    if (command === 'git') {
      return 'merge base-sha head-sha\n';
    }
    return JSON.stringify({ data: { affectedTasks: { items: [item('shader-studio-ui#test:e2e')] } } });
  });
  assert.deepEqual(items, [item('shader-studio-ui#test:e2e')]);
  assert.deepEqual(calls[1], [
    'npx', '--no-install', 'turbo', 'query', 'affected', '--tasks', ...taskNames, '--base', 'base-sha', '--head', 'HEAD',
  ]);
});

test('turboAffected refuses a commit that is not a merge', () => {
  assert.throws(
    () => turboAffected(() => 'only-sha parent-sha\n'),
    /HEAD is not a pull-request merge commit \(1 parents\)/,
  );
});

test('turboAffected surfaces Turbo query errors', () => {
  assert.throws(
    () => turboAffected(command => (command === 'git'
      ? 'merge a b\n'
      : JSON.stringify({ data: null, errors: [{ message: 'unknown ref' }] }))),
    /unknown ref/,
  );
});

const workflow = fs.readFileSync(path.join(root, '.github/workflows/verify.yml'), 'utf8');

/** Splits verify.yml into its jobs, keyed by job id. */
function workflowJobs(source = workflow) {
  source = source.replace(/\r\n/g, '\n');
  const jobs = {};
  let current;
  for (const line of source.slice(source.indexOf('\njobs:')).split('\n')) {
    const header = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs[current] = '';
    } else if (current) {
      jobs[current] += `${line}\n`;
    }
  }
  return jobs;
}
const jobs = workflowJobs();

test('workflow parsing produces identical job steps for LF and CRLF', () => {
  const source = 'name: Verify\njobs:\n  build:\n    steps:\n      - name: Build\n        run: npm run build\n';
  assert.deepEqual(workflowJobs(source.replaceAll('\n', '\r\n')), workflowJobs(source));
  assert.deepEqual(Object.keys(workflowJobs(source)), ['build']);
});

test('every suite names a step of its job in verify.yml', () => {
  for (const suite of suites) {
    assert.ok(jobs[suite.job]?.includes(`- name: ${suite.step}\n`), `${suite.job} has no step named ${suite.step}`);
  }
});

test('every E2E step in verify.yml is a suite', () => {
  const mapped = new Set(suites.map(suite => `${suite.job}: ${suite.step}`));
  const steps = Object.entries(jobs).flatMap(([job, body]) => (
    [...body.matchAll(/- name: (.+)\n(?:(?! {6}- ).*\n)*? {8}run: .*test:e2e/g)].map(match => `${job}: ${match[1]}`)
  ));
  assert.ok(steps.length >= suites.length);
  assert.deepEqual(steps.filter(step => !mapped.has(step)), []);
});

test('every suite task is a package script and a Turbo task', () => {
  const rootTurbo = readJson('turbo.json');
  const packages = { 'shader-studio': 'extension', 'shader-studio-ui': 'ui' };
  for (const suite of suites) {
    const [name, task] = suite.task.split('#');
    const dir = packages[name] ?? name.replace('@shader-studio/', '');
    assert.ok(readJson(`${dir}/package.json`).scripts[task], `${dir} has no ${task} script`);
    assert.equal(readJson(`${dir}/package.json`).name, name);
    assert.ok(rootTurbo.tasks[task], `turbo.json does not define ${task}`);
  }
});

test('the verdict job waits for every job, even after failures', () => {
  const needs = /needs: \[([^\]]+)\]/.exec(jobs.result)[1].split(',').map(job => job.trim());
  assert.deepEqual(needs.sort(), Object.keys(jobs).filter(job => job !== 'result').sort());
  assert.match(jobs.result, /if: \$\{\{ always\(\) \}\}/);
  assert.match(jobs.result, /re-actors\/alls-green@[0-9a-f]{40}/);
  assert.match(jobs.result, /jobs: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(jobs.result, /allowed-skips: \$\{\{ needs.select.result == 'success' && needs.select.outputs.allowed_skips \|\| '' \}\}/);
  for (const [job, body] of Object.entries(jobs)) {
    if (['select', 'package', 'test'].includes(job)) {
      assert.doesNotMatch(body, /^ {4}if:/m, `${job} is conditional`);
    }
  }
});

test('every E2E job and suite uses its published selection output', () => {
  assert.match(jobs.select, /id: selection/);
  for (const suite of suites) {
    const jobKey = suite.job.replaceAll('-', '_');
    const key = suiteOutput(suite);
    assert.ok(jobs.select.includes(`${jobKey}: \u0024{{ steps.selection.outputs.${jobKey} }}`));
    assert.ok(jobs.select.includes(`${key}: \u0024{{ steps.selection.outputs.${key} }}`));
    assert.ok(jobs[suite.job].includes(`if: \u0024{{ needs.select.outputs.${jobKey} == 'true' }}`));
    assert.ok(jobs[suite.job].includes(`- name: ${suite.step}\n        if: \u0024{{ needs.select.outputs.${key} == 'true' }}`));
    assert.match(jobs[suite.job], /needs: (?:select|\[select, package\])/);
  }
});

test('ci:full label changes retrigger the caller workflow', () => {
  const caller = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
  assert.match(caller, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
});

/**
 * Root paths Turbo does not need to see because no build or E2E suite reads
 * them. Everything else at the top level must be a workspace, a global
 * dependency or an input of some task, or a change to it would go unnoticed.
 */
const notInputs = new Set([
  '.githooks', '.gitignore', '.vscode', 'AGENTS.md', 'CLAUDE.md', 'LICENSE', 'README.md',
  'THIRD-PARTY-NOTICES.md', 'assets', 'docs', 'mkdocs.yml',
  // Browser-only design references are not consumed by a build or test suite.
  'mockups', 'wireframes',
  // Static dead-code policy is always checked in CI; it does not change an E2E runtime.
  'knip.jsonc',
]);

test('every top-level path is a workspace, a Turbo input or explicitly not one', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const rootTurbo = readJson('turbo.json');
  const workspaces = readJson('package.json').workspaces.map(entry => entry.split('/')[0]);
  const turboFiles = tracked.filter(file => file.endsWith('turbo.json'));
  const rootInputs = turboFiles.flatMap(file => (
    [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/\$TURBO_ROOT\$\/([^/"]+)/g)].map(match => match[1])
  ));
  const covered = path => workspaces.includes(path)
    || rootInputs.includes(path)
    || notInputs.has(path)
    || rootTurbo.globalDependencies.some(glob => glob === path || glob.startsWith(`${path}/`));
  const uncovered = [...new Set(tracked.map(file => file.split('/')[0]))].filter(entry => !covered(entry));
  assert.deepEqual(uncovered, []);
});

/**
 * Runs the real Turbo against a throwaway clone: each case commits one
 * change and asks which suite tasks it affects.
 */
test('Turbo selects the expected suites for representative changes', { timeout: 300_000 }, t => {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'select-e2e-'));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  const git = (...args) => execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: clone, encoding: 'utf8' },
  );
  execFileSync('git', ['clone', '--quiet', '--shared', root, clone]);
  // Test the working tree's configuration, not only what is committed.
  for (const file of execFileSync('git', ['ls-files', '--modified', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
    fs.mkdirSync(path.dirname(path.join(clone, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(clone, file));
  }
  git('add', '-A');
  git('commit', '--quiet', '--allow-empty', '-m', 'working tree');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(clone, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

  const affected = file => {
    fs.appendFileSync(path.join(clone, file), '\n');
    git('commit', '--quiet', '-am', `touch ${file}`);
    const output = execFileSync(process.execPath, [turbo, 'query', 'affected', '--tasks', ...taskNames, '--base', 'HEAD~1', '--head', 'HEAD'], {
      cwd: clone,
      encoding: 'utf8',
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    });
    git('reset', '--quiet', '--hard', 'HEAD~1');
    return JSON.parse(output).data.affectedTasks.items.map(entry => entry.fullName).sort();
  };

  const rendering = ['@shader-studio/rendering#test:e2e', '@shader-studio/rendering#test:e2e:corpus'];
  const uiCorpus = ['shader-studio-ui#test:e2e'];
  const standalone = ['@shader-studio/standalone#test:e2e'];
  const vscode = ['shader-studio#test:e2e:vscode:corpus', 'shader-studio#test:e2e:vsix'];
  const all = [...rendering, ...uiCorpus, ...standalone, ...vscode];
  const cases = [
    // Host-only source.
    ['standalone/src/App.svelte', [...uiCorpus, ...standalone]],
    ['extension/src/extension.ts', vscode],
    // Shared source reaches every consumer, including bundled webviews.
    ['ui/src/lib/ConfigManager.ts', [...uiCorpus, ...standalone, ...vscode]],
    ['shader-explorer/src/App.svelte', [...uiCorpus, ...standalone, ...vscode]],
    ['language-servers/wgsl/src/WgslLanguageService.ts', [...uiCorpus, ...standalone, ...vscode]],
    ['types/src/index.ts', all],
    // Inputs that live outside the packages that read them.
    ['vendor/pilibs/src/piRenderer.js', all],
    ['ui/src/slang/slang-wasm.js', all],
    ['tests/fixtures/shader-corpus/README.md', [...rendering, ...uiCorpus, 'shader-studio#test:e2e:vscode:corpus']],
    ['rendering/src/test/e2e/ShaderCanvasHarness.ts', [...rendering, ...uiCorpus]],
    // Test-only changes select only their own suites.
    ['standalone/e2e/web.e2e.mjs', standalone],
    ['standalone/e2e/ports.test.mjs', []],
    ['extension/src/test/app/ShaderStudio.test.ts', []],
    ['ui/src/test/components/ShaderViewer.test.ts', []],
    ['types/src/shader-environment/SlangEnvironmentGenerator.compiler.test.ts', []],
    // Global dependencies select everything; documentation nothing.
    ['.github/workflows/verify.yml', all],
    ['vite.aliases.mjs', all],
    ['docs/index.md', []],
  ];
  for (const [file, expected] of cases) {
    assert.deepEqual(affected(file), [...expected].sort(), file);
  }
});
