<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, onMount, setContext } from 'svelte';
  import { PANEL_HOST_CONTEXT } from '@shader-studio/ui/lib/layout/PanelHost';
  import { HostedPanels } from './HostedPanels';
  import { ShaderStudioApp, getViewerSession } from '@shader-studio/ui';
  import ShaderExplorer from '@shader-studio/shader-explorer/lib/components/ShaderExplorer.svelte';
  import StandaloneLayout from './StandaloneLayout.svelte';
  import EditorPane from './EditorPane.svelte';
  import NewShaderModal from './NewShaderModal.svelte';
  import type { WebTransport, WorkspaceStorageStatus } from './WebTransport';
  import {
    getSelectedEditor, selectEditor, getRequestedEditor, requestEditor, getNewShaderVisible, getRequestedPanel, requestPanel,
    resetShellState, setNewShaderVisible,
  } from './state/shellState.svelte';
  import { clearStandaloneWorkspace } from './clearWorkspace';
  import type { ShaderLanguageId } from '@shader-studio/types';
  import type { PwaController, PwaStatus } from './pwa';
  import type { WorkspacePersistenceStatus } from './VirtualWorkspace';

  interface Props { transport: WebTransport; pwa?: PwaController; }
  const ALPHA_NOTICE_DISMISSED_KEY = 'shader-studio.alpha-notice-dismissed';

  function shouldShowAlphaNotice(): boolean {
    try {
      return localStorage.getItem(ALPHA_NOTICE_DISMISSED_KEY) !== 'true';
    } catch {
      return true;
    }
  }

  let { transport, pwa }: Props = $props();
  const hostedPanels = new HostedPanels();
  setContext(PANEL_HOST_CONTEXT, hostedPanels);
  let layout = $state<StandaloneLayout>();
  let workspaceError = $state('');
  let alphaNoticeVisible = $state(shouldShowAlphaNotice());
  let viewMenuOpen = $state(false);
  let workspaceMenuOpen = $state(false);
  let panelVisibility = $state({ explorer: true, editor: true, preview: true });
  let persistenceStatus = $state<WorkspacePersistenceStatus>({ state: 'saving' });
  let pwaStatus = $state<PwaStatus>({
    supported: false,
    online: navigator.onLine,
    updateAvailable: false,
    buildId: null,
    offlinePreparation: { state: 'idle' },
  });
  let storageStatus = $state<WorkspaceStorageStatus | null>(null);
  let workspaceFileInput: HTMLInputElement;
  const session = $derived(getViewerSession());
  const explorerApi = transport.getShaderExplorerHostApi();

  onMount(() => {
    void transport.getStorageStatus?.().then((status) => {
      storageStatus = status;
    });
    const stopPersistence = transport.onPersistenceStatus?.((status) => {
      persistenceStatus = status;
    }) ?? (() => {});
    const stopPwa = pwa?.subscribe((status) => {
      pwaStatus = status;
    }) ?? (() => {});
    return () => {
      stopPersistence();
      stopPwa();
      pwa?.dispose();
    };
  });

  $effect(() => {
    const panel = getRequestedPanel();
    if (panel && layout) {
      if (layout.isMobileLayout()) {
        layout.selectMobilePanel(panel);
      } else {
        layout.showPanel(panel);
      }
      requestPanel(null);
    }
  });

  $effect(() => {
    const path = getRequestedEditor();
    if (path && layout) {
      layout.openEditor(path);
      if (layout.isMobileLayout()) {
        layout.selectMobilePanel('editor');
      }
      requestEditor(null);
    }
  });

  $effect(() => {
    const path = getSelectedEditor();
    if (path && layout) {
      layout.selectEditor(path);
      if (layout.isMobileLayout()) {
        layout.selectMobilePanel('editor');
      }
      selectEditor(null);
    }
  });

  function createShader(name: string, language: ShaderLanguageId) {
    transport.postMessage({ type: 'createShader', payload: { name, language } });
    setNewShaderVisible(false);
  }

  async function clearWorkspace() {
    workspaceMenuOpen = false;
    workspaceError = '';
    try {
      await clearStandaloneWorkspace(transport);
    } catch {
      workspaceError = 'Could not clear the workspace. Please try again.';
    }
  }

  async function exportWorkspace() {
    workspaceMenuOpen = false;
    workspaceError = '';
    try {
      const contents = await transport.exportWorkspaceBackup();
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'shader-studio-workspace.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      workspaceError = 'Could not export the workspace. Your current work was not changed.';
    }
  }

  async function importWorkspace(event: Event) {
    workspaceMenuOpen = false;
    workspaceError = '';
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !window.confirm('Replace this browser workspace with the selected backup?')) {
      return;
    }
    try {
      await transport.importWorkspaceBackup(await file.text(), { replace: true });
      window.location.reload();
    } catch (error) {
      workspaceError = error instanceof Error
        ? `Could not import workspace: ${error.message}`
        : 'Could not import the workspace. Your current work was not changed.';
    }
  }

  async function applyUpdate() {
    workspaceError = '';
    try {
      await transport.flush();
      await pwa?.applyUpdate();
    } catch {
      workspaceError = 'Could not save pending work, so the update was not applied.';
    }
  }

  async function requestPersistentStorage() {
    storageStatus = await transport.requestPersistentStorage();
  }

  async function prepareOffline() {
    if (pwaStatus.offlinePreparation.state === 'error' || pwaStatus.offlinePreparation.state === 'cancelled') {
      await pwa?.retryOfflinePreparation();
    } else {
      await pwa?.prepareOffline();
    }
  }

  function saveStatusLabel(): string {
    if (storageStatus?.backend === 'session') {
      return 'Session-only';
    }
    if (persistenceStatus.state === 'error') {
      return 'Save failed';
    }
    return persistenceStatus.state === 'saving' ? 'Saving…' : 'Saved';
  }

  function toggleViewMenu() {
    viewMenuOpen = !viewMenuOpen;
    workspaceMenuOpen = false;
    if (viewMenuOpen) {
      panelVisibility = {
        explorer: layout?.isPanelVisible('explorer') ?? false,
        editor: layout?.isPanelVisible('editor') ?? false,
        preview: layout?.isPanelVisible('preview') ?? false,
      };
    }
  }

  function toggleWorkspaceMenu() {
    workspaceMenuOpen = !workspaceMenuOpen;
    viewMenuOpen = false;
  }

  function togglePanel(panel: 'explorer' | 'editor' | 'preview') {
    layout?.togglePanel(panel);
    panelVisibility[panel] = layout?.isPanelVisible(panel) ?? false;
    viewMenuOpen = false;
  }

  function resetLayout() {
    layout?.resetLayout();
    workspaceMenuOpen = false;
  }

  function dismissAlphaNotice() {
    alphaNoticeVisible = false;
    try {
      localStorage.setItem(ALPHA_NOTICE_DISMISSED_KEY, 'true');
    } catch {
      // The notice can still be dismissed for this session when storage is blocked.
    }
  }

  function closeMenusOnOutsideClick(event: MouseEvent) {
    if (!(event.target as Element).closest('.toolbar-menu')) {
      viewMenuOpen = false;
      workspaceMenuOpen = false;
    }
  }

  function closeMenusOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      viewMenuOpen = false;
      workspaceMenuOpen = false;
    }
  }

  onDestroy(resetShellState);
