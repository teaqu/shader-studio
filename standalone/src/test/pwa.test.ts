import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { browserPwaEnvironment, createPwaController } from '../pwa';
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
  const waiting = { postMessage: vi.fn((_message: unknown, ports?: MessagePort[]) => {
    ports?.[0].postMessage({ type: 'update-ready' });
  }) } as unknown as ServiceWorker;
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
        // A page that already runs under a worker; first installs clear this.
        controller: {} as ServiceWorker | null,
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

/** Close any ports a test left open so Node can exit cleanly. */
function dispose(controller: { dispose(): void }): void {
  controller.dispose();
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
    expect((setup.registration.waiting as ServiceWorker).postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }, expect.any(Array));
    await controller.checkForUpdate();
    expect(setup.registration.update).toHaveBeenCalledOnce();
  });

  it('reloads for a service-worker activation only after the user applies the update', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();

    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    await Promise.resolve();
    expect(setup.environment.reload).not.toHaveBeenCalled();

    await controller.applyUpdate();
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    await Promise.resolve();
    expect(setup.environment.reload).toHaveBeenCalledOnce();
  });

  it('does not activate or reload when the waiting worker defers the update', async () => {
    const setup = environment();
    const postMessage = (setup.registration.waiting as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
    postMessage.mockImplementation((_message: unknown, ports?: MessagePort[]) => {
      ports?.[0].postMessage({ type: 'update-deferred' });
    });
    const controller = createPwaController(setup.environment);
    await controller.start();

    await expect(controller.applyUpdate()).resolves.toBe(false);
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    await Promise.resolve();

    expect(setup.environment.reload).not.toHaveBeenCalled();
  });

  it('fails closed when the waiting worker does not reply before the update timeout', async () => {
    vi.useFakeTimers();
    try {
      const setup = environment();
      const postMessage = (setup.registration.waiting as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
      postMessage.mockImplementation(() => {});
      const controller = createPwaController(setup.environment);
      await controller.start();

      const update = controller.applyUpdate();
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(update).resolves.toBe(false);
      setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
      expect(setup.environment.reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when posting an update request throws', async () => {
    const setup = environment();
    const postMessage = (setup.registration.waiting as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage;
    postMessage.mockImplementation(() => {
      throw new Error('worker unavailable');
    });
    const controller = createPwaController(setup.environment);
    await controller.start();

    await expect(controller.applyUpdate()).resolves.toBe(false);
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    expect(setup.environment.reload).not.toHaveBeenCalled();
  });

  it('waits to save before reloading and ignores duplicate controller changes', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();
    let finishSave!: () => void;
    const beforeReload = vi.fn(() => new Promise<void>(resolve => {
      finishSave = resolve;
    }));

    await expect(controller.applyUpdate(beforeReload)).resolves.toBe(true);
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    await vi.waitFor(() => expect(beforeReload).toHaveBeenCalledOnce());
    expect(setup.environment.reload).not.toHaveBeenCalled();

    finishSave();
    await vi.waitFor(() => expect(setup.environment.reload).toHaveBeenCalledOnce());
  });

  it('does not reload when saving before activation fails', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();
    const beforeReload = vi.fn().mockRejectedValue(new Error('disk full'));

    await expect(controller.applyUpdate(beforeReload)).resolves.toBe(true);
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    await vi.waitFor(() => expect(beforeReload).toHaveBeenCalledOnce());
    await Promise.resolve();

    expect(setup.environment.reload).not.toHaveBeenCalled();
  });

  it('does not reload after disposal while a pre-reload save is pending', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();
    let finishSave!: () => void;
    const beforeReload = vi.fn(() => new Promise<void>(resolve => {
      finishSave = resolve;
    }));

    await expect(controller.applyUpdate(beforeReload)).resolves.toBe(true);
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));
    await vi.waitFor(() => expect(beforeReload).toHaveBeenCalledOnce());
    controller.dispose();
    finishSave();
    await Promise.resolve();

    expect(setup.environment.reload).not.toHaveBeenCalled();
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

describe('PWA controller lifecycle branches', () => {
  it('follows connectivity changes', async () => {
    const setup = environment();
    let online = true;
    setup.environment.online = () => online;
    const controller = createPwaController(setup.environment);
    const states: { online: boolean }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();

    online = false;
    setup.listeners.get('offline')?.(new Event('offline'));
    online = true;
    setup.listeners.get('online')?.(new Event('online'));

    expect(states.map((state) => state.online).slice(-2)).toEqual([false, true]);
  });

  it('observes a worker already installing when registration resolves', async () => {
    const setup = environment();
    (setup.registration as { waiting: unknown }).waiting = null;
    const stateListeners: EventListener[] = [];
    const installing = { state: 'installing', addEventListener: (_type: string, listener: EventListener) => stateListeners.push(listener) };
    (setup.registration as { installing: unknown }).installing = installing;
    const controller = createPwaController(setup.environment);
    const states: { updateAvailable: boolean }[] = [];
    controller.subscribe(state => states.push(state));
    await controller.start();
    installing.state = 'installed';
    (setup.registration as { waiting: unknown }).waiting = { postMessage: vi.fn() };
    stateListeners.forEach(listener => listener(new Event('statechange')));
    expect(states.at(-1)?.updateAvailable).toBe(true);
    dispose(controller);
  });

  it('checks for updates on focus and reconnection without interrupting the app on network errors', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();
    setup.listeners.get('focus')?.(new Event('focus'));
    await Promise.resolve();
    expect(setup.registration.update).toHaveBeenCalledOnce();
    vi.mocked(setup.registration.update).mockRejectedValueOnce(new Error('offline'));
    setup.listeners.get('online')?.(new Event('online'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(setup.registration.update).toHaveBeenCalledTimes(2);
    setup.environment.online = () => false;
    setup.listeners.get('focus')?.(new Event('focus'));
    expect(setup.registration.update).toHaveBeenCalledTimes(2);
    dispose(controller);
  });

  it('offers an update that finishes installing while the app is open', async () => {
    const setup = environment();
    (setup.registration as { waiting: ServiceWorker | null }).waiting = null;
    const controller = createPwaController(setup.environment);
    const states: { updateAvailable: boolean }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();
    expect(states.at(-1)?.updateAvailable).toBe(false);

    const stateListeners: EventListener[] = [];
    const installing = { state: 'installing', addEventListener: (_type: string, listener: EventListener) => stateListeners.push(listener) };
    (setup.registration as { installing: unknown }).installing = installing;
    setup.workerListeners.get('updatefound')?.(new Event('updatefound'));
    stateListeners.forEach((listener) => listener(new Event('statechange')));
    expect(states.at(-1)?.updateAvailable).toBe(false);

    installing.state = 'installed';
    (setup.registration as { waiting: unknown }).waiting = { postMessage: vi.fn() };
    stateListeners.forEach((listener) => listener(new Event('statechange')));

    expect(states.at(-1)?.updateAvailable).toBe(true);
  });

  it('does not offer the first worker ever installed as an update', async () => {
    const setup = environment();
    setup.environment.serviceWorker.controller = null;
    (setup.registration as { waiting: ServiceWorker | null }).waiting = null;
    const controller = createPwaController(setup.environment);
    const states: { updateAvailable: boolean }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();

    const stateListeners: EventListener[] = [];
    const installing = { state: 'installed', addEventListener: (_type: string, listener: EventListener) => stateListeners.push(listener) };
    (setup.registration as { installing: unknown }).installing = installing;
    // A first install passes through 'installed' with itself as the waiting worker.
    (setup.registration as { waiting: unknown }).waiting = installing;
    setup.workerListeners.get('updatefound')?.(new Event('updatefound'));
    stateListeners.forEach((listener) => listener(new Event('statechange')));

    expect(states.every((state) => !state.updateAvailable)).toBe(true);
  });

  it('does not offer a waiting worker as an update when nothing controls the page yet', async () => {
    const setup = environment();
    setup.environment.serviceWorker.controller = null;
    const controller = createPwaController(setup.environment);
    const states: { updateAvailable: boolean }[] = [];
    controller.subscribe((state) => states.push(state));

    await controller.start();
    await controller.checkForUpdate();

    expect(states.every((state) => !state.updateAvailable)).toBe(true);
  });

  it('ignores an update search that finds nothing installing', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();

    expect(() => setup.workerListeners.get('updatefound')?.(new Event('updatefound'))).not.toThrow();
  });

  it('does nothing when asked to apply an update that is not waiting', async () => {
    const setup = environment();
    (setup.registration as { waiting: ServiceWorker | null }).waiting = null;
    const controller = createPwaController(setup.environment);
    await controller.start();

    await controller.applyUpdate();
    setup.listeners.get('controllerchange')?.(new Event('controllerchange'));

    expect(setup.environment.reload).not.toHaveBeenCalled();
  });

  it('keeps the known build when a later identity check fails', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    const states: { buildId: string | null }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();
    setup.environment.fetchBuildIdentity.mockResolvedValueOnce(null);

    await controller.checkForUpdate();

    expect(states.at(-1)?.buildId).toBe('build-123');
  });

  it('skips the offline status check and preparation until a worker is active', async () => {
    const setup = environment();
    (setup.registration as { active: ServiceWorker | null }).active = null;
    const controller = createPwaController(setup.environment);
    const states: { offlinePreparation: unknown }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();

    await controller.prepareOffline();

    expect(setup.activePostMessage).not.toHaveBeenCalled();
    expect(states.at(-1)?.offlinePreparation).toEqual({ state: 'idle' });
  });

  it('leaves preparation idle when the worker says compilers are not ready, and ignores malformed status replies', async () => {
    const setup = environment();
    const ports: MessagePort[] = [];
    setup.environment.createMessageChannel = () => {
      const channel = new MessageChannel();
      ports.push(channel.port1);
      return channel;
    };
    const controller = createPwaController(setup.environment);
    const states: { offlinePreparation: unknown }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();

    ports[0].onmessage?.({ data: { type: 'offline-status', ready: 'yes' } } as MessageEvent);
    ports[0].onmessage?.({ data: { type: 'progress', ready: true } } as MessageEvent);
    ports[0].onmessage?.({ data: { type: 'offline-status', ready: false } } as MessageEvent);

    expect(states.every((state) => (state.offlinePreparation as { state: string }).state === 'idle')).toBe(true);
    dispose(controller);
  });

  it('starts only one preparation at a time', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();
    setup.activePostMessage.mockClear();

    await controller.prepareOffline();
    await controller.prepareOffline();

    expect(setup.activePostMessage.mock.calls.filter(([message]) => message.type === 'PREPARE_OFFLINE')).toHaveLength(1);
    dispose(controller);
  });

  it.each([
    ['a worker error message', { type: 'error', message: 'Could not cache assets/slang.wasm' }, 'Could not cache assets/slang.wasm'],
    ['a default when the worker gives none', { type: 'error' }, 'Could not prepare offline compilers.'],
  ])('reports %s', async (_label, reply, message) => {
    const setup = environment();
    let port: MessagePort | undefined;
    setup.environment.createMessageChannel = () => {
      const channel = new MessageChannel();
      port = channel.port1;
      return channel;
    };
    const controller = createPwaController(setup.environment);
    const states: { offlinePreparation: unknown }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();
    await controller.prepareOffline();

    port?.onmessage?.({ data: reply } as MessageEvent);

    expect(states.at(-1)?.offlinePreparation).toEqual({ state: 'error', message });
  });

  it('ignores preparation replies it does not understand and keeps waiting', async () => {
    const setup = environment();
    let port: MessagePort | undefined;
    setup.environment.createMessageChannel = () => {
      const channel = new MessageChannel();
      port = channel.port1;
      return channel;
    };
    const controller = createPwaController(setup.environment);
    const states: { offlinePreparation: unknown }[] = [];
    controller.subscribe((state) => states.push(state));
    await controller.start();
    await controller.prepareOffline();
    const count = states.length;

    port?.onmessage?.({ data: { type: 'progress', completed: '1', total: 2 } } as MessageEvent);
    port?.onmessage?.({ data: { type: 'unknown' } } as MessageEvent);
    port?.onmessage?.({ data: { type: 'complete' } } as MessageEvent);

    expect(states.length).toBe(count + 1);
    expect(states.at(-1)?.offlinePreparation).toEqual({ state: 'ready' });
  });

  it('treats cancel with nothing in progress as a no-op', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    await controller.start();
    setup.activePostMessage.mockClear();

    controller.cancelOfflinePreparation();

    expect(setup.activePostMessage).not.toHaveBeenCalled();
  });

  it('detaches listeners on dispose and does not start afterwards', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.start();

    controller.dispose();
    listener.mockClear();
    await controller.start();

    expect(setup.environment.removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(setup.environment.removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(setup.environment.serviceWorker.removeEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(setup.environment.serviceWorker.register).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying a subscriber after it unsubscribes', async () => {
    const setup = environment();
    const controller = createPwaController(setup.environment);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    unsubscribe();
    listener.mockClear();

    await controller.start();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('browser PWA environment', () => {
  const buildIdentity = async (response: Response | Error) => {
    const fetch = vi.fn(() => response instanceof Error ? Promise.reject(response) : Promise.resolve(response));
    vi.stubGlobal('fetch', fetch);
    try {
      return { id: await browserPwaEnvironment().fetchBuildIdentity?.(), fetch };
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it('reads the build id from app-build.json beside the app, bypassing the HTTP cache', async () => {
    const { id, fetch } = await buildIdentity(new Response(JSON.stringify({ buildId: 'abc-123' })));

    expect(id).toBe('abc-123');
    expect(fetch).toHaveBeenCalledWith(new URL('app-build.json', document.baseURI), { cache: 'no-store' });
  });

  it.each([
    ['a missing file', new Response('missing', { status: 404 })],
    ['a non-string id', new Response(JSON.stringify({ buildId: 7 }))],
    ['invalid JSON', new Response('{bad')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('treats %s as an unknown build', async (_label, response) => {
    expect((await buildIdentity(response)).id).toBeNull();
  });

  it('reflects the browser connection and document location', () => {
    const environment = browserPwaEnvironment();

    expect(environment.online()).toBe(navigator.onLine);
    expect(environment.baseUrl).toBe(document.baseURI);
    expect(environment.createMessageChannel()).toBeInstanceOf(MessageChannel);
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
    expect(source).toContain("cache.match(event.request, { ignoreVary: true })");
    expect(source).toContain("event.request.mode === 'navigate' ? cache.match('./', { ignoreVary: true })");
  });

  it.each(['default', 'no-store'])('serves only the current build cache and respects %s requests', async (cacheMode) => {
    let fetchListener!: (event: { request: Request; respondWith: (response: Promise<Response>) => void }) => void;
    const currentCache = { match: vi.fn().mockResolvedValue(new Response('current build')) };
    const caches = {
      open: vi.fn().mockResolvedValue(currentCache),
      match: vi.fn().mockResolvedValue(new Response('stale build from another channel')),
    };
    const fetch = vi.fn().mockResolvedValue(new Response('fresh network'));
    const self = {
      location: { origin: 'https://example.test' },
      registration: { scope: 'https://example.test/' },
      addEventListener: (type: string, listener: typeof fetchListener) => {
        if (type === 'fetch') {
          fetchListener = listener;
        }
      },
    };
    const source = serviceWorkerSource(['./'], [], { channel: 'preview', buildId: 'current' });
    new Function('self', 'caches', 'fetch', source)(self, caches, fetch);
    let response!: Promise<Response>;
    fetchListener({ request: new Request('https://example.test/', { cache: cacheMode as RequestCache }), respondWith: (value) => {
      response = value;
    } });
    expect(await (await response).text()).toBe(cacheMode === 'no-store' ? 'fresh network' : 'current build');
    expect(caches.match).not.toHaveBeenCalled();
    if (cacheMode === 'no-store') {
      expect(currentCache.match).not.toHaveBeenCalled();
    }
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
