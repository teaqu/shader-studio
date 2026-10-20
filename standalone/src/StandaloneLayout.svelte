<svelte:options runes={true} />

<script lang="ts">
  import { mount, unmount, onDestroy, onMount, type Snippet } from 'svelte';
  import {
    createDockview,
    themeVisualStudio,
    type DockviewApi,
    type DockviewIDisposable,
    type DockviewWillDropEvent,
    type GroupPanelPartInitParameters,
    type IContentRenderer,
  } from 'dockview-core';
  import 'dockview-core/dist/styles/dockview.css';
  import { setupDockviewTabs, createShaderTab } from '@shader-studio/ui/lib/layout/dockviewTabs';
  import { StandaloneLayoutController, type StandalonePanelId } from './StandaloneLayoutController';
  import { StandalonePanelSizing } from './StandalonePanelSizing';
  import { getViewerSession } from '@shader-studio/ui/lib/state/viewerSession.svelte';
  import { getActiveShaderEditors } from './state/shellState.svelte';
  import EditorPane from './EditorPane.svelte';
  import type { WebTransport } from './WebTransport';
  import { HostedPanels } from './HostedPanels';
  import { getEditorPreferences } from './settings/settingsState.svelte';
  import type { HostedPanelId } from '@shader-studio/ui/lib/layout/PanelHost';
  import {
    getMobilePanel,
    isMobileViewport,
    isMobileKeyboardOpen,
    setMobilePanel,
    setMobileViewport,
    type MobileShellPanel,
  } from './state/mobileShellState.svelte';

  interface Props {
    transport?: WebTransport;
    explorer: Snippet;
    files?: Snippet;
    editor: Snippet;
    preview: Snippet;
    /** Workspace controls and status shown beside the Shaders and Files tabs on phones. */
    studio?: Snippet;
    /** Banners shown above Shaders and Files on phones. */
    studioNotices?: Snippet;
    hostedPanels?: HostedPanels;
  }

  let { transport, explorer, files, editor, preview, studio, studioNotices, hostedPanels = new HostedPanels() }: Props = $props();

  let dockviewElement: HTMLElement;
  let sourceElement: HTMLElement;
  let explorerSource: HTMLElement;
  let filesSource: HTMLElement;
  let editorSource: HTMLElement;
  let previewSource: HTMLElement;
  let previewDestination = $state.raw<HTMLElement | null>(null);
  let backdropElement = $state<HTMLDivElement>();
  let controller = $state<StandaloneLayoutController | null>(null);
  let dockviewApi: DockviewApi | null = null;
  let panelSizing: StandalonePanelSizing | null = null;
  let disposeTabVisibility: (() => void) | undefined;
  let dropDisposable: DockviewIDisposable | null = null;
  let removeViewportListener: (() => void) | null = null;
  let activeMobileTool = $state<HostedPanelId>('config');
  const MOBILE_TOOLS = [['config', 'Config'], ['debug', 'Debug'], ['performance', 'Frame Times'], ['recording', 'Export'], ['vr', 'VR']] as const;
  const MOBILE_DESTINATIONS = [['explorer', 'Studio'], ['editor', 'Editor'], ['preview', 'Preview'], ['tools', 'Tools']] as const;
  const EDITOR_DESTINATIONS = [['editor', 'Editor'], ['preview', 'Preview']] as const;
  const EXPLORER_SECTIONS = [['explorer', 'Shaders'], ['files', 'Files']] as const;
  type ExplorerSection = typeof EXPLORER_SECTIONS[number][0];
  /** Shaders and Files share the phone Studio destination; this remembers which was last open. */
  let explorerSection = $state<ExplorerSection>('explorer');
  const mobilePanel = $derived(getMobilePanel());
  const mobileViewport = $derived(isMobileViewport());
  const keyboardNavigation = $derived(isMobileKeyboardOpen() && getEditorPreferences().mobileNavigation);
  const shaderBackdrop = $derived(mobileViewport && mobilePanel === 'editor' && getEditorPreferences().mobileShaderBackdrop);

  // Reuse the mounted preview and GPU canvas. Keep the current Dockview host
  // reactive so layout resets can replace it while the backdrop is enabled.
  $effect(() => {
    const target = shaderBackdrop ? backdropElement : previewDestination;
    if (target && previewSource && previewSource.parentElement !== target) {
      target.append(previewSource);
      panelSizing?.refresh();
    }
  });

  $effect(() => {
    controller?.setEditorPath(getViewerSession()?.shaderPath ?? '');
  });

  $effect(() => {
    void controller?.syncShaderEditors(getActiveShaderEditors());
  });

  $effect(() => {
    if (!controller) {
      return;
    }
    if (!mobileViewport) {
      controller.restoreDesktopPanels(() => panelSizing?.refresh());
      panelSizing?.refresh();
      return;
    }
    if (mobilePanel === 'tools') {
      activeMobileTool = hostedPanels.getLastSelectedTool();
      controller.showMobileDockviewPanel(hostedPanels.showLastSelectedTool());
      panelSizing?.refresh();
      return;
    }
    controller.showMobilePanel(mobilePanel);
    panelSizing?.refresh();
  });

  $effect(() => {
    if (isExplorerSection(mobilePanel)) {
      explorerSection = mobilePanel;
    }
  });

  function isExplorerSection(panel: MobileShellPanel): panel is ExplorerSection {
    return panel === 'explorer' || panel === 'files';
  }

  function isDestinationCurrent(panelId: MobileShellPanel): boolean {
    return panelId === 'explorer' ? isExplorerSection(mobilePanel) : mobilePanel === panelId;
  }

  function selectDestination(panelId: MobileShellPanel): void {
    setMobilePanel(panelId === 'explorer' && files ? explorerSection : panelId);
  }

  const sources = new Map<StandalonePanelId, HTMLElement>();

  class StableSourceRenderer implements IContentRenderer {
    readonly element = document.createElement('div');
    private source: HTMLElement | null = null;
    private readonly panelId: StandalonePanelId;

    constructor(panelId: StandalonePanelId) {
      this.panelId = panelId;
      this.element.className = 'standalone-panel-content';
    }

    init(_parameters: GroupPanelPartInitParameters): void {
      this.source = sources.get(this.panelId) ?? null;
      if (this.source) {
        this.element.append(this.source);
      }
      if (this.panelId === 'preview') previewDestination = this.element;
    }

    dispose(): void {
      if (previewDestination === this.element) previewDestination = null;
      if (this.source && sourceElement) {
        sourceElement.append(this.source);
      }
    }
  }

  class FileEditorRenderer implements IContentRenderer {
    readonly element = document.createElement('div');
    private component: ReturnType<typeof mount> | null = null;
    init(parameters: GroupPanelPartInitParameters): void {
      this.element.className = 'standalone-panel-content';
      this.element.dataset.testid = 'file-editor';
      const path = parameters.params.path as string;
      this.element.dataset.path = path;
      this.component = mount(EditorPane, { target: this.element, props: { path, transport } });
    }
    dispose(): void {
      if (this.component) {
        void unmount(this.component);
      }
    }
  }

  onMount(() => {
    sources.set('explorer', explorerSource);
    sources.set('files', filesSource);
    sources.set('editor', editorSource);
    sources.set('preview', previewSource);

    dockviewApi = createDockview(dockviewElement, {
      defaultTabComponent: 'shader-tab',
      createTabComponent: createShaderTab,
      createComponent: (options) => ['debug', 'config', 'performance', 'recording', 'vr'].includes(options.name)
        ? hostedPanels.createRenderer(options.name as HostedPanelId)
        : options.name === 'file-editor' ? new FileEditorRenderer()
        : new StableSourceRenderer(options.name as StandalonePanelId),
      theme: { ...themeVisualStudio, name: 'shader-studio-standalone', className: 'shader-studio-standalone-theme' },
      disableFloatingGroups: true,
      disableAutoResizing: true,
    });
    dropDisposable = dockviewApi.onWillDrop((event: DockviewWillDropEvent) => {
      if (event.getData()?.viewId !== dockviewApi?.id) {
        event.preventDefault();
      }
    });
    hostedPanels.connect(dockviewApi, () => {
      controller?.resetLayout();
      panelSizing?.reset();
    });
    disposeTabVisibility = setupDockviewTabs(dockviewElement, dockviewApi);
    controller = new StandaloneLayoutController(dockviewApi, undefined, (path) => {
      transport?.getShaderExplorerHostApi().postMessage({ type: 'activateShader', path });
    }, path => transport?.confirmEditorClose(path) ?? Promise.resolve(true));
    // Establish the available size before assigning default panel widths.
    dockviewApi.layout(dockviewElement.clientWidth, dockviewElement.clientHeight);
    controller.initialize();
    hostedPanels.restoreVisiblePanels();
    panelSizing = new StandalonePanelSizing(dockviewApi, dockviewElement, isMobileViewport);

    const media = window.matchMedia?.('(max-width: 767px)');
    if (!media) {
      setMobileViewport(false);
      return;
    }
    const updateViewport = () => setMobileViewport(media.matches);
    updateViewport();
    media.addEventListener('change', updateViewport);
    removeViewportListener = () => media.removeEventListener('change', updateViewport);
  });

  onDestroy(() => {
    disposeTabVisibility?.();
    removeViewportListener?.();
    removeViewportListener = null;
    panelSizing?.dispose();
    panelSizing = null;
    hostedPanels.dispose();
    controller?.dispose();
    controller = null;
    dropDisposable?.dispose();
    dropDisposable = null;
    dockviewApi?.dispose();
    dockviewApi = null;
  });

  export function selectEditor(path: string): void {
    controller?.selectEditor(path);
  }

  export function openEditor(path: string): void {
    controller?.openEditor(path);
  }

  export function closeEditorPaths(paths: readonly string[]): void {
    controller?.closeEditorPaths(paths);
  }

  export function showPanel(panelId: StandalonePanelId): void {
    controller?.showPanel(panelId);
  }

  export function isPanelVisible(panelId: StandalonePanelId): boolean {
    return controller?.isPanelVisible(panelId) ?? false;
  }

  export function togglePanel(panelId: StandalonePanelId): void {
    controller?.togglePanel(panelId);
  }

  export function resetLayout(): void {
    hostedPanels.resetLayout(() => controller?.resetLayout());
    panelSizing?.reset();
  }

  /** Selects the phone shell destination without altering the desktop layout. */
  export function selectMobilePanel(panelId: MobileShellPanel): void {
    setMobilePanel(panelId);
  }

  export function getSelectedMobilePanel(): MobileShellPanel {
    return getMobilePanel();
  }

  export function isMobileLayout(): boolean {
    return isMobileViewport();
  }

  export function selectMobileTool(panelId: HostedPanelId): void {
    activeMobileTool = panelId;
    setMobilePanel('tools');
    controller?.showMobileDockviewPanel(hostedPanels.showTool(panelId));
  }
