<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import {
    createDockview,
    themeVisualStudio,
    type DockviewApi,
    type IContentRenderer,
    type GroupPanelPartInitParameters,
    type SerializedDockview,
  } from "dockview-core";
  import "dockview-core/dist/styles/dockview.css";
  import type { Transport } from "../transport/MessageTransport";
  import { setCurrentLayout, getPendingRestore, clearPendingRestore } from "../state/layoutState.svelte";
  import { scheduleProfileSave } from "../state/profileStore.svelte";

  const dispatch = createEventDispatcher<{
    ready: { api: DockviewApi; resetLayout: () => void; showPreview: () => void };
    previewVisibleChange: boolean;
    previewAloneChange: boolean;
    debugClosed: void;
    configClosed: void;
    performanceClosed: void;
  }>();

  interface Props {
    mountPreview?: (container: HTMLElement) => (() => void) | void;
    mountDebug?: (container: HTMLElement) => (() => void) | void;
    mountConfig?: (container: HTMLElement) => (() => void) | void;
    mountPerformance?: (container: HTMLElement) => (() => void) | void;
    showDebugPanel?: boolean;
    showConfigPanel?: boolean;
    showPerformancePanel?: boolean;
    transport?: Transport | null;
  }

  let {
    mountPreview = () => {},
    mountDebug = () => {},
    mountConfig = () => {},
    mountPerformance = () => {},
    showDebugPanel = false,
    showConfigPanel = false,
    showPerformancePanel = false,
    transport = null as Transport | null,
  }: Props = $props();

  let containerEl: HTMLElement;
  let api: DockviewApi | null = null;
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

  let internalDragActive = false;
  let pointerDown = false;

  function setDragActive(active: boolean) {
    if (active) {
      containerEl.classList.add("dv-drag-active");
    } else {
      containerEl.classList.remove("dv-drag-active");
    }
  }

  function cancelActiveDrag() {
    if (!internalDragActive) {
      return;
    }
    internalDragActive = false;
    setDragActive(false);
  }

  function handlePointerDown() {
    pointerDown = true;
  }

  function handlePointerUp() {
    pointerDown = false;
    cancelActiveDrag();
  }

  function handleDragStart() {
    internalDragActive = true;
    cancelReveal();
    clearTimeout(sashHoverTimer);
    containerEl.classList.remove("dv-sash-hover");
    setDragActive(true);
  }

  function handleDragEnter() {
    if (internalDragActive) {
      setDragActive(true);
    }
  }

  function handleDragEnd() {
    if (pointerDown) {
      return;
    }
    cancelActiveDrag();
  }

  function handleContainerDragLeave(e: DragEvent) {
    if (!internalDragActive) {
      return;
    }
    const nextTarget = e.relatedTarget as Node | null;
    if (!nextTarget || !containerEl.contains(nextTarget)) {
      cancelActiveDrag();
    }
  }

  function handleDocumentDragLeave(e: DragEvent) {
    if (!internalDragActive) {
      return;
    }
    const outsideWindow =
      e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight;

    if (outsideWindow) {
      cancelActiveDrag();
    }
  }

  function handleWindowBlur() {
    cancelActiveDrag();
  }

  let sashHoverTimer: ReturnType<typeof setTimeout> | undefined;
  let sashRevealTimer: ReturnType<typeof setTimeout> | undefined;
  let topEdgeActive = false;
  const TOP_EDGE_THRESHOLD = 8;
  const REVEAL_DELAY = 300;

  function revealSashHover() {
    clearTimeout(sashHoverTimer);
    containerEl.classList.add("dv-sash-hover");
  }

  function scheduleReveal() {
    clearTimeout(sashHoverTimer);
    clearTimeout(sashRevealTimer);
    sashRevealTimer = setTimeout(revealSashHover, REVEAL_DELAY);
  }

  function cancelReveal() {
    clearTimeout(sashRevealTimer);
  }

  function handleMouseOver(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".dv-sash") || target.closest(".dv-tabs-and-actions-container.dv-single-tab")) {
      scheduleReveal();
    }
  }

  function handleMouseOut(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;

    if (target.closest(".dv-sash") || target.closest(".dv-tabs-and-actions-container.dv-single-tab")) {
      if (related?.closest(".dv-sash") || related?.closest(".dv-tabs-and-actions-container.dv-single-tab")) {
        return;
      }
      if (topEdgeActive) {
        return;
      }
      cancelReveal();
      clearTimeout(sashHoverTimer);
      sashHoverTimer = setTimeout(() => {
        containerEl.classList.remove("dv-sash-hover");
      }, 400);
    }
  }

  function handleMouseMove(e: MouseEvent) {
    const rect = containerEl.getBoundingClientRect();
    const nearTop = e.clientY - rect.top < TOP_EDGE_THRESHOLD;

    if (nearTop && !topEdgeActive) {
      topEdgeActive = true;
      scheduleReveal();
    } else if (!nearTop && topEdgeActive) {
      topEdgeActive = false;
      cancelReveal();
      const target = e.target as HTMLElement;
      if (target.closest(".dv-sash") || target.closest(".dv-tabs-and-actions-container.dv-single-tab")) {
        return;
      }
      clearTimeout(sashHoverTimer);
      sashHoverTimer = setTimeout(() => {
        containerEl.classList.remove("dv-sash-hover");
      }, 400);
    }
  }

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
    return true;
  }

  function addDebugPanel() {
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
        position: { referencePanel: "preview", direction: "below" },
        initialHeight: 250,
      });

      for (const sid of siblingIds) {
        api.addPanel({
          id: sid,
          component: sid,
          title: sid === "performance" ? "Frame Times" : sid.charAt(0).toUpperCase() + sid.slice(1),
          position: { referencePanel: "config", direction: "within" },
        });
      }
    } else {
      api.addPanel({
        id: "config",
        component: "config",
        title: "Config",
        position: { referencePanel: "preview", direction: "below" },
        initialHeight: 250,
      });
    }
  }

  function removeConfigPanel() {
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
      title: "Frame Times",
      ...(tabRef
        ? { position: { referencePanel: tabRef.id, direction: "within" } }
        : { position: { referencePanel: "preview", direction: "below" }, initialHeight: 200 }),
    });
  }

  function removePerformancePanel() {
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

  function restoreFromData(data: SerializedDockview) {
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
      console.log("[DockviewLayout] restoreFromData called, panels:", JSON.stringify(data?.panels ?? {}));
      programmaticRemoval = true;
      api.fromJSON(data);
      programmaticRemoval = false;
      if (api.panels.length === 0) {
        api.clear();
        createDefaultLayout();
      }
      console.log("[DockviewLayout] fromJSON succeeded, total panels:", api.panels.length);
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
    return !!data?.panels && Object.keys(data.panels).length > 0;
  }

  // Force-read reactive deps before conditions to ensure they are tracked
  // even when the guard condition short-circuits.
  $effect(() => {
    const _debug = showDebugPanel;
    const _ready = layoutReady;
    if (api && _ready) {
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
    if (api && _ready) {
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
    if (api && _ready) {
      if (_perf) {
        addPerformancePanel();
      } else {
        removePerformancePanel();
      }
    }
  });

  $effect(() => {
    // apiReady is a reactive dep that ensures this effect re-runs after onMount sets up api.
    const _ready = apiReady;
    const pending = getPendingRestore();
    if (pending && _ready && api) {
      restoreFromData(pending as SerializedDockview);
      clearPendingRestore();
    }
  });

  onMount(() => {
    api = createDockview(containerEl, {
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

    apiReady = true;
    createDefaultLayout();
    layoutReady = true;

    api.onDidLayoutChange(() => {
      if (layoutReady) {
        internalDragActive = false;
        setDragActive(false);
        setCurrentLayout(api!.toJSON());
        scheduleProfileSave();
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
      checkPreviewAlone();
    });

    api.onDidAddPanel((panel) => {
      if (panel.id === "preview") {
        dispatch("previewVisibleChange", true);
      }
      checkPreviewAlone();
    });

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    containerEl.addEventListener("dragstart", handleDragStart);
    containerEl.addEventListener("dragenter", handleDragEnter);
    containerEl.addEventListener("dragleave", handleContainerDragLeave);
    document.addEventListener("dragleave", handleDocumentDragLeave);
    document.addEventListener("dragend", handleDragEnd);
    window.addEventListener("blur", handleWindowBlur);

    containerEl.addEventListener("mouseover", handleMouseOver);
    containerEl.addEventListener("mouseout", handleMouseOut);
    containerEl.addEventListener("mousemove", handleMouseMove);

    dispatch("ready", { api, resetLayout, showPreview });
    Promise.resolve().then(() => checkPreviewAlone());
  });

  onDestroy(() => {
    isDestroying = true;
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("pointerup", handlePointerUp, true);
    clearTimeout(sashHoverTimer);
    clearTimeout(sashRevealTimer);
    containerEl?.removeEventListener("dragstart", handleDragStart);
    containerEl?.removeEventListener("dragenter", handleDragEnter);
    containerEl?.removeEventListener("dragleave", handleContainerDragLeave);
    document.removeEventListener("dragleave", handleDocumentDragLeave);
    document.removeEventListener("dragend", handleDragEnd);
    window.removeEventListener("blur", handleWindowBlur);
    containerEl?.removeEventListener("mouseover", handleMouseOver);
    containerEl?.removeEventListener("mouseout", handleMouseOut);
    containerEl?.removeEventListener("mousemove", handleMouseMove);
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

  /* Ensure groups are positioning context for absolute tab bars */
  :global(.shader-studio-dockview-theme .dv-groupview) {
    position: relative;
  }

  /* Hide single-tab headers — use position: absolute so they don't affect
     content area height. This avoids layout shifts that break dockview's
     render overlay position cache and drop-zone calculations. */
  :global(.shader-studio-dockview-theme .dv-tabs-and-actions-container.dv-single-tab) {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease-out;
  }

  /* Reveal tabs on sash hover, top-edge hover, or drag */
  :global(.dv-sash-hover .dv-tabs-and-actions-container.dv-single-tab),
  :global(.dv-drag-active .dv-tabs-and-actions-container.dv-single-tab) {
    opacity: 1;
    pointer-events: auto;
  }
</style>
