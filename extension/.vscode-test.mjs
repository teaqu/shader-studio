import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

const temporaryRoot = process.platform === 'win32' ? tmpdir() : '/tmp';
const temporaryTestDirectory = mkdtempSync(join(temporaryRoot, 'ssv-'));
let profileRemoved = false;

function removeTemporaryProfile() {
	if (profileRemoved) {
		return;
	}
	profileRemoved = true;

	const resolvedRoot = `${resolve(temporaryRoot)}${sep}`;
	const resolvedProfile = resolve(temporaryTestDirectory);
	if (
		!resolvedProfile.startsWith(resolvedRoot)
		|| !basename(resolvedProfile).startsWith('ssv-')
	) {
		return;
	}

	rmSync(resolvedProfile, { recursive: true, force: true });
}

process.once('exit', removeTemporaryProfile);

export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: [
		`--user-data-dir=${temporaryTestDirectory}`,
	],
});
