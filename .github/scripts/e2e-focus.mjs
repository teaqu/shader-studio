import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the command for the manually dispatched E2E focus workflow, which
 * reruns a few specs on the CI runners instead of the full Verify matrix.
 * Inputs arrive from workflow_dispatch, so they are validated here and passed
 * to the test runner as arguments, never interpolated into a shell.
 */
export const SUITES = Object.freeze({
  standalone: 'standalone',
  vscode: 'vscode',
  'vscode-gpu': 'vscode-gpu',
  'vscode-corpus': 'vscode-corpus',
  rendering: 'rendering',
  'rendering-corpus': 'rendering-corpus',
  ui: 'ui',
});

/** Vitest browser suites, as each Verify step runs them. */
const VITEST_SUITES = Object.freeze({
  rendering: { cwd: 'rendering', config: 'vitest.browser.config.mts' },
  'rendering-corpus': { cwd: 'rendering', config: 'vitest.corpus.config.mts' },
  ui: { cwd: 'ui', config: 'vitest.browser.config.mts' },
});

const SPEC = /^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/;
const PROJECT = /^[a-z0-9-]+$/;

function parseSpecs(value) {
  const specs = (value ?? '').split(/[\s,]+/).filter(Boolean);
  if (specs.length > 20) {
    throw new Error('Select at most 20 specs.');
  }
  for (const spec of specs) {
    if (!SPEC.test(spec) || spec.split('/').includes('..')) {
      throw new Error(`Invalid spec filter: ${spec}`);
    }
  }
  return specs;
}

function parseRepeat(value) {
  const repeat = Number(value || 1);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
    throw new Error('repeat must be an integer from 1 through 20.');
  }
  return repeat;
}

function parseGrep(value) {
  const grep = value ?? '';
  if (grep.length > 200 || /[\r\n]/.test(grep)) {
    throw new Error('grep must be a single line of at most 200 characters.');
  }
  if (grep) {
    new RegExp(grep);
  }
  return grep;
}

/** Returns { cwd, command, args, env } for one validated focus request. */
export function focusCommand(inputs, environment = {}) {
  const suite = inputs.suite;
  if (!Object.hasOwn(SUITES, suite)) {
    throw new Error(`Unknown suite: ${suite}. Use ${Object.keys(SUITES).join(', ')}.`);
  }
  const specs = parseSpecs(inputs.specs);
  const grep = parseGrep(inputs.grep);
  const repeat = parseRepeat(inputs.repeat);
  const playwrightFilters = [...specs, ...(grep ? ['--grep', grep] : []), ...(repeat > 1 ? ['--repeat-each', String(repeat)] : [])];

  if (suite === 'standalone') {
    const project = inputs.project || 'chromium';
    if (!PROJECT.test(project)) {
      throw new Error(`Invalid Playwright project: ${project}`);
    }
    return {
      cwd: 'standalone',
      command: 'npx',
      args: ['playwright', 'test', '--config', 'e2e/playwright.config.mjs', '--project', project, ...playwrightFilters],
      env: {},
    };
  }

  if (Object.hasOwn(VITEST_SUITES, suite)) {
    if (repeat > 1) {
      throw new Error('repeat is only supported for Playwright suites.');
    }
    const { cwd, config } = VITEST_SUITES[suite];
    return {
      cwd,
      command: 'npx',
      args: ['vitest', 'run', '--config', config, ...specs, ...(grep ? ['--testNamePattern', grep] : [])],
      env: {},
    };
  }

  if (suite === 'vscode-corpus') {
    // The extension-host corpus runs the compiled development extension, not the VSIX.
    return {
      cwd: 'extension',
      command: 'npx',
      args: ['playwright', 'test', '--config', './e2e/pw/playwright.corpus.config.mjs', ...playwrightFilters],
      env: { SHADER_STUDIO_E2E_WORKSPACE: '../tests/fixtures/shader-corpus' },
    };
  }

  if (!environment.SHADER_STUDIO_E2E_VSIX) {
    throw new Error('SHADER_STUDIO_E2E_VSIX must name the packaged extension.');
  }
  return {
    cwd: 'extension',
    command: 'node',
    args: ['scripts/run-vsix-e2e.mjs', ...playwrightFilters],
    env: {
      SHADER_STUDIO_E2E_VSIX: environment.SHADER_STUDIO_E2E_VSIX,
      SHADER_STUDIO_E2E_WINDOW: '1600x1000',
      // Without a GPU, @gpu specs cannot pass; with one, run whatever was selected.
      SHADER_STUDIO_E2E_GREP_INVERT: suite === 'vscode' ? '@gpu' : '(?!)',
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { cwd, command, args, env } = focusCommand({
    suite: process.env.FOCUS_SUITE,
    specs: process.env.FOCUS_SPECS,
    grep: process.env.FOCUS_GREP,
    repeat: process.env.FOCUS_REPEAT,
    project: process.env.FOCUS_PROJECT,
  }, process.env);
  console.log(`Running in ${cwd}: ${command} ${args.map(arg => JSON.stringify(arg)).join(' ')}`);
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
