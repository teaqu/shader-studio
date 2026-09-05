<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, setContext } from 'svelte';
  import { PANEL_HOST_CONTEXT } from '@shader-studio/ui/lib/layout/PanelHost';
  import { HostedPanels } from './HostedPanels';
  import { ShaderStudioApp, getViewerSession } from '@shader-studio/ui';
  import ShaderExplorer from '@shader-studio/shader-explorer/lib/components/ShaderExplorer.svelte';
  import StandaloneLayout from './StandaloneLayout.svelte';
  import EditorPane from './EditorPane.svelte';
  import NewShaderModal from './NewShaderModal.svelte';
  import type { WebTransport } from './WebTransport';
  import {
    getSelectedEditor, selectEditor, getRequestedEditor, requestEditor, getNewShaderVisible, getRequestedPanel, requestPanel,
    resetShellState, setNewShaderVisible,
  } from './state/shellState.svelte';
  import { clearStandaloneWorkspace } from './clearWorkspace';

  interface Props { transport: WebTransport; }
  let { transport }: Props = $props();
  const hostedPanels = new HostedPanels();
  setContext(PANEL_HOST_CONTEXT, hostedPanels);
  let layout = $state<StandaloneLayout>();
  let workspaceError = $state('');
  let viewMenuOpen = $state(false);
  let workspaceMenuOpen = $state(false);
  let panelVisibility = $state({ explorer: true, editor: true, preview: true });
  const session = $derived(getViewerSession());
  const explorerApi = transport.getShaderExplorerHostApi();

  $effect(() => {
    const panel = getRequestedPanel();
    if (panel && layout) {
      layout.showPanel(panel);
      requestPanel(null);
    }
  });

  $effect(() => {
    const path = getRequestedEditor();
    if (path && layout) {
      layout.openEditor(path); requestEditor(null);
    }
  });

  $effect(() => {
    const path = getSelectedEditor();
    if (path && layout) {
      layout.selectEditor(path);
      selectEditor(null);
    }
  });

  function createShader(name: string, language: 'glsl' | 'slang') {
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
          <button class="danger-action" onclick={clearWorkspace}>Clear Workspace</button>
        </div>
      {/if}
    </div>
    <a class="toolbar-right" href="https://teaqu.github.io/shader-studio/docs/" target="_blank" rel="noopener noreferrer">Documentation</a>
    <a href="https://github.com/teaqu/shader-studio" target="_blank" rel="noopener noreferrer">GitHub</a>
  </header>
  <aside class="alpha-notice" data-testid="web-alpha-warning" role="note">
    Standalone mode is in <strong>alpha</strong> and is buggy and missing features compared to the VS Code extension.
    Changes are saved only in this browser. Clearing browser data will delete them.
  </aside>
  {#if workspaceError}<p role="alert">{workspaceError}</p>{/if}
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
  .alpha-notice { padding: 3px 10px; font-size: 11px; text-align: center; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
  .panel-content { height: 100%; width: 100%; min-height: 0; min-width: 0; }
</style>
