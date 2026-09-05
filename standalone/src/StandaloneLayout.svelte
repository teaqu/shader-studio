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
  import { StandaloneLayoutController, type StandalonePanelId } from './StandaloneLayoutController';
  import { getViewerSession } from '@shader-studio/ui/lib/state/viewerSession.svelte';
  import EditorPane from './EditorPane.svelte';
  import type { WebTransport } from './WebTransport';
  import { HostedPanels } from './HostedPanels';
  import type { HostedPanelId } from '@shader-studio/ui/lib/layout/PanelHost';

  interface Props {
    transport?: WebTransport;
    explorer: Snippet;
    editor: Snippet;
    preview: Snippet;
    hostedPanels?: HostedPanels;
  }

  let { transport, explorer, editor, preview, hostedPanels = new HostedPanels() }: Props = $props();

  let dockviewElement: HTMLElement;
  let sourceElement: HTMLElement;
  let explorerSource: HTMLElement;
  let editorSource: HTMLElement;
  let previewSource: HTMLElement;
  let controller = $state<StandaloneLayoutController | null>(null);
  let dockviewApi: DockviewApi | null = null;
  let dropDisposable: DockviewIDisposable | null = null;

  $effect(() => {
    controller?.setEditorPath(getViewerSession()?.shaderPath ?? '');
  });

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
    }

    dispose(): void {
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
    sources.set('editor', editorSource);
    sources.set('preview', previewSource);

    dockviewApi = createDockview(dockviewElement, {
      createComponent: (options) => ['debug', 'config', 'performance', 'recording'].includes(options.name)
        ? hostedPanels.createRenderer(options.name as HostedPanelId)
        : options.name === 'file-editor' ? new FileEditorRenderer()
        : new StableSourceRenderer(options.name as StandalonePanelId),
      theme: { ...themeVisualStudio, name: 'shader-studio-standalone', className: 'shader-studio-standalone-theme' },
      disableFloatingGroups: true,
    });
    dropDisposable = dockviewApi.onWillDrop((event: DockviewWillDropEvent) => {
      if (event.getData()?.viewId !== dockviewApi?.id) {
        event.preventDefault();
      }
    });
    hostedPanels.connect(dockviewApi, () => controller?.resetLayout());
    controller = new StandaloneLayoutController(dockviewApi, undefined, (path) => {
      transport?.getShaderExplorerHostApi().postMessage({ type: 'activateShader', path });
    });
    // Establish the available size before assigning default panel widths.
    dockviewApi.layout(dockviewElement.clientWidth, dockviewElement.clientHeight);
    controller.initialize();
    hostedPanels.restoreVisiblePanels();
  });

  onDestroy(() => {
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
  }
</script>

<div class="standalone-layout">
  <div class="standalone-dockview" bind:this={dockviewElement}></div>
  <div class="standalone-panel-sources" bind:this={sourceElement} aria-hidden="true">
    <div class="standalone-panel-source" bind:this={explorerSource}>{@render explorer()}</div>
    <div class="standalone-panel-source" bind:this={editorSource}>{@render editor()}</div>
    <div class="standalone-panel-source" bind:this={previewSource}>{@render preview()}</div>
  </div>
</div>

<style>
  :global(.shader-studio-standalone-theme) {
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
  .standalone-dockview { flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
  .standalone-dockview :global(.dv-content-container) { min-width: 0; min-height: 0; }
  .standalone-panel-sources { display: none; }
  .standalone-panel-source, :global(.standalone-panel-content) { width: 100%; height: 100%; min-width: 0; min-height: 0; }
</style>
