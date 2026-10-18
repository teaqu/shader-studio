const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Ajv writes require() calls into the validators it generates at runtime. The
 * SDK uses those validators after the extension has been bundled, so esbuild
 * cannot rewrite the generated calls. Keep the small resolver subtree beside
 * the bundle for the dependency-free VSIX.
 */
function copyAjvRuntime() {
	const output = path.resolve(__dirname, 'dist/node_modules');
	const sdkRoot = path.dirname(require.resolve('@modelcontextprotocol/sdk/package.json'));
	const resolveFromSdk = (name) => require.resolve(`${name}/package.json`, { paths: [sdkRoot] });
	const copyPackage = (name, manifest) => {
		const destination = path.join(output, name);
		fs.rmSync(destination, { recursive: true, force: true });
		fs.cpSync(path.dirname(manifest), destination, { recursive: true });
	};

	const ajv = resolveFromSdk('ajv');
	copyPackage('ajv', ajv);
	copyPackage('ajv-formats', resolveFromSdk('ajv-formats'));
	for (const dependency of Object.keys(require(ajv).dependencies)) {
		copyPackage(dependency, require.resolve(`${dependency}/package.json`, { paths: [path.dirname(ajv)] }));
	}
}

/** Copy the agent-facing canonical docs beside the bundle for offline MCP resources. */
function copyMcpDocumentation() {
	const source = path.resolve(__dirname, '../docs');
	const destination = path.resolve(__dirname, 'dist/docs');
	const files = [
		'features/mcp.md',
		'features/uniforms.md',
		'features/config-buffers.md',
		'help/config-file.md',
		'features/channels.md',
		'features/compute.md',
		'features/storage.md',
		'features/multiple-render-targets.md',
	];
	fs.rmSync(destination, { recursive: true, force: true });
	for (const file of files) {
		const target = path.join(destination, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(source, file), target);
	}
}

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
			if (result.errors.length === 0) {
				copyMcpDocumentation();
			}
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
		// The VSIX vendors only the runtime modules copied below. Everything
		// else must be bundled or supplied by the extension host.
		external: ['vscode'],
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
		fs.mkdirSync('dist', { recursive: true });
		fs.rmSync(path.resolve(__dirname, 'dist/slang-wasm.wasm'), { force: true });
		fs.copyFileSync(path.resolve(__dirname, '../ui/src/slang/slang-wasm.js'), path.resolve(__dirname, 'dist/slang-wasm.mjs'));
		// The script bundler's engine. It is loaded from beside the bundle at
		// runtime, so a missing copy here kills custom uniform scripts.
		fs.copyFileSync(require.resolve('esbuild-wasm/esbuild.wasm'), path.resolve(__dirname, 'dist/esbuild.wasm'));
		fs.copyFileSync(path.resolve(__dirname, '../language-servers/slang/THIRD_PARTY_NOTICES.md'), path.resolve(__dirname, 'dist/SLANG_THIRD_PARTY_NOTICES.md'));
		copyAjvRuntime();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