</script>

<svelte:window onclick={closeMenusOnOutsideClick} onkeydown={closeMenusOnEscape} />
<div class="standalone-app">
  <header class="standalone-toolbar" aria-label="Standalone workspace">
    <strong>Shader Studio</strong>
    <div class="toolbar-menu">
      <button class="menu-trigger" aria-expanded={viewMenuOpen} aria-haspopup="menu" onclick={toggleViewMenu}>
        View <span class="dropdown-indicator" data-testid="dropdown-indicator" aria-hidden="true"></span>
      </button>
      {#if viewMenuOpen}
        <div class="dropdown-menu" role="menu" aria-label="View">
          <button role="menuitemcheckbox" aria-checked={panelVisibility.explorer} onclick={() => togglePanel('explorer')}>
            <span aria-hidden="true">{panelVisibility.explorer ? '✓' : ''}</span> Shader Explorer
          </button>
          <button role="menuitemcheckbox" aria-checked={panelVisibility.editor} onclick={() => togglePanel('editor')}>
            <span aria-hidden="true">{panelVisibility.editor ? '✓' : ''}</span> Editor
          </button>
          <button role="menuitemcheckbox" aria-checked={panelVisibility.preview} onclick={() => togglePanel('preview')}>
            <span aria-hidden="true">{panelVisibility.preview ? '✓' : ''}</span> Preview
          </button>
        </div>
      {/if}
    </div>
    <div class="toolbar-menu workspace-menu">
      <button class="menu-trigger" aria-expanded={workspaceMenuOpen} aria-haspopup="menu" onclick={toggleWorkspaceMenu}>
        Workspace <span class="dropdown-indicator" data-testid="dropdown-indicator" aria-hidden="true"></span>
      </button>
      {#if workspaceMenuOpen}
        <div class="dropdown-menu" role="menu" aria-label="Workspace">
          <button onclick={resetLayout}>Reset workspace layout</button>
          <button onclick={exportWorkspace}>Export Workspace Backup</button>
          <button onclick={() => workspaceFileInput.click()}>Import Workspace Backup…</button>
          {#if storageStatus?.backend === 'indexeddb' && storageStatus.persistSupported && !storageStatus.persisted}
            <button onclick={requestPersistentStorage}>Protect local storage</button>
          {/if}
          {#if pwaStatus.supported}
            <button onclick={() => pwa?.checkForUpdate()}>Check for Updates</button>
            {#if pwaStatus.offlinePreparation.state === 'preparing'}
              <button onclick={() => pwa?.cancelOfflinePreparation()}>
                Cancel Offline Preparation ({pwaStatus.offlinePreparation.completed}/{pwaStatus.offlinePreparation.total})
              </button>
            {:else if pwaStatus.offlinePreparation.state !== 'ready'}
              <button onclick={prepareOffline}>
                {pwaStatus.offlinePreparation.state === 'idle'
                  ? 'Download compilers for offline use'
                  : 'Retry offline compiler download'}
              </button>
            {/if}
          {/if}
          <button class="danger-action" onclick={clearWorkspace}>Clear Workspace</button>
        </div>
      {/if}
    </div>
    <a class="toolbar-right" href="https://teaqu.github.io/shader-studio/docs/" target="_blank" rel="noopener noreferrer">Documentation</a>
    <a href="https://github.com/teaqu/shader-studio" target="_blank" rel="noopener noreferrer">GitHub</a>
    <span class="build-status" title={pwaStatus.buildId ? `Build ${pwaStatus.buildId}` : 'Development build'}>
      {pwaStatus.online ? 'Online' : 'Offline'} · {saveStatusLabel()}{pwaStatus.offlinePreparation.state === 'ready' ? ' · Ready offline' : ''}
    </span>
    {#if pwaStatus.updateAvailable}<button class="update-action" onclick={applyUpdate}>Update ready</button>{/if}
  </header>
  <input class="visually-hidden" bind:this={workspaceFileInput} type="file" accept="application/json,.json" onchange={importWorkspace} />
  {#if alphaNoticeVisible}
    <aside class="alpha-notice" data-testid="web-alpha-warning" role="note">
      <span>
        Standalone mode is in <strong>alpha</strong> and is buggy and missing features compared to the VS Code extension.
        Changes are saved only in this browser. Clearing browser data will delete them.
      </span>
      <button class="dismiss-alpha-notice" aria-label="Dismiss alpha notice" title="Dismiss" onclick={dismissAlphaNotice}>×</button>
    </aside>
  {/if}
  {#if workspaceError}<p role="alert">{workspaceError}</p>{/if}
  {#if pwaStatus.offlinePreparation.state === 'error'}
    <p class="shell-status-error" role="alert">Offline preparation failed: {pwaStatus.offlinePreparation.message}</p>
  {/if}
  <StandaloneLayout bind:this={layout} {hostedPanels} {transport}>
    {#snippet explorer()}
      <ShaderExplorer hostApi={explorerApi} compact={true} selectedShaderPath={session?.selectedShaderPath ?? ''} />
    {/snippet}
    {#snippet editor()}
      <div class="panel-content" data-testid="web-editor"><EditorPane {transport} /></div>
    {/snippet}
    {#snippet preview()}
      <div class="panel-content" data-testid="web-preview"><ShaderStudioApp /></div>
    {/snippet}
  </StandaloneLayout>
  {#if getNewShaderVisible()}
    <NewShaderModal onCreate={createShader} onClose={() => setNewShaderVisible(false)} />
  {/if}
</div>

<style>
  .standalone-app { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .standalone-toolbar { position: relative; z-index: 10; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  .standalone-toolbar button, .standalone-toolbar a { font: inherit; color: var(--vscode-foreground); background: transparent; border-radius: 4px; padding: 4px 8px; text-decoration: none; cursor: pointer; }
  .standalone-toolbar button:hover, .standalone-toolbar a:hover { background: var(--vscode-list-hoverBackground); }
  .standalone-toolbar a { border: 1px solid var(--vscode-panel-border); }
  .menu-trigger { display: inline-flex; align-items: center; gap: 6px; border: 0; }
  .dropdown-indicator { width: 0; height: 0; border-right: 4px solid transparent; border-left: 4px solid transparent; border-top: 5px solid currentColor; opacity: 0.8; }
  .toolbar-menu { position: relative; }
  .toolbar-right { margin-left: auto; }
  .workspace-menu { padding-left: 8px; border-left: 1px solid var(--vscode-panel-border); }
  .dropdown-menu { position: absolute; top: calc(100% + 4px); left: 0; display: grid; min-width: 190px; padding: 4px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-sideBar-background)); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }
  .dropdown-menu button { display: grid; grid-template-columns: 16px 1fr; gap: 4px; width: 100%; border: 0; text-align: left; white-space: nowrap; }
  .dropdown-menu button:not([role="menuitemcheckbox"]) { display: block; }
  .dropdown-menu .danger-action { color: var(--vscode-errorForeground, #f48771); }
  .alpha-notice { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 3px 10px; font-size: 11px; text-align: center; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
  .dismiss-alpha-notice { flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; color: inherit; background: transparent; font: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
  .dismiss-alpha-notice:hover { background: var(--vscode-list-hoverBackground); }
  .panel-content { height: 100%; width: 100%; min-height: 0; min-width: 0; }
  .build-status { white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; }
  .standalone-toolbar .update-action { border: 1px solid var(--vscode-focusBorder); }
  .visually-hidden { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

  @media (max-width: 767px) {
    .standalone-app { height: 100dvh; }
    .standalone-toolbar { min-height: 44px; padding: max(4px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left)); }
    .standalone-toolbar > strong { flex: 1; }
    .standalone-toolbar > a { display: none; }
    .standalone-toolbar button { min-height: 44px; }
    .workspace-menu { padding-left: 0; border-left: 0; }
    .build-status { position: absolute; top: calc(100% + 1px); right: max(8px, env(safe-area-inset-right)); z-index: 1; padding: 2px 6px; border-radius: 0 0 4px 4px; background: var(--vscode-sideBar-background); }
    .dropdown-menu { position: fixed; top: max(54px, calc(env(safe-area-inset-top) + 50px)); right: 8px; left: 8px; max-height: calc(100dvh - 120px); overflow: auto; }
    .alpha-notice { padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right)); }
    :global(.standalone-app .menu-bar .collapse-config, .standalone-app .menu-bar .collapse-debug, .standalone-app .menu-bar .collapse-record) { display: none; }
  }
</style>
