import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppLayoutStub, { layoutStub } from './AppLayoutStub.svelte';
import AppShaderStudioStub from './AppShaderStudioStub.svelte';
import AppShaderExplorerStub from './AppShaderExplorerStub.svelte';
import AppEditorPaneStub from './AppEditorPaneStub.svelte';

vi.mock('../StandaloneLayout.svelte', () => ({ default: AppLayoutStub }));
vi.mock('../EditorPane.svelte', () => ({ default: AppEditorPaneStub }));
vi.mock('@shader-studio/shader-explorer/lib/components/ShaderExplorer.svelte', () => ({ default: AppShaderExplorerStub }));
vi.mock('@shader-studio/ui', async () => {
  const { getViewerSession } = await import('@shader-studio/ui/lib/state/viewerSession.svelte');
  return { getViewerSession, ShaderStudioApp: AppShaderStudioStub };
});

import App from '../App.svelte';
import type { WebTransport } from '../WebTransport';
import type { PwaController, PwaStatus } from '../pwa';
import {
  selectEditor, getSelectedEditor, requestEditor, getRequestedEditor, getNewShaderVisible,
  getRequestedPanel,
  requestPanel,
  resetShellState,
  setNewShaderVisible,
} from '../state/shellState.svelte';
import { setViewerSession } from '@shader-studio/ui/lib/state/viewerSession.svelte';

type TestTransport = WebTransport & {
  postMessage: ReturnType<typeof vi.fn>;
  getShaderExplorerHostApi: ReturnType<typeof vi.fn>;
  clearWorkspace: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  exportWorkspaceBackup: ReturnType<typeof vi.fn>;
  importWorkspaceBackup: ReturnType<typeof vi.fn>;
  onPersistenceStatus: ReturnType<typeof vi.fn>;
  getStorageStatus: ReturnType<typeof vi.fn>;
  requestPersistentStorage: ReturnType<typeof vi.fn>;
};

function createTransport(): TestTransport {
  return {
    postMessage: vi.fn(),
    getShaderExplorerHostApi: vi.fn(() => ({ getShaders: vi.fn() })),
    clearWorkspace: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    exportWorkspaceBackup: vi.fn().mockResolvedValue('{"workspace":true}'),
    importWorkspaceBackup: vi.fn().mockResolvedValue(undefined),
    onPersistenceStatus: vi.fn((listener) => {
      listener({ state: 'saved' });
      return vi.fn();
    }),
    getStorageStatus: vi.fn().mockResolvedValue({ backend: 'indexeddb', persisted: false, persistSupported: true }),
    requestPersistentStorage: vi.fn().mockResolvedValue({ backend: 'indexeddb', persisted: true, persistSupported: true }),
  } as unknown as TestTransport;
}

