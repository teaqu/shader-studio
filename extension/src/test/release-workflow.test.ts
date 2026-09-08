import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const yaml = require('js-yaml') as { load(source: string): unknown };

interface Step {
  id?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
}

interface Job {
  'runs-on'?: string;
  uses?: string;
  needs?: string | string[];
  steps?: Step[];
}

interface Workflow {
  on: { workflow_call: { outputs: Record<string, { value: string }> } };
  jobs: Record<string, Job>;
}

const workflow = (name: string): Workflow => yaml.load(fs.readFileSync(
  path.resolve(__dirname, '../../../.github/workflows', name), 'utf8',
)) as Workflow;

suite('Packaged extension CI gates', () => {
  const release = workflow('release-extension.yml');
  const verify = workflow('verify.yml');
  const regular = workflow('test.yml');

  test('uses the same packaged verification for regular CI and releases without a development-host E2E run', () => {
    assert.strictEqual(regular.jobs.verify.uses, './.github/workflows/verify.yml');
    assert.strictEqual(release.jobs.verify.uses, regular.jobs.verify.uses);
    const commands = Object.values(verify.jobs).flatMap(job => job.steps ?? []).map(step => step.run ?? '');
    assert.ok(!commands.some(command => command.includes('test:e2e:vscode')));
    assert.strictEqual(commands.filter(command => command.includes('test:e2e:vsix')).length, 2);
    assert.strictEqual(commands.filter(command => command.includes('vsce package')).length, 1);
    assert.ok(commands.includes('npm test'));
    assert.ok(commands.includes('npm run test:e2e -w rendering'));
  });

  test('runs complementary GPU and non-GPU selections against the exact same packaged artifact', () => {
    for (const [name, runner, grep, invert] of [
      ['vscode-e2e', 'macos-15', '@gpu', '(?!)'],
      ['vscode-e2e-linux', 'ubuntu-latest', undefined, '@gpu'],
    ] as const) {
      const job = verify.jobs[name];
      assert.strictEqual(job['runs-on'], runner);
      assert.strictEqual(job.needs, 'package');
      const run = job.steps?.find(step => step.id === 'vsix-e2e');
      assert.ok(run);
      assert.ok(run.run?.includes('npm run test:e2e:vsix'));
      assert.strictEqual(run.env?.SHADER_STUDIO_E2E_GREP, grep);
      assert.strictEqual(run.env?.SHADER_STUDIO_E2E_GREP_INVERT, invert);
      assert.strictEqual(run.env?.SHADER_STUDIO_E2E_VSIX,
        '${{ github.workspace }}/${{ needs.package.outputs.vsix_path }}');
      const download = job.steps?.find(step => step.uses?.startsWith('actions/download-artifact@'));
      assert.strictEqual(download?.with?.name, 'shader-studio-${{ needs.package.outputs.version }}-vsix');
      const traces = job.steps?.find(step => step.uses?.startsWith('actions/upload-artifact@'));
      assert.strictEqual(traces?.with?.['include-hidden-files'], true,
        'the .playwright trace directory is hidden and must be included');
      assert.ok(!job.steps?.some(step => /vsce package|npm run (?:compile|build)/.test(step.run ?? '')),
        'installed-VSIX jobs must not rebuild the extension');
    }
    assert.ok(verify.jobs['vscode-e2e'].steps?.some(step => step.run === 'npx playwright install chromium'));
  });

  test('publishes only the artifact from the completed shared verification workflow', () => {
    for (const field of ['version', 'vsix_path']) {
      assert.strictEqual(verify.on.workflow_call.outputs[field].value, `\${{ jobs.package.outputs.${field} }}`);
    }
    assert.ok(!Object.values(release.jobs).some(job => job.steps?.some(step => step.run?.includes('vsce package'))));
    for (const name of ['publish-vscode', 'publish-open-vsx']) {
      const job = release.jobs[name];
      assert.strictEqual(job.needs, 'verify');
      const download = job.steps?.find(step => step.uses?.startsWith('actions/download-artifact@'));
      assert.strictEqual(download?.with?.name, 'shader-studio-${{ needs.verify.outputs.version }}-vsix');
      assert.ok(job.steps?.some(step => step.run?.includes('${{ needs.verify.outputs.vsix_path }}')));
    }
  });
});
