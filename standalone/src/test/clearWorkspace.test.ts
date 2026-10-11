import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearStandaloneWorkspace } from '../clearWorkspace';

function createStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage());
  vi.stubGlobal('sessionStorage', createStorage());
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

it('requires confirmation before clearing workspace data', async () => {
  const workspace = { clearWorkspace: vi.fn() };
  const reload = vi.fn();
  await clearStandaloneWorkspace(workspace, () => false, reload);
  expect(workspace.clearWorkspace).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('clears only application settings after workspace deletion succeeds', async () => {
  const workspace = { clearWorkspace: vi.fn().mockResolvedValue(undefined) };
  for (const storage of [localStorage, sessionStorage]) {
    storage.setItem('shader-studio.standalone-layout.v1', '{}');
    storage.setItem('unrelated', 'keep');
  }
  const reload = vi.fn();
  await clearStandaloneWorkspace(workspace, () => true, reload);
  for (const storage of [localStorage, sessionStorage]) {
    expect(storage.getItem('shader-studio.standalone-layout.v1')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  }
  expect(reload).toHaveBeenCalledOnce();
});

it('preserves settings and avoids reloading if workspace deletion fails', async () => {
  localStorage.setItem('shader-studio.theme', 'dark');
  const reload = vi.fn();
  await expect(clearStandaloneWorkspace({ clearWorkspace: vi.fn().mockRejectedValue(new Error('storage')) }, () => true, reload)).rejects.toThrow('storage');
  expect(localStorage.getItem('shader-studio.theme')).toBe('dark');
  expect(reload).not.toHaveBeenCalled();
});

it('keeps browser-wide preferences when clearing workspace files and layout', async () => {
  localStorage.setItem('shader-studio.standalone.settings', '{"version":1,"values":{"editor.fontSize":22}}');
  localStorage.setItem('shader-studio.webgpu.useViewerCamera', 'false');
  await clearStandaloneWorkspace({ clearWorkspace: vi.fn().mockResolvedValue(undefined) }, () => true, vi.fn());
  expect(localStorage.getItem('shader-studio.standalone.settings')).toContain('22');
  expect(localStorage.getItem('shader-studio.webgpu.useViewerCamera')).toBe('false');
});

it('reloads after clearing workspace when browser storage is denied', async () => {
  const reload = vi.fn();
  const denied = {
    get length(): number {
      throw new Error('denied');
    },
    key: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };
  vi.stubGlobal('localStorage', denied);
  vi.stubGlobal('sessionStorage', denied);

  await expect(clearStandaloneWorkspace({ clearWorkspace: vi.fn().mockResolvedValue(undefined) }, () => true, reload)).resolves.toBeUndefined();
  expect(reload).toHaveBeenCalledOnce();
});