function createPwa(status: Partial<PwaStatus> = {}): PwaController & { applyUpdate: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((listener: (value: PwaStatus) => void) => {
      listener({ supported: true, online: true, updateAvailable: false, buildId: 'abc123', offlinePreparation: { state: 'idle' }, ...status });
      return vi.fn();
    }),
    applyUpdate: vi.fn().mockResolvedValue(undefined),
    checkForUpdate: vi.fn().mockResolvedValue(undefined),
    prepareOffline: vi.fn().mockResolvedValue(undefined),
    retryOfflinePreparation: vi.fn().mockResolvedValue(undefined),
    cancelOfflinePreparation: vi.fn(),
    dispose: vi.fn(),
  };
}

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('standalone App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    layoutStub.openEditor.mockReset();
    layoutStub.showPanel.mockReset();
    layoutStub.togglePanel.mockReset();
    layoutStub.isPanelVisible.mockReset().mockReturnValue(true);
    layoutStub.resetLayout.mockReset();
    layoutStub.isMobileLayout.mockReset().mockReturnValue(false);
    layoutStub.selectMobilePanel.mockReset();
    resetShellState();
    setViewerSession(null);
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('routes a file request to the layout and consumes it', async () => {
    render(App, { transport: createTransport() });
    requestEditor('/buffer.glsl');
    await tick();
    expect(layoutStub.openEditor).toHaveBeenCalledWith('/buffer.glsl');
    expect(getRequestedEditor()).toBeNull();
  });

  it('renders grouped standalone shell menus and keeps the warning outside the preview panel', async () => {
    const transport = createTransport();
    render(App, { props: { transport } });

    expect(screen.getByRole('banner', { name: 'Standalone workspace' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New Shader' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Workspace' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'View' }).classList.contains('menu-trigger')).toBe(true);
    expect(screen.getByRole('button', { name: 'Workspace' }).classList.contains('menu-trigger')).toBe(true);
    expect(screen.getAllByTestId('dropdown-indicator')).toHaveLength(2);
    expect(screen.getByTestId('web-alpha-warning').closest('[data-testid="preview-panel"]')).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('Changes are saved only in this browser. Clearing browser data will delete them.');
    expect(screen.getByTestId('shader-studio-app')).toBeTruthy();
    expect(screen.getByTestId('shader-explorer').getAttribute('data-compact')).toBe('true');
    const documentation = screen.getByRole('link', { name: 'Documentation' });
    expect(documentation.getAttribute('href')).toBe('https://teaqu.github.io/shader-studio/docs/');
    expect(documentation.classList.contains('toolbar-right')).toBe(true);
    const github = screen.getByRole('link', { name: 'GitHub' });
    expect(github.getAttribute('href')).toBe('https://github.com/teaqu/shader-studio');
    expect(github.getAttribute('target')).toBe('_blank');
    expect(github.getAttribute('rel')).toBe('noopener noreferrer');

    await fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Shader Explorer' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Editor' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Preview' }).getAttribute('aria-checked')).toBe('true');
  });

  it('dismisses the alpha notice and remembers that preference', async () => {
    const first = render(App, { transport: createTransport() });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss alpha notice' }));
    expect(screen.queryByTestId('web-alpha-warning')).toBeNull();
    expect(localStorage.getItem('shader-studio.alpha-notice-dismissed')).toBe('true');

    first.unmount();
    render(App, { transport: createTransport() });
    expect(screen.queryByTestId('web-alpha-warning')).toBeNull();
  });

  it('starts with the alpha notice hidden when it was previously dismissed', () => {
    localStorage.setItem('shader-studio.alpha-notice-dismissed', 'true');
    render(App, { transport: createTransport() });
    expect(screen.queryByTestId('web-alpha-warning')).toBeNull();
  });

  it('allows an in-memory alpha notice dismissal when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    });
    render(App, { transport: createTransport() });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss alpha notice' }));
    expect(screen.queryByTestId('web-alpha-warning')).toBeNull();
  });

  it('toggles panels from View and groups workspace actions separately', async () => {
    render(App, { props: { transport: createTransport() } });

    await fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Shader Explorer' }));
    await fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Editor' }));
    await fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Preview' }));

    expect(layoutStub.togglePanel).toHaveBeenNthCalledWith(1, 'explorer');
    expect(layoutStub.togglePanel).toHaveBeenNthCalledWith(2, 'editor');
    expect(layoutStub.togglePanel).toHaveBeenNthCalledWith(3, 'preview');

    await fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Reset workspace layout' }));
    expect(layoutStub.resetLayout).toHaveBeenCalledOnce();
  });

  it('surfaces durable save, connectivity, build, and update state', async () => {
    const transport = createTransport();
    transport.onPersistenceStatus.mockImplementation((listener) => {
      listener({ state: 'error', error: new Error('quota') });
      return vi.fn();
    });
    const pwa = createPwa({ online: false, updateAvailable: true, buildId: 'mobile-42' });
    render(App, { props: { transport, pwa } });

    expect(screen.getByText('Offline · Save failed').getAttribute('title')).toBe('Build mobile-42');
    await fireEvent.click(screen.getByRole('button', { name: 'Update ready' }));
    expect(transport.flush).toHaveBeenCalledOnce();
    expect(pwa.applyUpdate).toHaveBeenCalledOnce();
  });

  it('reports session-only storage and exposes explicit offline preparation', async () => {
    const transport = createTransport();
    transport.getStorageStatus.mockResolvedValue({ backend: 'session', persisted: false, persistSupported: false });
    const pwa = createPwa();
    render(App, { props: { transport, pwa } });

    await waitFor(() => expect(screen.getByText('Online · Session-only')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Download compilers for offline use (23 MB)' }));
    expect(pwa.prepareOffline).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }));
    expect(pwa.checkForUpdate).toHaveBeenCalledOnce();
  });

  it('requests eviction protection only from a user action', async () => {
    const transport = createTransport();
    render(App, { props: { transport } });
    await fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    const protect = await screen.findByRole('button', { name: 'Protect local storage' });
    expect(transport.requestPersistentStorage).not.toHaveBeenCalled();
    await fireEvent.click(protect);
    expect(transport.requestPersistentStorage).toHaveBeenCalledOnce();
  });

  it('exports a portable workspace backup from the Workspace menu', async () => {
    const transport = createTransport();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:backup'), revokeObjectURL: vi.fn() });
    render(App, { props: { transport } });

    await fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Export Workspace Backup' }));

    expect(transport.exportWorkspaceBackup).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it('validates a selected backup through the transport and reports import failure without reloading', async () => {
    const transport = createTransport();
    transport.importWorkspaceBackup.mockRejectedValueOnce(new Error('Backup format or version is not supported.'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(App, { props: { transport } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ text: vi.fn().mockResolvedValue('{"format":"wrong"}') }],
    });

    await fireEvent.change(input);

    await waitFor(() => expect(transport.importWorkspaceBackup).toHaveBeenCalledWith('{"format":"wrong"}', { replace: true }));
    expect(screen.getByRole('alert').textContent).toContain('Backup format or version is not supported.');
  });

  it('reacts to a requested panel command and consumes it', async () => {
    render(App, { props: { transport: createTransport() } });

    requestPanel('editor');
    await tick();

    expect(layoutStub.showPanel).toHaveBeenCalledWith('editor');
    layoutStub.showPanel.mockClear();
    await tick();
    expect(layoutStub.showPanel).not.toHaveBeenCalled();
  });

  it('routes host navigation through the one-panel mobile shell', async () => {
    layoutStub.isMobileLayout.mockReturnValue(true);
    render(App, { props: { transport: createTransport() } });

    requestPanel('explorer');
    await tick();
    expect(layoutStub.selectMobilePanel).toHaveBeenCalledWith('explorer');
    expect(layoutStub.showPanel).not.toHaveBeenCalled();

    requestEditor('/shaders/mobile.glsl');
    await tick();
    expect(layoutStub.openEditor).toHaveBeenCalledWith('/shaders/mobile.glsl');
    expect(layoutStub.selectMobilePanel).toHaveBeenLastCalledWith('editor');
  });

  it('creates a shader when requested by the explorer and closes it after submission or cancellation', async () => {
    const transport = createTransport();
    render(App, { props: { transport } });

    setNewShaderVisible(true);
    await tick();
    await fireEvent.input(screen.getByLabelText('Shader name'), { target: { value: ' aurora ' } });
    await fireEvent.change(screen.getByLabelText('Shader language'), { target: { value: 'slang' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shader' }));

    expect(transport.postMessage).toHaveBeenCalledWith({ type: 'createShader', payload: { name: 'aurora', language: 'slang' } });
    expect(screen.queryByRole('dialog', { name: 'New Shader' })).toBeNull();

    setNewShaderVisible(true);
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'New Shader' })).toBeNull();
  });

  it('leaves the workspace alone when clearing is cancelled', async () => {
    const transport = createTransport();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(App, { props: { transport } });

    await fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear Workspace' }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(transport.clearWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error when clearing the workspace fails', async () => {
    const transport = createTransport();
    transport.clearWorkspace.mockRejectedValueOnce(new Error('storage unavailable'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(App, { props: { transport } });

    await fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear Workspace' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Could not clear the workspace. Please try again.');
    });
  });

  it('routes explorer selection to the active editor and consumes the request', async () => {
    selectEditor('/shaders/aurora.glsl');
    render(App, { props: { transport: createTransport() } });
    await tick();
    expect(layoutStub.selectEditor).toHaveBeenCalledWith('/shaders/aurora.glsl');
    expect(getSelectedEditor()).toBeNull();
    selectEditor('/shaders/desert-cubemap.glsl');
    await tick();
    expect(layoutStub.selectEditor).toHaveBeenLastCalledWith('/shaders/desert-cubemap.glsl');
    expect(getSelectedEditor()).toBeNull();
  });

  it('resets transient shell state when the app unmounts', async () => {
    const app = render(App, { props: { transport: createTransport() } });
    setNewShaderVisible(true);
    requestPanel('preview');
    await tick();

    app.unmount();

    expect(getNewShaderVisible()).toBe(false);
    expect(getRequestedPanel()).toBeNull();
  });
});
