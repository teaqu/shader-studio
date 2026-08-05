import * as assert from 'assert';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface ConfigProbe {
  launchArgs: string[];
  profilePath: string;
  profileExistsDuringImport: boolean;
  version?: string;
}

suite('VS Code test runner configuration', () => {
  test('uses a managed short user profile without hiding installed extensions', async () => {
    const configUrl = pathToFileURL(path.resolve(__dirname, '../../.vscode-test.mjs')).href;
    const probeScript = [
      'import { existsSync } from "node:fs";',
      `import config from ${JSON.stringify(configUrl)};`,
      'const launchArgs = config.launchArgs ?? [];',
      'const profileArg = launchArgs.find((arg) => arg.startsWith("--user-data-dir="));',
      'const profilePath = profileArg?.slice("--user-data-dir=".length) ?? "";',
      'console.log(JSON.stringify({ launchArgs, profilePath, profileExistsDuringImport: existsSync(profilePath), version: config.version }));',
    ].join('\n');
    const { stdout } = await execFileAsync('node', [
      '--input-type=module',
      '--eval',
      probeScript,
    ]);
    const probe = JSON.parse(stdout.trim()) as ConfigProbe;

    assert.strictEqual(
      probe.launchArgs.filter((argument) => argument.startsWith('--user-data-dir=')).length,
      1,
    );
    assert.ok(!probe.launchArgs.some((argument) => argument.startsWith('--extensions-dir=')));
    assert.match(path.basename(probe.profilePath), /^ssv-/);
    if (process.platform !== 'win32') {
      assert.strictEqual(path.dirname(probe.profilePath), '/tmp');
    }
    assert.strictEqual(probe.profileExistsDuringImport, true);
    assert.strictEqual(existsSync(probe.profilePath), false);
    assert.strictEqual(probe.version, '1.101.0');
  });
});
