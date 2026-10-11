import { describe, expect, it, vi } from 'vitest';
import { serviceWorkerSource } from '../pwaBuild';

// Runs the generated worker source against in-memory stand-ins for the
// service-worker globals, so install, activation, offline preparation and
// request handling are exercised as code rather than matched as text.

const ORIGIN = 'https://app.test';
const SCOPE = `${ORIGIN}/app/`;
const SHELL_HTML = '<link href="./assets/style.css"><script src="./assets/app.js"></script>'
  + '<script src="./assets/slang-wasm.js"></script><a href="https://cdn.test/lib.js"></a><a href="#top"></a>';

type Handler = (event: Record<string, unknown>) => void;

class FakeCache {
  readonly entries = new Map<string, Response>();

  async put(key: string | Request, response: Response): Promise<void> {
    this.entries.set(resolve(key), response);
  }

  async match(key: string | Request): Promise<Response | undefined> {
    return this.entries.get(resolve(key))?.clone();
  }
}

function resolve(key: string | Request): string {
  return new URL(typeof key === 'string' ? key : key.url, SCOPE).href;
}

interface Network {
  /** Absolute URL to response body; missing URLs answer 404. */
  files: Map<string, string>;
  offline: boolean;
  /** URLs whose fetch waits until released, to observe work in flight. */
  held: Map<string, () => void>;
  holds: Set<string>;
}

function createWorker(options: {
  required: string[];
  optional: string[];
  channel?: string;
  buildId?: string;
  caches?: string[];
  clients?: string[];
  clientEnumerationFails?: boolean;
}) {
  const handlers = new Map<string, Handler>();
  const cacheStorage = new Map<string, FakeCache>(
    (options.caches ?? []).map(name => [name, new FakeCache()]),
  );
  const network: Network = { files: new Map(), offline: false, held: new Map(), holds: new Set() };
  const fetches: string[] = [];
  const self = {
    registration: { scope: SCOPE },
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(async () => {}),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => {
        if (options.clientEnumerationFails) {
          throw new Error('clients unavailable');
        }
        return (options.clients ?? []).map(url => ({ url }));
      }),
    },
  };
  const caches = {
    open: async (name: string) => {
      if (!cacheStorage.has(name)) {
        cacheStorage.set(name, new FakeCache());
      }
      return cacheStorage.get(name)!;
    },
    keys: async () => [...cacheStorage.keys()],
    delete: async (name: string) => cacheStorage.delete(name),
    match: async (key: string | Request) => {
      for (const cache of cacheStorage.values()) {
        const hit = await cache.match(key);
        if (hit) {
          return hit;
        }
      }
      return undefined;
    },
  };
  const fetch = async (input: string | Request): Promise<Response> => {
    const url = resolve(input);
    fetches.push(url);
    if (network.holds.has(url)) {
      await new Promise<void>(release => network.held.set(url, release));
    }
    if (network.offline) {
      throw new TypeError('Failed to fetch');
    }
    const body = network.files.get(url);
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body, { status: 200 });
  };
  // Worker scripts resolve relative request URLs against their own location.
  const WorkerRequest = class extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, SCOPE), init);
    }
  };
  const source = serviceWorkerSource(options.required, options.optional, {
    channel: options.channel ?? 'production',
    buildId: options.buildId ?? 'b1',
  });
  new Function('self', 'caches', 'fetch', 'Request', source)(self, caches, fetch, WorkerRequest);

  const lifecycle = async (type: 'install' | 'activate') => {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({
      waitUntil: (promise: Promise<unknown>) => {
        work = promise;
      },
    });
    await work;
  };
  const message = (data: unknown, includePort = true) => {
    const port = { postMessage: vi.fn() };
    let work: Promise<unknown> = Promise.resolve();
    handlers.get('message')!({
      data,
      ports: includePort ? [port] : [],
      waitUntil: (promise: Promise<unknown>) => {
        work = promise;
      },
    });
    return { port, done: work, replies: () => port.postMessage.mock.calls.map(([reply]) => reply) };
  };
  const request = async (url: string, init: { method?: string; mode?: string } = {}) => {
    let response = null as Promise<Response | undefined> | null;
    handlers.get('fetch')!({
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith: (promise: Promise<Response | undefined>) => {
        response = promise;
      },
    });
    return response === null ? { intercepted: false as const } : { intercepted: true as const, response: await response };
  };
  const cacheName = `shader-studio-${options.channel ?? 'production'}-${options.buildId ?? 'b1'}`;
  return { self, cacheStorage, network, fetches, lifecycle, message, request, cacheName };
}

