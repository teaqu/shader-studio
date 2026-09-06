const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function buildEntry(entryPoints, outfile, platform, external) {
	const ctx = await esbuild.context({
		entryPoints,
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform,
		outfile,
		external,
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
		return undefined;
	}
	await ctx.rebuild();
	await ctx.dispose();
	return outfile;
}

async function main() {
	const desktop = buildEntry(['src/extension.ts'], 'dist/extension.js', 'node', ['vscode', 'glsl-transpiler', 'esbuild']);
	// The web worker has no Node.js builtins, so the browser bundle must not
	// import them: platform 'browser' fails the build if any creep in, which
	// is the firewall that keeps extension-web.ts web-safe.
	const web = buildEntry(['src/extension-web.ts'], 'dist/extension-web.js', 'browser', ['vscode']);
	if (watch) {
		await Promise.all([desktop, web]);
		return;
	}
	await Promise.all([desktop, web]);
	fs.mkdirSync('dist', { recursive: true });
	fs.rmSync(path.resolve(__dirname, 'dist/slang-wasm.wasm'), { force: true });
	fs.copyFileSync(path.resolve(__dirname, '../ui/src/slang/slang-wasm.js'), path.resolve(__dirname, 'dist/slang-wasm.mjs'));
	fs.copyFileSync(path.resolve(__dirname, '../language-servers/slang/THIRD_PARTY_NOTICES.md'), path.resolve(__dirname, 'dist/SLANG_THIRD_PARTY_NOTICES.md'));
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
