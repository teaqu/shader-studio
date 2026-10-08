<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, onMount, setContext } from 'svelte';
  import { PANEL_HOST_CONTEXT } from '@shader-studio/ui/lib/layout/PanelHost';
  import { HostedPanels } from './HostedPanels';
  import { ShaderStudioApp, getViewerSession } from '@shader-studio/ui';
  import ShaderExplorer from '@shader-studio/shader-explorer/lib/components/ShaderExplorer.svelte';
  import StandaloneLayout from './StandaloneLayout.svelte';
  import EditorPane from './EditorPane.svelte';
  import SettingsPanel from './settings/SettingsPanel.svelte';
  import { connectSettings, getDefaultShaderMode } from './settings/settingsState.svelte';
  import WorkspaceFilePicker from './WorkspaceFilePicker.svelte';
  import NewShaderModal from './NewShaderModal.svelte';
  import type { WebTransport, WorkspaceStorageStatus } from './WebTransport';
  import {
    getSelectedEditor, selectEditor, getRequestedEditor, requestEditor, getNewShaderVisible, getRequestedPanel, requestPanel,
    resetShellState, setNewShaderVisible,
  } from './state/shellState.svelte';
  import { clearStandaloneWorkspace } from './clearWorkspace';
  import type { ShaderLanguageId, WebGPUAuthoringMode } from '@shader-studio/types';
  import type { PwaController, PwaStatus } from './pwa';
  import type { WorkspacePersistenceStatus } from './VirtualWorkspace';

  interface Props { transport: WebTransport; pwa?: PwaController; }
  const ALPHA_NOTICE_DISMISSED_KEY = 'shader-studio.alpha-notice-dismissed';
  const STORAGE_PROTECTION_ATTEMPTED_KEY = 'shader-studio.storage-protection-attempted';

  function claimAutomaticStorageRequest(): boolean {
    try {
      if (localStorage.getItem(STORAGE_PROTECTION_ATTEMPTED_KEY) === 'true') {
        return false;
      }
      localStorage.setItem(STORAGE_PROTECTION_ATTEMPTED_KEY, 'true');
      return true;
    } catch {
      // Without a remembered decision, keep requests manual to avoid repeated prompts.
      return false;
    }
  }


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
  const disconnectSettings = connectSettings(transport.settings);
  onDestroy(disconnectSettings);
  let settingsOpen = $state(false);
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
  let storageProtectionPending = $state(false);
  const storageWarning = $derived(storageStatus && !storageStatus.persisted && !storageProtectionPending
    ? storageStatus.backend === 'session'
      ? 'Session-only: closing the app will lose your work. Export a workspace backup to keep it.'
      : `Work saves automatically. ${storageStatus.persisted === null ? 'Storage protection could not be confirmed.' : 'Storage protection is not enabled.'} The browser may remove local work if space runs low. Export workspace backups to keep a separate copy.`
    : '');
  let workspaceFileInput: HTMLInputElement;
  const session = $derived(getViewerSession());
  const explorerApi = transport.getShaderExplorerHostApi();
  let shellMounted = false;
  let updateInProgress = false;
  let updateApplied = false;

  onMount(() => {
    shellMounted = true;
    void transport.getStorageStatus?.().then(async (status) => {
      storageStatus = status;
      if (status.backend === 'indexeddb' && status.persistSupported && !status.persisted && claimAutomaticStorageRequest()) {
        await requestPersistentStorage();
      }
    }).catch(() => { /* Storage inspection must not interrupt editing. */ });
    const stopPersistence = transport.onPersistenceStatus?.((status) => {
      persistenceStatus = status;
      if (status.state === 'saved' && pwaStatus.updateAvailable) {
        void applyAutomaticUpdate();
      }
    }) ?? (() => {});
    const stopPwa = pwa?.subscribe((status) => {
      pwaStatus = status;
      if (status.updateAvailable) {
        void applyAutomaticUpdate();
      }
    }) ?? (() => {});
    return () => {
      shellMounted = false;
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

  function createShader(name: string, language: ShaderLanguageId, authoringMode?: WebGPUAuthoringMode) {
    transport.postMessage({ type: 'createShader', payload: { name, language, ...(authoringMode ? { authoringMode } : {}) } });
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

  async function applyAutomaticUpdate() {
    if (!shellMounted || updateInProgress || updateApplied) {
      return;
    }
    updateInProgress = true;
    workspaceError = '';
    try {
      await transport.flush();
      if (!shellMounted) {
        return;
      }
      await pwa?.applyUpdate();
      updateApplied = true;
    } catch {
      workspaceError = 'Could not save pending work, so the update was not applied.';
    } finally {
      updateInProgress = false;
    }
  }

  async function requestPersistentStorage() {
    if (storageProtectionPending) {
      return;
    }
    storageProtectionPending = true;
    try {
      storageStatus = await transport.requestPersistentStorage();
    } catch { /* Keep the current status and allow a manual retry. */ } finally {
      storageProtectionPending = false;
    }
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

  function saveStatusIcon(): string {
    if (storageStatus?.backend === 'session') {
      return 'codicon-warning';
    }
    if (persistenceStatus.state === 'error') {
      return 'codicon-error';
    }
    return persistenceStatus.state === 'saving' ? 'codicon-sync' : 'codicon-check';
  }

  function workspaceStatusLabel(): string {
    return `${pwaStatus.online ? 'Online' : 'Offline'} · ${saveStatusLabel()}${pwaStatus.offlinePreparation.state === 'ready' ? ' · Ready offline' : ''}`;
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
    if (!(event.target as Element).closest('.toolbar-menu, .storage-warning-icon')) {
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
<WorkspaceFilePicker />

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
            <button onclick={requestPersistentStorage} disabled={storageProtectionPending}>Request storage protection</button>
          {/if}
          {#if storageStatus}
            <p class="storage-notice" aria-live="polite">
              {#if storageStatus.backend === 'session'}
                Session-only: work will not survive closing the app. Export a workspace backup to keep it.
              {:else if storageProtectionPending}
                Work saves automatically. Requesting storage protection…
              {:else if storageStatus.persisted}
                Work saves automatically. Storage protection is enabled. Clearing site data still deletes your work; export backups to keep a separate copy.
              {:else}
                Work saves automatically.
                {storageStatus.persisted === null && storageStatus.persistSupported
                  ? 'Storage protection could not be confirmed.'
                  : storageStatus.persistSupported ? 'Storage protection has not been granted.' : 'Your browser does not support storage protection.'}
                The browser may remove local work if space runs low. Export workspace backups to keep a separate copy.
              {/if}
            </p>
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
    <button class="menu-trigger" onclick={() => {
      settingsOpen = true;
      viewMenuOpen = false;
      workspaceMenuOpen = false;
    }}>Settings</button>
    <a class="toolbar-right" href="https://teaqu.github.io/shader-studio/docs/" target="_blank" rel="noopener noreferrer">Documentation</a>
    <a href="https://github.com/teaqu/shader-studio" target="_blank" rel="noopener noreferrer">GitHub</a>
    <span
      class="build-status"
      role="status"
      aria-label={workspaceStatusLabel()}
      title={`${workspaceStatusLabel()} · ${pwaStatus.buildId ? `Build ${pwaStatus.buildId}` : 'Development build'}`}
    >
      <i class="codicon {pwaStatus.online ? 'codicon-cloud' : 'codicon-debug-disconnect'}" aria-hidden="true"></i>
      {#if storageStatus?.backend !== 'session'}
        <i class="codicon {saveStatusIcon()}" class:spinning={persistenceStatus.state === 'saving'} aria-hidden="true"></i>
      {/if}
      {#if storageWarning}
        <button class="storage-warning-icon" aria-label="Storage warning" aria-haspopup="menu" aria-expanded={workspaceMenuOpen} title={storageWarning} onclick={toggleWorkspaceMenu}>
          <i class="codicon codicon-warning" aria-hidden="true"></i>
        </button>
      {/if}
      {#if pwaStatus.offlinePreparation.state === 'ready'}
        <i class="codicon codicon-package" aria-hidden="true"></i>
      {/if}
    </span>
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
  {#if settingsOpen}
    <SettingsPanel settings={transport.settings} onClose={() => {
      settingsOpen = false;
    }} />
  {/if}
  {#if getNewShaderVisible()}
    <NewShaderModal defaultAuthoringMode={getDefaultShaderMode()} onCreate={createShader} onClose={() => setNewShaderVisible(false)} />
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
  .storage-notice { max-width: 280px; margin: 4px 0; padding: 8px 12px; font-size: 12px; line-height: 1.5; white-space: normal; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); }
  .build-status .storage-warning-icon { display: flex; align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; color: var(--vscode-editorWarning-foreground, #cca700); cursor: pointer; }
  .alpha-notice { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 3px 10px; font-size: 11px; text-align: center; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
  .dismiss-alpha-notice { flex: 0 0 auto; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; color: inherit; background: transparent; font: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
  .dismiss-alpha-notice:hover { background: var(--vscode-list-hoverBackground); }
  .panel-content { height: 100%; width: 100%; min-height: 0; min-width: 0; }
  .build-status { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 16px; }
  .build-status .spinning { animation: status-spin 1s linear infinite; }
  @keyframes status-spin { to { transform: rotate(360deg); } }
  .visually-hidden { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

  @media (max-width: 767px) {
    .standalone-app { height: 100dvh; }
    .standalone-toolbar { min-height: 44px; padding: max(4px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left)); }
    .standalone-toolbar > strong { flex: 1; }
    .standalone-toolbar > a { display: none; }
    .standalone-toolbar button { min-height: 44px; }
    .workspace-menu { padding-left: 0; border-left: 0; }
    .dropdown-menu { position: fixed; top: max(54px, calc(env(safe-area-inset-top) + 50px)); right: 8px; left: 8px; max-height: calc(100dvh - 120px); overflow: auto; }
    .alpha-notice { padding-inline: max(8px, env(safe-area-inset-left)) max(8px, env(safe-area-inset-right)); }
    :global(.standalone-app .menu-bar .collapse-config, .standalone-app .menu-bar .collapse-debug, .standalone-app .menu-bar .collapse-record) { display: none; }
  }
</style>
