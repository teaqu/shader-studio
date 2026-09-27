import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPwaController } from '../pwa';
import { isOptionalCompilerAsset, serviceWorkerSource } from '../pwaBuild';

function environment() {
  const listeners = new Map<string, EventListener>();
  const workerListeners = new Map<string, EventListener>();
  const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
  const active = { postMessage: vi.fn() } as unknown as ServiceWorker;
  const registration = {
    waiting,
    active,
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((type: string, listener: EventListener) => workerListeners.set(type, listener)),
  } as unknown as ServiceWorkerRegistration;
  return {
    registration,
    active,
    workerListeners,
    reload: vi.fn(),
    environment: {
      serviceWorker: {
        register: vi.fn().mockResolvedValue(registration),
        addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
        removeEventListener: vi.fn(),
      },
      online: () => true,
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn(),
      fetchBuildIdentity: vi.fn().mockResolvedValue('build-123'),
      reload: vi.fn(),
      baseUrl: 'https://example.test/app/',
      createMessageChannel: () => new MessageChannel(),
    },
  };
}

describe('PWA controller', () => {
  it('registers relative to the standalone app, reports build identity, and applies a waiting update', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    const states: unknown[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();
    expect(setup.environment.serviceWorker.register).toHaveBeenCalledWith('https://example.test/app/sw.js');
    expect(states.at(-1)).toEqual({ supported: true, online: true, updateAvailable: true, buildId: 'build-123', offlinePreparation: { state: 'idle' } });
    await controller.applyUpdate();
    expect((setup.registration.waiting as ServiceWorker).postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    await controller.checkForUpdate();
    expect(setup.registration.update).toHaveBeenCalledOnce();
  });

  it('does nothing in browsers without service worker support', async () => {
    const controller = createPwaController({ ...environment().environment, serviceWorker: undefined });
    await expect(controller.start()).resolves.toBeUndefined();
  });

  it('degrades cleanly when the current host does not serve the production worker', async () => {
    const setup = environment();
    setup.environment.serviceWorker.register.mockRejectedValueOnce(new Error('missing worker'));
    const controller = createPwaController(setup.environment);
    const states: unknown[] = [];
    controller.subscribe((state) => states.push(state));
    await expect(controller.start()).resolves.toBeUndefined();
    expect(states.at(-1)).toMatchObject({ supported: false });
  });

  it('reports compiler preparation progress and supports cancellation and retry', async () => {
    const setup = environment();
    let port: MessagePort | undefined;
    setup.environment.createMessageChannel = () => {
      const channel = new MessageChannel();
      port = channel.port1;
      return channel;
    };
    const controller = createPwaController(setup.environment);
    const states: unknown[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();
    await controller.prepareOffline();
    expect(setup.active.postMessage).toHaveBeenCalledWith({ type: 'PREPARE_OFFLINE' }, expect.any(Array));
    port?.onmessage?.({ data: { type: 'progress', completed: 1, total: 3 } } as MessageEvent);
    expect(states.at(-1)).toMatchObject({ offlinePreparation: { state: 'preparing', completed: 1, total: 3 } });
    controller.cancelOfflinePreparation();
    expect(setup.active.postMessage).toHaveBeenCalledWith({ type: 'CANCEL_PREPARE_OFFLINE' });
    port?.onmessage?.({ data: { type: 'cancelled' } } as MessageEvent);
    await controller.retryOfflinePreparation();
    expect(setup.active.postMessage).toHaveBeenCalledTimes(3);
  });
});

describe('generated service worker', () => {
  it('keeps GLSL shell assets required while deferring Slang and WGSL compiler assets', () => {
    expect(isOptionalCompilerAsset('assets/app.js')).toBe(false);
    expect(isOptionalCompilerAsset('assets/glslLanguageService.worker.js')).toBe(false);
    expect(isOptionalCompilerAsset('assets/slang-wasm.wasm')).toBe(true);
    expect(isOptionalCompilerAsset('assets/wgslLanguageService.worker.js')).toBe(true);
  });

  it('precaches the shell, isolates cache versions, and supports explicit activation', () => {
    const source = serviceWorkerSource(['./', 'assets/app.js'], ['assets/slang.wasm'], { channel: 'preview', buildId: 'abc123' });
    expect(source).toContain('shader-studio-preview-abc123');
    expect(source).toContain('const CHANNEL_PREFIX = "shader-studio-preview-"');
    expect(source).toContain("cache: 'reload'");
    expect(source).toContain('html.matchAll');
    expect(source).toContain('"assets/app.js"');
    expect(source).toContain('"assets/slang.wasm"');
    expect(source).toContain("event.data?.type === 'SKIP_WAITING'");
    expect(source).toContain("event.data?.type !== 'PREPARE_OFFLINE'");
    expect(source).toContain("event.data?.type === 'CANCEL_PREPARE_OFFLINE'");
    expect(source).toContain("caches.match(event.request, { ignoreVary: true })");
    expect(source).toContain("event.request.mode === 'navigate' ? caches.match('./', { ignoreVary: true })");
  });

  it('declares installable standalone metadata with the shipped icon', () => {
    const root = path.resolve(__dirname, '..', '..');
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    const manifest = JSON.parse(readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(manifest).toMatchObject({ display: 'standalone', start_url: './', scope: './' });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: './shader-studio-icon.svg', purpose: 'any maskable' }),
    ]));
  });
});