</script>

<div class:mobile-layout={mobileViewport} class:keyboard-open={isMobileKeyboardOpen()} class:keyboard-navigation={keyboardNavigation} class="standalone-layout" data-mobile-panel={mobilePanel}>
  {#if mobileViewport && studioNotices && isExplorerSection(mobilePanel)}
    <div class="mobile-studio-notices">{@render studioNotices()}</div>
  {/if}
  <div class="standalone-stage" class:shader-backdrop-active={shaderBackdrop}>
    <div class="mobile-preview-backdrop" hidden={!shaderBackdrop} inert aria-hidden="true" bind:this={backdropElement}></div>
    <div class="standalone-dockview" bind:this={dockviewElement}></div>
  </div>
  <div class="standalone-panel-sources" bind:this={sourceElement} aria-hidden="true">
    <div class="standalone-panel-source" bind:this={explorerSource}>{@render explorer()}</div>
    <div class="standalone-panel-source" bind:this={filesSource}>{@render files?.()}</div>
    <div class="standalone-panel-source" bind:this={editorSource}>{@render editor()}</div>
    <div class="standalone-panel-source" bind:this={previewSource}>{@render preview()}</div>
  </div>
  {#if mobileViewport}
    {#if mobilePanel === 'tools'}
      <nav class="mobile-tools-navigation" aria-label="Tools">
        {#each MOBILE_TOOLS as [panelId, label]}
          <button
            class:active={activeMobileTool === panelId}
            aria-current={activeMobileTool === panelId ? 'page' : undefined}
            onclick={() => selectMobileTool(panelId)}
          >{label}</button>
        {/each}
      </nav>
    {/if}
    {#if (files || studio) && isExplorerSection(mobilePanel)}
      <div class="mobile-studio-row">
        {#if files}
          <nav class="mobile-tools-navigation" aria-label="Studio sections">
            {#each EXPLORER_SECTIONS as [panelId, label]}
              <button
                class:active={mobilePanel === panelId}
                aria-current={mobilePanel === panelId ? 'page' : undefined}
                onclick={() => setMobilePanel(panelId)}
              >{label}</button>
            {/each}
          </nav>
        {/if}
        {#if studio}<div class="mobile-studio-actions">{@render studio()}</div>{/if}
      </div>
    {/if}
    {#if keyboardNavigation}
      <nav class="mobile-editor-navigation" aria-label="Editor and preview">
        {#each EDITOR_DESTINATIONS as [panelId, label] (panelId)}
          <button type="button"
            class:active={mobilePanel === panelId}
            aria-current={mobilePanel === panelId ? 'page' : undefined}
            onmousedown={event => event.preventDefault()}
            onclick={() => selectDestination(panelId)}
          >{label}</button>
        {/each}
      </nav>
    {:else if !isMobileKeyboardOpen()}
      <nav class="mobile-panel-navigation" aria-label="Workspace panels">
        {#each MOBILE_DESTINATIONS as [panelId, label]}
          <button
            class:active={isDestinationCurrent(panelId)}
            aria-current={isDestinationCurrent(panelId) ? 'page' : undefined}
            onclick={() => selectDestination(panelId)}
          >{label}</button>
        {/each}
      </nav>
    {/if}
  {/if}
</div>

<style>
  :global(.shader-studio-standalone-theme) {
    --dv-tabs-and-actions-container-height: var(--shader-studio-tab-height);
    --dv-tab-font-size: var(--shader-studio-font-size);
    --dv-activegroup-visiblepanel-tab-background-color: var(--vscode-tab-activeBackground, var(--vscode-editor-background));
    --dv-activegroup-visiblepanel-tab-color: var(--vscode-tab-activeForeground, var(--vscode-editor-foreground));
    --dv-activegroup-hiddenpanel-tab-background-color: var(--vscode-tab-inactiveBackground, transparent);
    --dv-activegroup-hiddenpanel-tab-color: var(--vscode-tab-inactiveForeground, var(--vscode-editor-foreground));
    --dv-inactivegroup-visiblepanel-tab-background-color: var(--vscode-tab-unfocusedActiveBackground, var(--vscode-editor-background));
    --dv-inactivegroup-visiblepanel-tab-color: var(--vscode-tab-unfocusedActiveForeground, var(--vscode-editor-foreground));
    --dv-inactivegroup-hiddenpanel-tab-background-color: var(--vscode-tab-inactiveBackground, transparent);
    --dv-inactivegroup-hiddenpanel-tab-color: var(--vscode-tab-inactiveForeground, var(--vscode-editor-foreground));
    --dv-tab-divider-color: var(--vscode-tab-border, var(--vscode-panel-border));
    --dv-group-view-background-color: var(--vscode-editor-background);
    --dv-tabs-and-actions-container-background-color: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background));
    --dv-tabs-container-scrollbar-color: var(--vscode-scrollbarSlider-background, rgba(100, 100, 100, 0.4));
    --dv-separator-border: var(--vscode-panel-border);
    --dv-drag-over-background-color: var(--vscode-editorGroup-dropBackground, rgba(0, 127, 212, 0.25));
    --dv-drag-over-border: 2px solid var(--vscode-focusBorder, #007fd4);
    --dv-drag-over-border-color: var(--vscode-focusBorder, #007fd4);
  }

  .standalone-layout { display: flex; flex: 1; min-height: 0; min-width: 0; }
  .standalone-stage { position: relative; display: flex; flex: 1; min-height: 0; min-width: 0; }
  .mobile-preview-backdrop { position: absolute; inset: 0; pointer-events: none; user-select: none; overflow: hidden; }
  .mobile-preview-backdrop :global(.menu-bar) { display: none; }
  .shader-backdrop-active > .standalone-dockview { position: relative; z-index: 1; }
  /* Dockview inserts its theme inside the host. Override the variable there:
     setting it on the host is shadowed by the theme's opaque editor background. */
  .shader-backdrop-active > .standalone-dockview :global(.shader-studio-standalone-theme) {
    --dv-group-view-background-color: transparent;
  }
  .standalone-dockview { flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
  .standalone-dockview :global(.dv-content-container) { min-width: 0; min-height: 0; }
  .standalone-panel-sources { display: none; }
  .standalone-panel-source, :global(.standalone-panel-content) { width: 100%; height: 100%; min-width: 0; min-height: 0; }
  .mobile-panel-navigation { display: none; }
  .mobile-editor-navigation { display: none; }
  .mobile-tools-navigation { display: none; }
  .mobile-studio-notices { flex: 0 0 auto; min-width: 0; }

  @media (max-width: 767px) {
    .standalone-layout.mobile-layout { position: relative; flex-direction: column; padding-bottom: env(safe-area-inset-bottom); }
    .standalone-layout.mobile-layout.keyboard-open { padding-bottom: 0; }
    .standalone-layout.mobile-layout.keyboard-navigation { --mobile-editor-switch-width: 150px; }
    .mobile-editor-navigation {
      position: absolute;
      left: 6px;
      bottom: calc(6px + var(--mobile-keyboard-inset, 0px));
      z-index: 3;
      display: flex;
      width: 144px;
      box-sizing: border-box;
      padding: 2px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      box-shadow: 0 1px 5px rgb(0 0 0 / 18%);
    }
    .mobile-editor-navigation button {
      flex: 1;
      min-width: 0;
      min-height: 32px;
      padding: 4px;
      border: 0;
      border-radius: 5px;
      font-size: 13px;
      color: var(--vscode-foreground);
      background: transparent;
      touch-action: manipulation;
    }
    .mobile-editor-navigation button.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .standalone-dockview { min-height: 0; }
    /* The bottom navigation replaces panel tabs, except the Editor's open-file tabs. */
    .mobile-layout:not([data-mobile-panel='editor']) .standalone-dockview :global(.dv-tabs-and-actions-container) { display: none; }
    .mobile-panel-navigation {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 2px;
      flex: 0 0 auto;
      padding: 6px max(8px, env(safe-area-inset-right)) 6px max(8px, env(safe-area-inset-left));
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .mobile-tools-navigation {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      flex: 0 0 auto;
      padding: 6px max(8px, env(safe-area-inset-right)) 2px max(8px, env(safe-area-inset-left));
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .mobile-tools-navigation button {
      min-height: 44px;
      padding: 6px 12px;
      border: 0;
      border-radius: var(--shader-studio-control-radius);
      color: var(--vscode-foreground);
      background: transparent;
      font: inherit;
      white-space: nowrap;
    }
    .mobile-tools-navigation button.active { background: var(--vscode-list-hoverBackground); }
    /* The Studio sections share their row with the workspace controls; the
       row anchors the Workspace menu, which opens upwards over the panel. */
    .mobile-studio-row {
      position: relative;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      padding: 6px max(8px, env(safe-area-inset-right)) 2px max(8px, env(safe-area-inset-left));
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
    }
    .mobile-studio-row .mobile-tools-navigation { flex: 0 0 auto; padding: 0; border-top: 0; background: transparent; }
    .mobile-studio-actions { display: flex; flex: 1 1 auto; justify-content: flex-end; min-width: 0; }
    .mobile-panel-navigation button {
      min-height: 44px;
      padding: 6px 4px;
      border: 0;
      border-radius: var(--shader-studio-control-radius);
      color: var(--vscode-foreground);
      background: transparent;
      font: inherit;
    }
    .mobile-panel-navigation button.active { background: var(--vscode-list-hoverBackground); }
  }
</style>
