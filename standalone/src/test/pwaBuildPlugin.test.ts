import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pwaBuildPlugin } from '../pwaBuild';

interface EmittedAsset {
  fileName: string;
  source: string;
}

type Hook = (this: unknown, ...args: unknown[]) => unknown;

/** Runs the plugin's two hooks the way Vite does for one production build. */
async function build(options: { publicDir: string; env?: Record<string, string>; bundle: string[] }) {
  const plugin = pwaBuildPlugin();
  (plugin.configResolved as Hook).call(undefined, { publicDir: options.publicDir, env: options.env ?? {} });
  const emitted: EmittedAsset[] = [];
  const context = { emitFile: (asset: EmittedAsset) => emitted.push(asset) };
  const bundle = Object.fromEntries(options.bundle.map((file) => [file, {}]));
  await (plugin.generateBundle as Hook).call(context, {}, bundle, false);
  const identity = JSON.parse(emitted.find((asset) => asset.fileName === 'app-build.json')!.source) as { buildId: string; channel: string };
  const worker = emitted.find((asset) => asset.fileName === 'sw.js')!.source;
  const list = (name: 'REQUIRED' | 'OPTIONAL') => JSON.parse(worker.match(new RegExp(`const ${name} = (\\[.*\\]);`))![1]) as string[];
  return { emitted, identity, worker, required: list('REQUIRED'), optional: list('OPTIONAL') };
}

describe('PWA build plugin', () => {
  let publicDir: string;

  beforeEach(async () => {
    publicDir = await mkdtemp(join(tmpdir(), 'pwa-public-'));
    await writeFile(join(publicDir, 'manifest.webmanifest'), '{}');
    await mkdir(join(publicDir, 'icons', 'nested'), { recursive: true });
    await writeFile(join(publicDir, 'icons', 'icon-192.png'), '');
    await writeFile(join(publicDir, 'icons', 'nested', 'deep.png'), '');
    // Without these, the host's GITHUB_SHA or VITE_* would leak into the build id.
    vi.stubEnv('VITE_BUILD_ID', '');
    vi.stubEnv('VITE_PREVIEW_CHANNEL', '');
    vi.stubEnv('GITHUB_SHA', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(publicDir, { recursive: true, force: true });
  });

  it('precaches the shell, bundle output and every public file, including nested ones', async () => {
    const { required } = await build({ publicDir, bundle: ['index.html', 'assets/app.js'] });

    expect(required).toEqual([
      './',
      'assets/app.js',
      'icons/icon-192.png',
      'icons/nested/deep.png',
      'index.html',
      'manifest.webmanifest',
    ]);
  });

  it('defers Slang and WGSL compiler assets to offline preparation', async () => {
    const { required, optional } = await build({
      publicDir,
      bundle: ['assets/app.js', 'assets/slang-wasm.wasm', 'assets/wgslLanguageService.worker.js', 'assets/glslLanguageService.worker.js'],
    });

    expect(optional).toEqual(['assets/slang-wasm.wasm', 'assets/wgslLanguageService.worker.js']);
    expect(required).toContain('assets/glslLanguageService.worker.js');
  });

  it('does not precache its own outputs', async () => {
    const { required, optional } = await build({ publicDir, bundle: ['assets/app.js', 'sw.js', 'app-build.json'] });

    expect([...required, ...optional]).not.toContain('sw.js');
    expect([...required, ...optional]).not.toContain('app-build.json');
  });

  it('emits exactly the build identity and the worker', async () => {
    const { emitted } = await build({ publicDir, bundle: ['assets/app.js'] });

    expect(emitted.map((asset) => asset.fileName).sort()).toEqual(['app-build.json', 'sw.js']);
  });

  it('defaults to a local production build', async () => {
    const { identity } = await build({ publicDir, bundle: ['assets/app.js'] });

    expect(identity).toEqual({ buildId: expect.stringMatching(/^local-[0-9a-f]{12}$/), channel: 'production' });
  });

  it('prefers the Vite env build id and channel', async () => {
    vi.stubEnv('VITE_BUILD_ID', 'process-id');
    vi.stubEnv('GITHUB_SHA', 'sha');
    const { identity, worker } = await build({
      publicDir,
      env: { VITE_BUILD_ID: 'vite-id', VITE_PREVIEW_CHANNEL: 'mobile' },
      bundle: ['assets/app.js'],
    });

    expect(identity.buildId).toMatch(/^vite-id-/);
    expect(identity.channel).toBe('mobile');
    expect(worker).toContain(`"shader-studio-mobile-${identity.buildId}"`);
  });

  it('falls back to process env, then the CI commit', async () => {
    vi.stubEnv('VITE_PREVIEW_CHANNEL', 'preview');
    vi.stubEnv('GITHUB_SHA', 'commit-sha');
    const fromCommit = await build({ publicDir, bundle: ['assets/app.js'] });
    vi.stubEnv('VITE_BUILD_ID', 'process-id');
    const fromProcess = await build({ publicDir, bundle: ['assets/app.js'] });

    expect(fromCommit.identity).toMatchObject({ buildId: expect.stringMatching(/^commit-sha-/), channel: 'preview' });
    expect(fromProcess.identity.buildId).toMatch(/^process-id-/);
  });

  it('changes the build id when the shipped files change, so clients see an update', async () => {
    const first = await build({ publicDir, bundle: ['assets/app-a1.js'] });
    const same = await build({ publicDir, bundle: ['assets/app-a1.js'] });
    const changed = await build({ publicDir, bundle: ['assets/app-b2.js'] });

    expect(same.identity.buildId).toBe(first.identity.buildId);
    expect(changed.identity.buildId).not.toBe(first.identity.buildId);
  });

  it('builds without a public directory', async () => {
    const { required } = await build({ publicDir: '', bundle: ['assets/app.js'] });

    expect(required).toEqual(['./', 'assets/app.js']);
  });
});
