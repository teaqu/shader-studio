import { defineConfig } from '@vscode/test-cli';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryTestDirectory = join(tmpdir(), `shader-studio-vscode-test-${process.pid}`);

export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: [
		`--user-data-dir=${temporaryTestDirectory}`,
		`--extensions-dir=${temporaryTestDirectory}-extensions`,
	],
});
