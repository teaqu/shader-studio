import { describe, expect, it, vi } from 'vitest';
import {
  installPreviewStorage,
  namespacedStorage,
  previewChannel,
  workspaceDatabaseName,
  workspaceJournalKey,
} from '../previewIsolation';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
  };
}

describe('previewChannel', () => {
  it('treats a missing, empty or production channel as the live build', () => {
    expect(previewChannel(undefined)).toBeNull();
    expect(previewChannel('')).toBeNull();
    expect(previewChannel('production')).toBeNull();
    expect(previewChannel('pr-166')).toBe('pr-166');
  });

  it('reads the build channel by default', () => {
    vi.stubEnv('VITE_PREVIEW_CHANNEL', 'pr-7');
    try {
      expect(previewChannel()).toBe('pr-7');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('workspace names', () => {
  it('keeps the live names and gives previews their own', () => {
    expect(workspaceDatabaseName(null)).toBe('shader-studio-web');
    expect(workspaceJournalKey(null)).toBe('shader-studio-workspace-journal');
    expect(workspaceDatabaseName('pr-166')).toBe('shader-studio-web-pr-166');
    expect(workspaceJournalKey('pr-166')).toBe('shader-studio-workspace-journal-pr-166');
  });
});

describe('namespacedStorage', () => {
  it('reads and writes only its own keys and leaves live data alone', () => {
    const backing = memoryStorage({ 'shader-studio.standalone.settings': 'live', 'p:mine': 'old' });
    const view = namespacedStorage(backing, 'p:');

    expect(view.getItem('shader-studio.standalone.settings')).toBeNull();
    expect(view.getItem('mine')).toBe('old');
    view.setItem('shader-studio.standalone.settings', 'preview');
    expect(backing.getItem('shader-studio.standalone.settings')).toBe('live');
    expect(backing.getItem('p:shader-studio.standalone.settings')).toBe('preview');

    expect(view.length).toBe(2);
    expect([view.key(0), view.key(1)].sort()).toEqual(['mine', 'shader-studio.standalone.settings']);
    expect(view.key(2)).toBeNull();

    view.removeItem('mine');
    expect(backing.getItem('p:mine')).toBeNull();
    view.clear();
    expect(view.length).toBe(0);
    expect(backing.getItem('shader-studio.standalone.settings')).toBe('live');
  });
});

describe('installPreviewStorage', () => {
  it('does nothing for the live build', () => {
    const target = { localStorage: memoryStorage(), sessionStorage: memoryStorage() } as unknown as typeof globalThis;
    const original = target.localStorage;
    expect(installPreviewStorage(null, target)).toBe(false);
    expect(target.localStorage).toBe(original);
  });

  it('routes both storages of a preview through its channel', () => {
    const local = memoryStorage({ 'shader-studio-theme': 'dark' });
    const session = memoryStorage();
    const target = { localStorage: local, sessionStorage: session } as unknown as typeof globalThis;

    expect(installPreviewStorage('pr-166', target)).toBe(true);
    expect(target.localStorage.getItem('shader-studio-theme')).toBeNull();
    target.localStorage.setItem('shader-studio-theme', 'light');
    target.sessionStorage.setItem('tab', '1');
    expect(local.getItem('shader-studio-theme')).toBe('dark');
    expect(local.getItem('shader-studio-preview:pr-166:shader-studio-theme')).toBe('light');
    expect(session.getItem('shader-studio-preview:pr-166:tab')).toBe('1');
  });

  it('skips storage that is missing or blocked', () => {
    const local = memoryStorage();
    const target = { localStorage: local } as unknown as typeof globalThis;
    Object.defineProperty(target, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('blocked');
      },
    });
    expect(installPreviewStorage('pr-1', target)).toBe(true);
    expect(target.localStorage).not.toBe(local);

    const empty = { localStorage: null, sessionStorage: undefined } as unknown as typeof globalThis;
    expect(installPreviewStorage('pr-1', empty)).toBe(true);
    expect(empty.localStorage).toBeNull();
  });

  it('reports failure when storage cannot be replaced', () => {
    const target = {} as typeof globalThis;
    Object.defineProperty(target, 'localStorage', { configurable: false, value: memoryStorage() });
    expect(installPreviewStorage('pr-1', target)).toBe(false);

    // A host that accepts the redefinition but keeps serving the original.
    const ignored = new Proxy({ localStorage: memoryStorage() }, { defineProperty: () => true }) as unknown as typeof globalThis;
    expect(installPreviewStorage('pr-1', ignored)).toBe(false);
  });
});
