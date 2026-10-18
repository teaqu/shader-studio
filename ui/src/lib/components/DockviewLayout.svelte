<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, getContext } from "svelte";
  import { PANEL_HOST_CONTEXT, type PanelHost, type HostedPanelId } from '../layout/PanelHost';
  import {
    createDockview,
    themeVisualStudio,
    type DockviewApi,
    type IContentRenderer,
    type GroupPanelPartInitParameters,
    type SerializedDockview,
  } from "dockview-core";
  import "dockview-core/dist/styles/dockview.css";
  import { setupDockviewTabs, createShaderTab } from "../layout/dockviewTabs";
  import type { Transport } from "../transport/MessageTransport";
  import { setCurrentLayout, getPendingLayout, hasPendingLayout, clearPendingLayout } from "../state/layoutState.svelte";
  import type { SerializedLayout } from "@shader-studio/types";

  const dispatch = createEventDispatcher<{
    ready: { api: DockviewApi | null; resetLayout: () => void; showPreview: () => void };
    previewVisibleChange: boolean;
    previewAloneChange: boolean;
    debugClosed: void;
    configClosed: void;
    performanceClosed: void;
    recordingClosed: void;
    toolRestored: HostedPanelId;
  }>();

  interface Props {
    mountPreview?: (container: HTMLElement) => (() => void) | void;
    mountDebug?: (container: HTMLElement) => (() => void) | void;
    mountConfig?: (container: HTMLElement) => (() => void) | void;
    mountPerformance?: (container: HTMLElement) => (() => void) | void;
    mountRecording?: (container: HTMLElement) => (() => void) | void;
    showDebugPanel?: boolean;
    showConfigPanel?: boolean;
    showPerformancePanel?: boolean;
    showRecordingPanel?: boolean;
    transport?: Transport | null;
  }

  let {
    mountPreview = () => {},
    mountDebug = () => {},
    mountConfig = () => {},
    mountPerformance = () => {},
    mountRecording = () => {},
    showDebugPanel = false,
    showConfigPanel = false,
    showPerformancePanel = false,
    showRecordingPanel = false,
    transport = null as Transport | null,
  }: Props = $props();

  let containerEl: HTMLElement;
  const panelHost = getContext<PanelHost | undefined>(PANEL_HOST_CONTEXT);
  const hostedCleanups: (() => void)[] = [];
  let api: DockviewApi | null = null;
  let dropListener: { dispose(): void } | undefined;
  let apiReady = $state(false);
  let layoutReady = $state(false);
  let programmaticRemoval = false;
  let isDestroying = false;
  let lastPreviewAlone: boolean | null = null;
  const panelSnapshots = new Map<string, SerializedDockview>();

  function checkPreviewAlone() {
    if (!api) {
      return;
    }
    const panel = api.getPanel("preview");
    const alone = panel ? panel.api.group.panels.length === 1 : false;
    if (alone !== lastPreviewAlone) {
      lastPreviewAlone = alone;
      dispatch("previewAloneChange", alone);
    }
  }

  const cleanupMap = new Map<string, () => void>();

  let disposeTabVisibility: (() => void) | undefined;

  class SvelteContentRenderer implements IContentRenderer {
    readonly element: HTMLElement;
    private panelId: string;
    private componentName: string;

    constructor(componentName: string) {
      this.componentName = componentName;
      this.element = document.createElement("div");
      this.element.style.height = "100%";
      this.element.style.width = "100%";
      this.element.style.overflow = "hidden";
      this.panelId = "";
    }

    init(params: GroupPanelPartInitParameters) {
      this.panelId = params.api.id;
      let mountFn: (container: HTMLElement) => (() => void) | void;

      switch (this.componentName) {
        case "preview":
          mountFn = mountPreview;
          break;
        case "debug":
          mountFn = mountDebug;
          break;
        case "config":
          mountFn = mountConfig;
          break;
        case "performance":
          mountFn = mountPerformance;
          break;
        case "recording":
          mountFn = mountRecording;
          break;
        default:
          return;
      }

      const cleanup = mountFn(this.element);
      if (cleanup) {
        cleanupMap.set(this.panelId, cleanup);
      }
    }

    dispose() {
      const cleanup = cleanupMap.get(this.panelId);
      if (cleanup) {
        cleanup();
        cleanupMap.delete(this.panelId);
      }
    }
  }

  function createDefaultLayout() {
    if (!api) {
      return;
    }

    api.addPanel({
      id: "preview",
      component: "preview",
      title: "Preview",
      renderer: "always",
    });

    if (showConfigPanel) {
      addConfigPanel();
    }
    if (showDebugPanel) {
      addDebugPanel();
    }
    if (showPerformancePanel) {
      addPerformancePanel();
    }
    if (showRecordingPanel) {
      addRecordingPanel();
    }
  }

  function tryRestoreFromSnapshot(panelId: string): boolean {
    if (!api) {
      return false;
    }
    const snapshot = panelSnapshots.get(panelId);
    if (!snapshot) {
      return false;
    }

    const snapshotPanelIds = new Set(Object.keys(snapshot.panels ?? {}));
    if (!snapshotPanelIds.has(panelId)) {
      return false;
    }

    const currentIds = new Set(api.panels.map((p) => p.id));
    const snapshotOtherIds = new Set(snapshotPanelIds);
    snapshotOtherIds.delete(panelId);

    if (snapshotOtherIds.size !== currentIds.size) {
      return false;
    }
    if (![...snapshotOtherIds].every((id) => currentIds.has(id))) {
      return false;
    }

    restoreFromData(snapshot);
    // The snapshot preserves whichever tab was active when this panel was
    // closed, so focus the just-reopened panel instead.
    api.getPanel(panelId)?.api.setActive();
    return true;
  }

  function addDebugPanel() {
    if (panelHost) {
      panelHost.setVisible('debug', true);
      return;
    }
    if (!api || api.getPanel("debug")) {
      return;
    }
    if (tryRestoreFromSnapshot("debug")) {
      return;
    }

    const tabRef = api.getPanel("config") ?? api.getPanel("performance");
    api.addPanel({
      id: "debug",
      component: "debug",
      title: "Debug",
      ...(tabRef
        ? { position: { referencePanel: tabRef.id, direction: "within" } }
        : { position: { referencePanel: "preview", direction: "below" }, initialHeight: 350 }),
    });
  }

  function removeDebugPanel() {
    if (panelHost) {
      panelHost.setVisible('debug', false);
      return;
    }
    if (!api) {
      return;
    }
    const panel = api.getPanel("debug");
    if (panel) {
      panelSnapshots.set("debug", api.toJSON());
      programmaticRemoval = true;
      api.removePanel(panel);
      programmaticRemoval = false;
    }
  }

  function addConfigPanel() {
    if (panelHost) {
      panelHost.setVisible('config', true);
      return;
    }
    if (!api || api.getPanel("config")) {
      return;
    }
    if (tryRestoreFromSnapshot("config")) {
      return;
    }

    const existingTab = api.getPanel("debug") ?? api.getPanel("performance");
    if (existingTab) {
      // Config is tab 1: evict existing bottom panels, add config standalone, re-add within.
      const siblingIds = existingTab.api.group.panels
        .filter((p) => p.id !== "config")
        .map((p) => p.id);

      for (const sid of siblingIds) {
        const p = api.getPanel(sid);
        if (p) {
          programmaticRemoval = true;
          api.removePanel(p);
          programmaticRemoval = false;
        }
      }

      api.addPanel({
        id: "config",
        component: "config",
        title: "Config",
        renderer: "always",
        position: { referencePanel: "preview", direction: "below" },
        initialHeight: 250,
      });

      for (const sid of siblingIds) {
        api.addPanel({
          id: sid,
          component: sid,
          title: sid.charAt(0).toUpperCase() + sid.slice(1),
          renderer: "always",
          position: { referencePanel: "config", direction: "within" },
          inactive: true,
        });
      }

      // Re-adding the siblings above would otherwise leave the last one active;
      // keep the just-opened config tab selected.
      api.getPanel("config")?.api.setActive();
    } else {
      api.addPanel({
        id: "config",
        component: "config",
        title: "Config",
        renderer: "always",
        position: { referencePanel: "preview", direction: "below" },
        initialHeight: 250,
      });
    }
  }

  function removeConfigPanel() {
    if (panelHost) {
      panelHost.setVisible('config', false);
      return;
    }
    if (!api) {
      return;
    }
    const panel = api.getPanel("config");
    if (panel) {
      panelSnapshots.set("config", api.toJSON());
      programmaticRemoval = true;
      api.removePanel(panel);
      programmaticRemoval = false;
    }
  }

  function addPerformancePanel() {
    if (panelHost) {
      panelHost.setVisible('performance', true);
      return;
    }
    if (!api || api.getPanel("performance")) {
      return;
    }
    if (tryRestoreFromSnapshot("performance")) {
      return;
    }

    const tabRef = api.getPanel("debug") ?? api.getPanel("config");
    api.addPanel({
      id: "performance",
      component: "performance",
      title: "Performance",
      ...(tabRef
        ? { position: { referencePanel: tabRef.id, direction: "within" } }
        : { position: { referencePanel: "preview", direction: "below" }, initialHeight: 200 }),
    });
  }

  function removePerformancePanel() {
    if (panelHost) {
      panelHost.setVisible('performance', false);
      return;
    }
    if (!api) {
      return;
    }
    const panel = api.getPanel("performance");
    if (panel) {
      panelSnapshots.set("performance", api.toJSON());
      programmaticRemoval = true;
      api.removePanel(panel);
      programmaticRemoval = false;
    }
  }

  function addRecordingPanel() {
    if (panelHost) {
      panelHost.setVisible('recording', true);
      return;
    }
    if (!api || api.getPanel("recording")) {
      return;
    }
    if (tryRestoreFromSnapshot("recording")) {
      return;
    }

    const tabRef = api.getPanel("debug") ?? api.getPanel("config") ?? api.getPanel("performance");
    api.addPanel({
      id: "recording",
      component: "recording",
      title: "Export",
      ...(tabRef
        ? { position: { referencePanel: tabRef.id, direction: "within" } }
        : { position: { referencePanel: "preview", direction: "below" }, initialHeight: 300 }),
    });
  }

  function removeRecordingPanel() {
    if (panelHost) {
      panelHost.setVisible('recording', false);
      return;
    }
    if (!api) {
      return;
    }
    const panel = api.getPanel("recording");
    if (panel) {
      panelSnapshots.set("recording", api.toJSON());
      programmaticRemoval = true;
      api.removePanel(panel);
      programmaticRemoval = false;
    }
  }

  function showPreview() {
    if (!api || api.getPanel("preview")) {
      return;
    }
    api.addPanel({
      id: "preview",
      component: "preview",
      title: "Preview",
      renderer: "always",
    });
    dispatch("previewVisibleChange", true);
  }

  function resetLayout() {
    if (!api) {
      return;
    }
    panelSnapshots.clear();
    api.clear();
    createDefaultLayout();
  }

  function restoreFromData(data: SerializedDockview | null) {
    if (!api) {
      return;
    }
    if (!isRestorableLayout(data)) {
      api.clear();
      createDefaultLayout();
      layoutReady = true;
      return;
    }
    try {
      programmaticRemoval = true;
      api.fromJSON(data);
      programmaticRemoval = false;
      if (api.panels.length === 0) {
        api.clear();
        createDefaultLayout();
      }
      layoutReady = true;
    } catch (e) {
      programmaticRemoval = false;
      console.warn("[DockviewLayout] fromJSON FAILED, falling back to default:", e);
      api.clear();
      createDefaultLayout();
      layoutReady = true;
    }
  }

  function isRestorableLayout(data: SerializedDockview | null | undefined): data is SerializedDockview {
    return !!data?.panels && Object.keys(data.panels).length > 0
      && (!panelHost || Object.keys(data.panels).every((id) => id === 'preview'));
  }

  // Force-read reactive deps before conditions to ensure they are tracked
  // even when the guard condition short-circuits.
  $effect(() => {
    const _debug = showDebugPanel;
    const _ready = layoutReady;
    if ((api || panelHost) && _ready) {
      if (_debug) {
        addDebugPanel();
      } else {
        removeDebugPanel();
      }
    }
  });

  $effect(() => {
    const _config = showConfigPanel;
    const _ready = layoutReady;
    if ((api || panelHost) && _ready) {
      if (_config) {
        addConfigPanel();
      } else {
        removeConfigPanel();
      }
    }
  });

  $effect(() => {
    const _perf = showPerformancePanel;
    const _ready = layoutReady;
    if ((api || panelHost) && _ready) {
      if (_perf) {
        addPerformancePanel();
      } else {
        removePerformancePanel();
      }
    }
  });

  $effect(() => {
    const _recording = showRecordingPanel;
    const _ready = layoutReady;
    if ((api || panelHost) && _ready) {
      if (_recording) {
        addRecordingPanel();
      } else {
        removeRecordingPanel();
      }
    }
  });

  $effect(() => {
    // apiReady is a reactive dep that ensures this effect re-runs after onMount sets up api.
    const _ready = apiReady;
    const hasLayoutRequest = hasPendingLayout();
    const pendingLayout = getPendingLayout();
    if (hasLayoutRequest && _ready && api) {
      restoreFromData(pendingLayout as unknown as SerializedDockview | null);
      clearPendingLayout();
    }
  });

  onMount(() => {
    if (panelHost) {
      hostedCleanups.push(
        panelHost.register('debug', { mount: mountDebug, onClose: () => dispatch('debugClosed'), onShow: () => dispatch('toolRestored', 'debug') }),
        panelHost.register('config', { mount: mountConfig, onClose: () => dispatch('configClosed'), onShow: () => dispatch('toolRestored', 'config') }),
        panelHost.register('performance', { mount: mountPerformance, onClose: () => dispatch('performanceClosed'), onShow: () => dispatch('toolRestored', 'performance') }),
        panelHost.register('recording', { mount: mountRecording, onClose: () => dispatch('recordingClosed'), onShow: () => dispatch('toolRestored', 'recording') }),
      );
      // The shell owns the Preview tab. Mount its content directly, without
      // creating a second dock inside the shell's panel.
      const cleanup = mountPreview(containerEl);
      if (cleanup) {
        hostedCleanups.push(cleanup);
      }
      layoutReady = true;
      dispatch('previewVisibleChange', true);
      dispatch('previewAloneChange', true);
      dispatch('ready', {
        api: null,
        resetLayout: () => panelHost.resetLayout?.(),
        showPreview: () => panelHost.showPreview?.(),
      });
      return;
    }
    api = createDockview(containerEl, {
      defaultTabComponent: 'shader-tab',
      createTabComponent: createShaderTab,
      createComponent(options) {
        return new SvelteContentRenderer(options.name);
      },
      theme: {
        ...themeVisualStudio,
        name: "shader-studio",
        className: "shader-studio-dockview-theme",
      },
      disableFloatingGroups: true,
    });

    disposeTabVisibility = setupDockviewTabs(containerEl, api);

    // Embedded viewers keep their tabs inside their own dock.
    dropListener = api.onWillDrop((event) => {
      if (event.getData()?.viewId !== api?.id) {
        event.preventDefault();
      }
    });

    apiReady = true;
    createDefaultLayout();
    layoutReady = true;

    api.onDidLayoutChange(() => {
      if (layoutReady) {
        setCurrentLayout(api!.toJSON() as unknown as SerializedLayout);
        checkPreviewAlone();
      }
    });

    api.onDidRemovePanel((panel) => {
      if (panel.id === "preview") {
        dispatch("previewVisibleChange", false);
      }
      if (panel.id === "debug" && !programmaticRemoval && !isDestroying) {
        dispatch("debugClosed");
      }
      if (panel.id === "config" && !programmaticRemoval && !isDestroying) {
        dispatch("configClosed");
      }
      if (panel.id === "performance" && !programmaticRemoval && !isDestroying) {
        dispatch("performanceClosed");
      }
      if (panel.id === "recording" && !programmaticRemoval && !isDestroying) {
        dispatch("recordingClosed");
      }
      checkPreviewAlone();
    });

    api.onDidAddPanel((panel) => {
      if (panel.id === "preview") {
        dispatch("previewVisibleChange", true);
      }
      checkPreviewAlone();
    });

    dispatch("ready", { api, resetLayout, showPreview });
    Promise.resolve().then(() => checkPreviewAlone());
  });

  onDestroy(() => {
    isDestroying = true;
    for (const cleanup of hostedCleanups.splice(0)) {
      cleanup();
    }
    dropListener?.dispose();
    disposeTabVisibility?.();
    for (const cleanup of cleanupMap.values()) {
      cleanup();
    }
    cleanupMap.clear();
    if (api) {
      api.dispose();
      api = null;
    }
  });
</script>

<div class="dockview-container" bind:this={containerEl}></div>

<style>
  .dockview-container {
    width: 100%;
    height: 100%;
    flex: 1;
    overflow: hidden;
  }

  /* VS Code theme mapping for dockview */
  :global(.shader-studio-dockview-theme) {
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
    --dv-paneview-header-border-color: var(--vscode-panel-border);
    --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
    --dv-drag-over-border-color: var(--vscode-focusBorder, #007fd4);
  }

</style>
