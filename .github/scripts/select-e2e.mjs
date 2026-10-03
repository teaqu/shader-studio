// Maps the E2E tasks Turbo reports as affected by a pull request to the
// Verify workflow steps that run them. Turbo owns the dependency graph: each
// suite is a task whose `inputs` and `dependsOn` in the turbo.json files say
// what it reads. This script only applies the CI policy around it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Turbo task → the verify.yml job and step that run it. */
export const suites = [
  { task: '@shader-studio/rendering#test:e2e', job: 'rendering-e2e', step: 'Run rendering browser E2E tests' },
  { task: '@shader-studio/rendering#test:e2e:corpus', job: 'rendering-e2e', step: 'Run shader fixture corpus E2E tests' },
  { task: 'shader-studio-ui#test:e2e', job: 'rendering-e2e', step: 'Run UI transport corpus E2E tests' },
  { task: '@shader-studio/standalone#test:e2e', job: 'standalone-e2e', step: 'Run all standalone browser projects' },
  { task: 'shader-studio#test:e2e:vscode:corpus', job: 'vscode-e2e', step: 'Run extension-host corpus E2E tests' },
  { task: 'shader-studio#test:e2e:vsix', job: 'vscode-e2e', step: 'Run installed-VSIX E2E tests' },
  { task: 'shader-studio#test:e2e:vsix', job: 'vscode-e2e-linux', step: 'Run installed-VSIX E2E tests' },
  { task: 'shader-studio#test:e2e:vscode:cleanup:live', job: 'cleanup-e2e', step: 'Validate controlled live Electron cleanup' },
];

export const taskNames = [...new Set(suites.map(suite => suite.task.split('#')[1]))];

/** A pull request carrying this label verifies everything. */
export const FULL_RUN_LABEL = 'ci:full';

const everything = reason => ({ full: true, reason, affected: new Map() });

/**
 * Decides which suites run. Only pull requests are narrowed, and only when
 * Turbo can compare the merge commit with the base it was merged onto.
 *
 * @param {() => { name: string, fullName: string, reason: { __typename: string } }[]} queryAffected
 */
export function decide({ eventName, labels, queryAffected }) {
  if (eventName !== 'pull_request') {
    return everything(`${eventName || 'unknown'} events verify everything`);
  }
  if (labels.includes(FULL_RUN_LABEL)) {
    return everything(`the pull request is labelled ${FULL_RUN_LABEL}`);
  }
  let items;
  try {
    items = queryAffected();
  } catch (error) {
    return everything(`Turbo could not compare the change: ${error.message}`);
  }
  return {
    full: false,
    reason: '',
    affected: new Map(items.map(item => [item.fullName, item.reason.__typename])),
  };
}

/** Per-job selection: a job runs when any of its steps does. */
export function selectedJobs(decision) {
  const jobs = {};
  for (const suite of suites) {
    jobs[suite.job] = (jobs[suite.job] ?? false) || decision.full || decision.affected.has(suite.task);
  }
  return jobs;
}

export function formatSummary(decision) {
  const lines = ['## E2E selection (shadow mode: every suite still runs)', ''];
  if (decision.full) {
    lines.push(`Every suite selected: ${decision.reason}.`, '');
  }
  lines.push('| Job | Step | Turbo task | Selected |', '| --- | --- | --- | --- |');
  for (const suite of suites) {
    const why = decision.full ? 'yes' : decision.affected.has(suite.task) ? `yes (${decision.affected.get(suite.task)})` : 'no';
    lines.push(`| ${suite.job} | ${suite.step} | \`${suite.task}\` | ${why} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Asks Turbo which suite tasks the merge commit affects. GitHub checks out a
 * merge commit for a pull request; its first parent is the base.
 */
export function turboAffected(run = (command, args) => execFileSync(command, args, { encoding: 'utf8' })) {
  const parents = run('git', ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ').slice(1);
  if (parents.length !== 2) {
    throw new Error(`HEAD is not a pull-request merge commit (${parents.length} parents)`);
  }
  const output = run('npx', ['--no-install', 'turbo', 'query', 'affected', '--tasks', ...taskNames, '--base', parents[0], '--head', 'HEAD']);
  const result = JSON.parse(output);
  if (result.errors?.length) {
    throw new Error(result.errors.map(error => error.message).join('; '));
  }
  return result.data.affectedTasks.items;
}

function main() {
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
  const decision = decide({
    eventName: process.env.GITHUB_EVENT_NAME ?? '',
    labels: (event.pull_request?.labels ?? []).map(label => label.name),
    queryAffected: () => turboAffected(),
  });
  const outputs = Object.entries(selectedJobs(decision))
    .map(([job, selected]) => `${job.replaceAll('-', '_')}=${selected}`)
    .join('\n');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${outputs}\n`);
  } else {
    console.log(outputs);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatSummary(decision));
  } else {
    console.log(formatSummary(decision));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
