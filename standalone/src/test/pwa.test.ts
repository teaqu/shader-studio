import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPwaController } from '../pwa';
import { isOptionalCompilerAsset, serviceWorkerSource } from '../pwaBuild';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

const standaloneRoot = path.resolve(__dirname, '..', '..');
const PNG_COLOR_TYPE_RGB = 2;

function readManifest(): { icons: ManifestIcon[] } & Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(standaloneRoot, 'public/manifest.webmanifest'), 'utf8'));
}

/** Reads the IHDR chunk, which every PNG must begin with. */
function pngHeader(src: string): Buffer {
  const bytes = readFileSync(path.join(standaloneRoot, 'public', src));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return bytes;
}

function pngSize(src: string): { width: number; height: number } {
  const bytes = pngHeader(src);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function pngColorType(src: string): number {
  return pngHeader(src)[25];
}

function environment() {
  const listeners = new Map<string, EventListener>();
  const workerListeners = new Map<string, EventListener>();
  const waiting = { postMessage: vi.fn() } as unknown as ServiceWorker;
  const activePostMessage = vi.fn();
  const active = { postMessage: activePostMessage } as unknown as ServiceWorker;
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
    activePostMessage,
    listeners,
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

  it('reloads for a service-worker activation only after the user applies the update', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();

    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    expect(setup.environment.reload).not.toHaveBeenCalled();

    await controller.applyUpdate();
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    expect(setup.environment.reload).toHaveBeenCalledOnce();
  });

  it('restores offline readiness from the active service worker after a refresh', async () => {
    const setup = environment();
    let statusPort: MessagePort | undefined;
    let resolveBuildIdentity: ((buildId: string) => void) | undefined;
    setup.environment.fetchBuildIdentity = vi.fn(() => new Promise<string>((resolve) => {
      resolveBuildIdentity = resolve;
    }));
    setup.environment.createMessageChannel = () => {
      const channel = new MessageChannel();
      statusPort = channel.port1;
      return channel;
    };
    const controller = createPwaController(setup.environment);
    const states: unknown[] = [];
    controller.subscribe((state) => states.push(state));

    const start = controller.start();

    await vi.waitFor(() => {
      expect(setup.active.postMessage).toHaveBeenCalledWith(
        { type: 'GET_OFFLINE_STATUS' },
        expect.any(Array),
      );
    });
    statusPort?.onmessage?.({ data: { type: 'offline-status', ready: true } } as MessageEvent);
    resolveBuildIdentity?.('build-123');
    await start;
    expect(states.at(-1)).toMatchObject({ offlinePreparation: { state: 'ready' } });
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

  it('treats a registration that resolves without a worker registration as unsupported', async () => {
    // Automation that blocks service workers resolves register() with nothing.
    const setup = environment();
    setup.environment.serviceWorker.register.mockResolvedValueOnce(undefined as unknown as ServiceWorkerRegistration);
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
    expect(setup.active.postMessage).toHaveBeenCalledWith({ type: 'PREPARE_OFFLINE' }, expect.any(Array));
    expect(setup.active.postMessage).toHaveBeenCalledWith({ type: 'CANCEL_PREPARE_OFFLINE' });
    expect(setup.activePostMessage.mock.calls.filter(([message]) => message.type === 'PREPARE_OFFLINE')).toHaveLength(2);
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
    expect(source).toContain("event.data?.type === 'GET_OFFLINE_STATUS'");
    expect(source).toContain("cache.match(asset, { ignoreVary: true })");
    expect(source).toContain("event.data?.type !== 'PREPARE_OFFLINE'");
    expect(source).toContain("event.data?.type === 'CANCEL_PREPARE_OFFLINE'");
    expect(source).toContain("caches.match(event.request, { ignoreVary: true })");
    expect(source).toContain("event.request.mode === 'navigate' ? caches.match('./', { ignoreVary: true })");
  });

  it('declares installable standalone metadata with the shipped icon', () => {
    const html = readFileSync(path.join(standaloneRoot, 'index.html'), 'utf8');
    const manifest = readManifest();
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(manifest).toMatchObject({ display: 'standalone', start_url: './', scope: './' });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: './shader-studio-icon.svg', purpose: 'any' }),
    ]));
  });

  it('keeps the edge-to-edge SVG out of maskable use, where launchers would crop it', () => {
    const svg = readManifest().icons.find((icon) => icon.src.endsWith('.svg'));
    expect(svg?.purpose.split(' ')).not.toContain('maskable');
  });

  it.each([
    ['./icons/icon-192.png', 192, 'any'],
    ['./icons/icon-512.png', 512, 'any'],
    ['./icons/icon-maskable-512.png', 512, 'maskable'],
  ])('ships the %s raster install icon at its declared size', (src, size, purpose) => {
    const icon = readManifest().icons.find((entry) => entry.src === src);
    expect(icon).toEqual({ src, sizes: `${size}x${size}`, type: 'image/png', purpose });
    expect(pngSize(src)).toEqual({ width: size, height: size });
  });

  it('gives the maskable icon an opaque background so the launcher mask has no transparent corners', () => {
    expect(pngColorType('./icons/icon-maskable-512.png')).toBe(PNG_COLOR_TYPE_RGB);
  });

  it('links an opaque 180px Home Screen icon for iOS instead of the SVG, which iOS ignores', () => {
    const html = readFileSync(path.join(standaloneRoot, 'index.html'), 'utf8');
    const appleTouchIcon = html.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/)?.[1];
    expect(appleTouchIcon).toBe('./icons/apple-touch-icon.png');
    expect(pngSize(appleTouchIcon!)).toEqual({ width: 180, height: 180 });
    expect(pngColorType(appleTouchIcon!)).toBe(PNG_COLOR_TYPE_RGB);
  });
});
