/** Browser-facing PWA lifecycle API. The shell owns presentation; this module
 * owns the deliberately small, testable service-worker contract. */
export interface PwaStatus {
  supported: boolean;
  online: boolean;
  updateAvailable: boolean;
  buildId: string | null;
  offlinePreparation: OfflinePreparationStatus;
}

export type OfflinePreparationStatus =
  | { state: 'idle' }
  | { state: 'preparing'; completed: number; total: number }
  | { state: 'ready' }
  | { state: 'cancelled' }
  | { state: 'error'; message: string };

export interface PwaController {
  start(): Promise<void>;
  subscribe(listener: (status: PwaStatus) => void): () => void;
  applyUpdate(): Promise<void>;
  checkForUpdate(): Promise<void>;
  prepareOffline(): Promise<void>;
  retryOfflinePreparation(): Promise<void>;
  cancelOfflinePreparation(): void;
  dispose(): void;
}

interface ServiceWorkerContainerLike {
  /** The worker serving this page; null on a first visit. */
  readonly controller?: ServiceWorker | null;
  register(scriptURL: string, options?: RegistrationOptions): Promise<ServiceWorkerRegistration>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface PwaEnvironment {
  serviceWorker?: ServiceWorkerContainerLike;
  online: () => boolean;
  addEventListener(type: 'online' | 'offline' | 'focus', listener: EventListener): void;
  removeEventListener(type: 'online' | 'offline' | 'focus', listener: EventListener): void;
  fetchBuildIdentity?: () => Promise<string | null>;
  reload(): void;
  baseUrl: string;
  createMessageChannel(): MessageChannel;
}

/** The real browser wiring; exported so its fetch and parsing can be tested. */
export function browserPwaEnvironment(): PwaEnvironment {
  return {
    serviceWorker: navigator.serviceWorker,
    online: () => navigator.onLine,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    fetchBuildIdentity: async () => {
      try {
        const response = await fetch(new URL('app-build.json', document.baseURI), { cache: 'no-store' });
        if (!response.ok) {
          return null;
        }
        const payload: unknown = await response.json();
        return typeof (payload as { buildId?: unknown }).buildId === 'string'
          ? (payload as { buildId: string }).buildId : null;
      } catch {
        return null;
      }
    },
    reload: () => window.location.reload(),
    baseUrl: document.baseURI,
    createMessageChannel: () => new MessageChannel(),
  };
}

export function createPwaController(environment: PwaEnvironment = browserPwaEnvironment()): PwaController {
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  let applyingUpdate = false;
  const listeners = new Set<(status: PwaStatus) => void>();
  let status: PwaStatus = {
    supported: !!environment.serviceWorker,
    online: environment.online(),
    updateAvailable: false,
    buildId: null,
    offlinePreparation: { state: 'idle' },
  };

  const emit = () => listeners.forEach((listener) => listener({ ...status }));
  const onConnectivity = () => {
    status = { ...status, online: environment.online() };
    emit();
    checkInBackground();
  };
  const checkInBackground = () => {
    if (!disposed && environment.online()) {
      void checkForUpdate().catch(() => { /* A network failure must not interrupt editing. */ });
    }
  };
  const onControllerChange = () => {
    if (applyingUpdate) {
      environment.reload();
    }
  };
  const inspect = () => {
    // A first install also passes through a waiting worker; it is only an
    // update when an older worker already serves the page.
    if (registration?.waiting && environment.serviceWorker?.controller) {
      status = { ...status, updateAvailable: true };
      emit();
    }
  };
  const observeInstallingWorker = () => {
    const installing = registration?.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && !disposed) {
        inspect();
      }
    });
  };
  async function checkForUpdate(): Promise<void> {
    await registration?.update();
    if (disposed) {
      return;
    }
    const buildId = await environment.fetchBuildIdentity?.() ?? status.buildId;
    status = { ...status, buildId };
    inspect();
    emit();
  }
  let preparationPort: MessagePort | undefined;
  let offlineStatusPort: MessagePort | undefined;

  const inspectOfflinePreparation = (): void => {
    if (!registration?.active) {
      return;
    }
    offlineStatusPort?.close();
    const channel = environment.createMessageChannel();
    offlineStatusPort = channel.port1;
    channel.port1.onmessage = (event: MessageEvent<{ type?: unknown; ready?: unknown }>) => {
      const payload = event.data;
      if (payload.type !== 'offline-status' || typeof payload.ready !== 'boolean') {
        return;
      }
      if (payload.ready) {
        status = { ...status, offlinePreparation: { state: 'ready' } };
        emit();
      }
      offlineStatusPort?.close();
      offlineStatusPort = undefined;
    };
    channel.port1.start();
    registration.active.postMessage({ type: 'GET_OFFLINE_STATUS' }, [channel.port2]);
  };

  const prepareOffline = async (): Promise<void> => {
    if (!registration?.active || preparationPort) {
      return;
    }
    const channel = environment.createMessageChannel();
    preparationPort = channel.port1;
    status = { ...status, offlinePreparation: { state: 'preparing', completed: 0, total: 0 } };
    emit();
    channel.port1.onmessage = (event: MessageEvent<{ type?: unknown; completed?: unknown; total?: unknown; message?: unknown }>) => {
      const payload = event.data;
      if (payload.type === 'progress' && typeof payload.completed === 'number' && typeof payload.total === 'number') {
        status = { ...status, offlinePreparation: { state: 'preparing', completed: payload.completed, total: payload.total } };
        emit();
        return;
      } else if (payload.type === 'complete') {
        status = { ...status, offlinePreparation: { state: 'ready' } };
      } else if (payload.type === 'cancelled') {
        status = { ...status, offlinePreparation: { state: 'cancelled' } };
      } else if (payload.type === 'error') {
        status = { ...status, offlinePreparation: { state: 'error', message: typeof payload.message === 'string' ? payload.message : 'Could not prepare offline compilers.' } };
      } else {
        return;
      }
      preparationPort?.close();
      preparationPort = undefined;
      emit();
    };
    channel.port1.start();
    registration.active.postMessage({ type: 'PREPARE_OFFLINE' }, [channel.port2]);
  };

  return {
    async start(): Promise<void> {
      if (disposed || !environment.serviceWorker) {
        return;
      }
      environment.addEventListener('online', onConnectivity);
      environment.addEventListener('offline', onConnectivity);
      environment.addEventListener('focus', checkInBackground);
      environment.serviceWorker.addEventListener('controllerchange', onControllerChange);
      try {
        registration = await environment.serviceWorker.register(new URL('sw.js', environment.baseUrl).toString()) ?? undefined;
      } catch {
        // A development server need not expose the production worker. Keep the
        // standalone editor usable rather than making its mount fail.
        registration = undefined;
      }
      // Automation that blocks service workers resolves register() with nothing.
      if (!registration) {
        status = { ...status, supported: false };
        emit();
        return;
      }
      registration.addEventListener('updatefound', observeInstallingWorker);
      observeInstallingWorker();
      inspect();
      inspectOfflinePreparation();
      const buildId = await environment.fetchBuildIdentity?.() ?? null;
      status = { ...status, buildId };
      emit();
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      listener({ ...status });
      return () => listeners.delete(listener);
    },
    async applyUpdate(): Promise<void> {
      if (!registration?.waiting) {
        return;
      }
      applyingUpdate = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    },
    checkForUpdate,
    prepareOffline,
    async retryOfflinePreparation(): Promise<void> {
      await prepareOffline();
    },
    cancelOfflinePreparation(): void {
      if (!preparationPort) {
        return;
      }
      registration?.active?.postMessage({ type: 'CANCEL_PREPARE_OFFLINE' });
    },
    dispose(): void {
      disposed = true;
      environment.removeEventListener('online', onConnectivity);
      environment.removeEventListener('offline', onConnectivity);
      environment.removeEventListener('focus', checkInBackground);
      environment.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
      preparationPort?.close();
      preparationPort = undefined;
      offlineStatusPort?.close();
      offlineStatusPort = undefined;
      listeners.clear();
    },
  };
}
