const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

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

async function main() {
	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', 'glsl-transpiler', 'esbuild'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}

	const slangOutDir = path.join(__dirname, 'dist', 'slang');
	fs.rmSync(slangOutDir, { recursive: true, force: true });
	fs.mkdirSync(slangOutDir, { recursive: true });
	const slangWorkerContext = await esbuild.context({
		entryPoints: [path.join(__dirname, 'src', 'language', 'slangLanguageWorker.ts')],
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node18',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		outfile: path.join(slangOutDir, 'slangLanguageWorker.js'),
		external: [],
	});
	if (watch) {
		await slangWorkerContext.watch();
	} else {
		await slangWorkerContext.rebuild();
		await slangWorkerContext.dispose();
	}
	for (const asset of ['slang-wasm.js', 'slang-wasm.wasm']) {
		const outputName = asset.endsWith('.js') ? 'slang-wasm.mjs' : asset;
		fs.copyFileSync(
			path.join(__dirname, '..', 'ui', 'src', 'slang', asset),
			path.join(slangOutDir, outputName),
		);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