function serveApp(network: Network) {
  network.files.set(`${SCOPE}`, SHELL_HTML);
  network.files.set(`${SCOPE}assets/app.js`, 'app');
  network.files.set(`${SCOPE}assets/style.css`, 'style');
  network.files.set(`${SCOPE}assets/slang-wasm.js`, 'slang');
  network.files.set(`${SCOPE}assets/slang.wasm`, 'wasm');
}

const required = ['./', 'assets/app.js'];
const optional = ['assets/slang-wasm.js', 'assets/slang.wasm'];

describe('generated service worker', () => {
  describe('install', () => {
    it('caches the required shell and the same-origin assets the shell references', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);

      await worker.lifecycle('install');

      expect([...worker.cacheStorage.get(worker.cacheName)!.entries.keys()].sort()).toEqual([
        `${SCOPE}`,
        `${SCOPE}assets/app.js`,
        `${SCOPE}assets/style.css`,
      ]);
    });

    it('leaves optional compiler assets and other origins for later', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);

      await worker.lifecycle('install');

      expect(worker.fetches).not.toContain(`${SCOPE}assets/slang-wasm.js`);
      expect(worker.fetches).not.toContain('https://cdn.test/lib.js');
    });

    it('fails the install when a required asset is missing, so a broken build never takes over', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      worker.network.files.delete(`${SCOPE}assets/app.js`);

      await expect(worker.lifecycle('install')).rejects.toThrow('Could not cache assets/app.js');
    });

    it('fails the install while offline', async () => {
      const worker = createWorker({ required, optional });
      worker.network.offline = true;

      await expect(worker.lifecycle('install')).rejects.toThrow();
    });
  });

  describe('activate', () => {
    it('removes older caches of its own channel and keeps other channels and unrelated caches', async () => {
      const worker = createWorker({
        required, optional, channel: 'preview', buildId: 'b2',
        caches: ['shader-studio-preview-b1', 'shader-studio-production-b1', 'other-app'],
      });
      serveApp(worker.network);
      await worker.lifecycle('install');

      await worker.lifecycle('activate');

      expect([...worker.cacheStorage.keys()].sort()).toEqual([
        'other-app',
        'shader-studio-preview-b2',
        'shader-studio-production-b1',
      ]);
      expect(worker.self.clients.claim).toHaveBeenCalledOnce();
    });
  });

  describe('messages', () => {
    it.each([{ clients: [] }, { clients: [`${SCOPE}shader`] }])('activates a waiting update with at most one app tab', async ({ clients }) => {
      const worker = createWorker({ required, optional, clients });

      const update = worker.message({ type: 'SKIP_WAITING' });
      await update.done;

      expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
      expect(update.replies()).toEqual([{ type: 'update-ready' }]);
      expect(worker.self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    });

    it('defers activation while another app tab is open', async () => {
      const worker = createWorker({ required, optional, clients: [`${SCOPE}one`, `${SCOPE}two`] });

      const update = worker.message({ type: 'SKIP_WAITING' });
      await update.done;

      expect(worker.self.skipWaiting).not.toHaveBeenCalled();
      expect(update.replies()).toEqual([{ type: 'update-deferred' }]);
    });

    it('ignores windows outside its registration scope when activating an update', async () => {
      const worker = createWorker({ required, optional, clients: [`${SCOPE}editor`, `${ORIGIN}/other`] });

      const update = worker.message({ type: 'SKIP_WAITING' });
      await update.done;

      expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
      expect(update.replies()).toEqual([{ type: 'update-ready' }]);
    });

    it('fails closed when it cannot enumerate app tabs', async () => {
      const worker = createWorker({ required, optional, clientEnumerationFails: true });

      const update = worker.message({ type: 'SKIP_WAITING' });
      await update.done;

      expect(worker.self.skipWaiting).not.toHaveBeenCalled();
      expect(update.replies()).toEqual([{ type: 'update-deferred' }]);
    });

    it('reports a deferred update when activation fails after tab enumeration', async () => {
      const worker = createWorker({ required, optional });
      worker.self.skipWaiting.mockRejectedValueOnce(new Error('activation failed'));

      const update = worker.message({ type: 'SKIP_WAITING' });
      await update.done;

      expect(update.replies()).toEqual([{ type: 'update-deferred' }]);
    });

    it('still handles an older client without a reply port', async () => {
      const worker = createWorker({ required, optional });

      const update = worker.message({ type: 'SKIP_WAITING' }, false);
      await update.done;

      expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
      expect(update.replies()).toEqual([]);
    });

    it('ignores messages it does not understand', async () => {
      const worker = createWorker({ required, optional });

      const unknown = worker.message({ type: 'SOMETHING_ELSE' });
      await unknown.done;
      const empty = worker.message(null);
      await empty.done;

      expect(unknown.replies()).toEqual([]);
      expect(empty.replies()).toEqual([]);
      expect(worker.self.skipWaiting).not.toHaveBeenCalled();
    });

    it('reports offline readiness only once every optional compiler asset is cached', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      await worker.lifecycle('install');

      const before = worker.message({ type: 'GET_OFFLINE_STATUS' });
      await before.done;
      const preparation = worker.message({ type: 'PREPARE_OFFLINE' });
      await preparation.done;
      const after = worker.message({ type: 'GET_OFFLINE_STATUS' });
      await after.done;

      expect(before.replies()).toEqual([{ type: 'offline-status', ready: false }]);
      expect(after.replies()).toEqual([{ type: 'offline-status', ready: true }]);
    });

    it('reports preparation progress for each optional asset, then completion', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);

      const preparation = worker.message({ type: 'PREPARE_OFFLINE' });
      await preparation.done;

      expect(preparation.replies()).toEqual([
        { type: 'progress', completed: 0, total: 2 },
        { type: 'progress', completed: 1, total: 2 },
        { type: 'progress', completed: 2, total: 2 },
        { type: 'complete' },
      ]);
    });

    it('stops at the next asset when cancelled and does not report readiness', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      worker.network.holds.add(`${SCOPE}assets/slang-wasm.js`);

      const preparation = worker.message({ type: 'PREPARE_OFFLINE' });
      await vi.waitFor(() => expect(worker.network.held.has(`${SCOPE}assets/slang-wasm.js`)).toBe(true));
      worker.message({ type: 'CANCEL_PREPARE_OFFLINE' });
      worker.network.held.get(`${SCOPE}assets/slang-wasm.js`)!();
      await preparation.done;
      const status = worker.message({ type: 'GET_OFFLINE_STATUS' });
      await status.done;

      expect(preparation.replies().at(-1)).toEqual({ type: 'cancelled' });
      expect(worker.fetches).not.toContain(`${SCOPE}assets/slang.wasm`);
      expect(status.replies()).toEqual([{ type: 'offline-status', ready: false }]);
    });

    it('lets a new preparation run after a cancelled one', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      worker.network.holds.add(`${SCOPE}assets/slang-wasm.js`);
      const first = worker.message({ type: 'PREPARE_OFFLINE' });
      await vi.waitFor(() => expect(worker.network.held.size).toBe(1));
      worker.message({ type: 'CANCEL_PREPARE_OFFLINE' });
      worker.network.holds.clear();
      worker.network.held.get(`${SCOPE}assets/slang-wasm.js`)!();
      await first.done;

      const retry = worker.message({ type: 'PREPARE_OFFLINE' });
      await retry.done;

      expect(retry.replies().at(-1)).toEqual({ type: 'complete' });
    });

    it('treats a cancel with nothing in progress as a no-op', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);

      worker.message({ type: 'CANCEL_PREPARE_OFFLINE' });
      const preparation = worker.message({ type: 'PREPARE_OFFLINE' });
      await preparation.done;

      expect(preparation.replies().at(-1)).toEqual({ type: 'complete' });
    });

    it('reports which asset failed when preparation cannot download it', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      worker.network.files.delete(`${SCOPE}assets/slang.wasm`);

      const preparation = worker.message({ type: 'PREPARE_OFFLINE' });
      await preparation.done;

      expect(preparation.replies().at(-1)).toEqual({ type: 'error', message: 'Could not cache assets/slang.wasm' });
    });

    it('reports an error when preparation starts offline', async () => {
      const worker = createWorker({ required, optional });
      worker.network.offline = true;

      const preparation = worker.message({ type: 'PREPARE_OFFLINE' });
      await preparation.done;

      expect(preparation.replies().at(-1)).toMatchObject({ type: 'error', message: expect.any(String) });
    });

    it('reports ready immediately for a build with no optional assets', async () => {
      const worker = createWorker({ required, optional: [] });

      const status = worker.message({ type: 'GET_OFFLINE_STATUS' });
      await status.done;

      expect(status.replies()).toEqual([{ type: 'offline-status', ready: true }]);
    });
  });

  describe('fetch', () => {
    it('serves cached assets without touching the network', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      await worker.lifecycle('install');
      worker.fetches.length = 0;
      worker.network.offline = true;

      const result = await worker.request(`${SCOPE}assets/app.js`);

      expect(result.intercepted && await result.response?.text()).toBe('app');
      expect(worker.fetches).toEqual([]);
    });

    it('fetches and keeps uncached files inside the app scope', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      worker.network.files.set(`${SCOPE}assets/texture.png`, 'png');

      const first = await worker.request(`${SCOPE}assets/texture.png`);
      await vi.waitFor(async () => expect(await worker.cacheStorage.get(worker.cacheName)?.match(`${SCOPE}assets/texture.png`)).toBeDefined());
      worker.network.offline = true;
      const second = await worker.request(`${SCOPE}assets/texture.png`);

      expect(first.intercepted && await first.response?.text()).toBe('png');
      expect(second.intercepted && await second.response?.text()).toBe('png');
    });

    it('does not keep same-origin files outside the app scope', async () => {
      const worker = createWorker({ required, optional });
      worker.network.files.set(`${ORIGIN}/elsewhere.js`, 'other');

      const result = await worker.request(`${ORIGIN}/elsewhere.js`);
      await Promise.resolve();

      expect(result.intercepted && await result.response?.text()).toBe('other');
      expect(worker.cacheStorage.get(worker.cacheName)?.entries.size ?? 0).toBe(0);
    });

    it('does not keep failed responses', async () => {
      const worker = createWorker({ required, optional });

      const result = await worker.request(`${SCOPE}assets/missing.js`);
      await Promise.resolve();

      expect(result.intercepted && result.response?.status).toBe(404);
      expect(worker.cacheStorage.get(worker.cacheName)?.entries.size ?? 0).toBe(0);
    });

    it('answers an offline navigation with the cached app shell', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      await worker.lifecycle('install');
      worker.network.offline = true;

      const result = await worker.request(`${SCOPE}some/deep/link`, { mode: 'navigate' });

      expect(result.intercepted && await result.response?.text()).toBe(SHELL_HTML);
    });

    it('lets an offline non-navigation request fail instead of returning the shell', async () => {
      const worker = createWorker({ required, optional });
      serveApp(worker.network);
      await worker.lifecycle('install');
      worker.network.offline = true;

      const result = await worker.request(`${SCOPE}assets/uncached.js`);

      expect(result).toEqual({ intercepted: true, response: undefined });
    });

    it.each([
      ['a non-GET request', `${SCOPE}api`, { method: 'POST' }],
      ['another origin', 'https://cdn.test/lib.js', {}],
    ])('leaves %s to the browser', async (_label, url, init) => {
      const worker = createWorker({ required, optional });

      expect(await worker.request(url, init)).toEqual({ intercepted: false });
    });
  });
});
