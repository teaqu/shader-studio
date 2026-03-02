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
  import { layoutStore } from "../stores/layoutStore";

  const dispatch = createEventDispatcher<{
    ready: { api: DockviewApi; resetLayout: () => void; showPreview: () => void };
    previewVisibleChange: boolean;
    previewAloneChange: boolean;
    debugClosed: void;
    configClosed: void;
  }>();

  // Panel mount callbacks — parent will set Svelte components into these containers
  export let mountPreview: (container: HTMLElement) => (() => void) | void = () => {};
  export let mountDebug: (container: HTMLElement) => (() => void) | void = () => {};
  export let mountConfig: (container: HTMLElement) => (() => void) | void = () => {};

  export let showDebugPanel: boolean = false;
  export let showConfigPanel: boolean = false;
  export let transport: Transport | null = null;

  let containerEl: HTMLElement;
  let api: DockviewApi | null = null;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let layoutReady = false;
  let programmaticRemoval = false;
  let lastPreviewAlone: boolean | null = null;

  function checkPreviewAlone() {
    if (!api) return;
    const panel = api.getPanel("preview");
    const alone = panel ? panel.api.group.panels.length === 1 : false;
    if (alone !== lastPreviewAlone) {
      lastPreviewAlone = alone;
      dispatch("previewAloneChange", alone);
    }
  }

  // Track mounted cleanup functions
  const cleanupMap = new Map<string, () => void>();

  // Drag detection — toggle class so all single-tab headers expand during drag
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
    if (!internalDragActive) return;
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
    // Clear sash hover state — drag-active takes over
    clearTimeout(sashHoverTimer);
    containerEl.classList.remove("dv-sash-hover");
    setDragActive(true);
  }

  function handleDragEnter() {
    // If the drag left and re-entered the webview, recover active drag visuals.
    if (internalDragActive) {
      setDragActive(true);
    }
  }

  function handleDragEnd() {
    // Some environments can emit dragend while the pointer is still down
    // (e.g. after leaving and re-entering the webview). Ignore that case.
    if (pointerDown) return;
    cancelActiveDrag();
  }

  function handleContainerDragLeave(e: DragEvent) {
    if (!internalDragActive) return;
    const nextTarget = e.relatedTarget as Node | null;
    // If drag leaves the dockview container entirely, treat as canceled.
    if (!nextTarget || !containerEl.contains(nextTarget)) {
      cancelActiveDrag();
    }
  }

  function handleDocumentDragLeave(e: DragEvent) {
    if (!internalDragActive) return;
    // If cursor leaves the webview/window bounds, treat it as a canceled drag.
    // Docking cannot resume until a new drag gesture starts.
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
    // Drag left the webview host app/window.
    cancelActiveDrag();
  }

  // Sash hover detection — reveal single-tab headers when hovering resize separators
  // or the top edge of the layout (where there's no sash above the first group)
  let sashHoverTimer: ReturnType<typeof setTimeout> | undefined;
  let topEdgeActive = false;
  const TOP_EDGE_THRESHOLD = 8;

  function handleMouseOver(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest(".dv-sash") || target.closest(".dv-tabs-and-actions-container.dv-single-tab")) {
      clearTimeout(sashHoverTimer);
      containerEl.classList.add("dv-sash-hover");
    }
  }

  function handleMouseOut(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const related = e.relatedTarget as HTMLElement | null;

    // Only start collapse timer if leaving a sash or single-tab bar
    if (target.closest(".dv-sash") || target.closest(".dv-tabs-and-actions-container.dv-single-tab")) {
      // Don't collapse if moving into the other tracked element
      if (related?.closest(".dv-sash") || related?.closest(".dv-tabs-and-actions-container.dv-single-tab")) {
        return;
      }
      // Don't collapse if still near the top edge
      if (topEdgeActive) return;
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
      clearTimeout(sashHoverTimer);
      containerEl.classList.add("dv-sash-hover");
    } else if (!nearTop && topEdgeActive) {
      topEdgeActive = false;
      // Don't start collapse if mouse moved onto a sash or revealed tab bar
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
    if (!api) return;

    // Add the preview panel first — it takes up most of the space
    api.addPanel({
      id: "preview",
      component: "preview",
      title: "Preview",
      renderer: "always",
    });

    // Debug and config start hidden — added when toggled on
    if (showDebugPanel) {
      addDebugPanel();
    }
    if (showConfigPanel) {
      addConfigPanel();
    }
  }

  function addDebugPanel() {
    if (!api || api.getPanel("debug")) return;
    api.addPanel({
      id: "debug",
      component: "debug",
      title: "Debug",
      position: {
        referencePanel: "preview",
        direction: "below",
      },
      initialHeight: 200,
    });
  }

  function removeDebugPanel() {
    if (!api) return;
    const panel = api.getPanel("debug");
    if (panel) {
      programmaticRemoval = true;
      api.removePanel(panel);
      programmaticRemoval = false;
    }
  }

  function addConfigPanel() {
    if (!api || api.getPanel("config")) return;
    // Place config alongside debug if debug exists, otherwise below preview
    const debugPanel = api.getPanel("debug");
    if (debugPanel) {
      api.addPanel({
        id: "config",
        component: "config",
        title: "Config",
        position: {
          referencePanel: "debug",
          direction: "within",
        },
      });
    } else {
      api.addPanel({
        id: "config",
        component: "config",
        title: "Config",
        position: {
          referencePanel: "preview",
          direction: "below",
        },
        initialHeight: 200,
      });
    }
  }

  function removeConfigPanel() {
    if (!api) return;
    const panel = api.getPanel("config");
    if (panel) {
      programmaticRemoval = true;
      api.removePanel(panel);
      programmaticRemoval = false;
    }
  }

  function showPreview() {
    if (!api || api.getPanel("preview")) return;
    api.addPanel({
      id: "preview",
      component: "preview",
      title: "Preview",
      renderer: "always",
    });
    dispatch("previewVisibleChange", true);
  }

  function resetLayout() {
    if (!api) return;
    layoutStore.clear();
    if (transport) {
      transport.postMessage({ type: "saveLayout", payload: null });
    }
    api.clear();
    createDefaultLayout();
  }

  function saveLayout() {
    if (!api) return;
    const serialized = api.toJSON();
    console.log("[DockviewLayout] saveLayout called, groups:", serialized?.grid?.root?.data?.length ?? "unknown");
    layoutStore.save(serialized);
    if (transport) {
      transport.postMessage({ type: "saveLayout", payload: serialized });
      console.log("[DockviewLayout] saveLayout sent via transport");
    } else {
      console.log("[DockviewLayout] saveLayout: no transport, localStorage only");
    }
  }

  function scheduleLayoutSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveLayout, 500);
  }

  function restoreFromData(data: SerializedDockview) {
    if (!api) return;
    try {
      console.log("[DockviewLayout] restoreFromData called, panels:", JSON.stringify(data?.panels ?? {}));
      api.fromJSON(data);
      console.log("[DockviewLayout] fromJSON succeeded, total panels:", api.panels.length);
      layoutReady = true;
    } catch (e) {
      console.warn("[DockviewLayout] fromJSON FAILED, falling back to default:", e);
      api.clear();
      createDefaultLayout();
      layoutReady = true;
    }
  }

  // React to debug panel visibility
  $: if (api && layoutReady) {
    if (showDebugPanel) {
      addDebugPanel();
    } else {
      removeDebugPanel();
    }
  }

  // React to config panel visibility
  $: if (api && layoutReady) {
    if (showConfigPanel) {
      addConfigPanel();
    } else {
      removeConfigPanel();
    }
  }

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

    // Listen for restoreLayout messages from the extension
    if (transport) {
      console.log("[DockviewLayout] transport available, registering restoreLayout handler");
      transport.onMessage((event: MessageEvent) => {
        if (event.data.type === "restoreLayout") {
          console.log("[DockviewLayout] restoreLayout received, payload:", event.data.payload ? "present" : "null", "api:", !!api, "layoutReady:", layoutReady);
          if (api && !layoutReady) {
            if (event.data.payload) {
              restoreFromData(event.data.payload);
            } else {
              // No saved layout from extension — try localStorage fallback
              const localLayout = layoutStore.load();
              console.log("[DockviewLayout] no extension layout, localStorage:", localLayout ? "found" : "empty");
              if (localLayout) {
                restoreFromData(localLayout);
              } else {
                console.log("[DockviewLayout] creating default layout");
                createDefaultLayout();
                layoutReady = true;
              }
            }
          }
        }
      });

      // Request layout from extension
      console.log("[DockviewLayout] sending requestLayout");
      transport.postMessage({ type: "requestLayout" });
    } else {
      // No transport (web server mode) — use localStorage only
      const savedLayout = layoutStore.load();
      if (savedLayout) {
        restoreFromData(savedLayout);
      } else {
        createDefaultLayout();
        layoutReady = true;
      }
    }

    // Save layout on changes — also clear drag-active as a fallback.
    // When dockview moves a panel, the drag source element gets removed from
    // the DOM, so the native dragend event fires on a detached node and never
    // bubbles to document.  Clearing here ensures tabs re-hide after a drop.
    api.onDidLayoutChange(() => {
      if (layoutReady) {
        internalDragActive = false;
        setDragActive(false);
        scheduleLayoutSave();
        checkPreviewAlone();
      }
    });

    // Track panel removal — dispatch events when user closes tabs (not programmatic)
    api.onDidRemovePanel((panel) => {
      if (panel.id === "preview") {
        dispatch("previewVisibleChange", false);
      }
      if (panel.id === "debug" && !programmaticRemoval) {
        dispatch("debugClosed");
      }
      if (panel.id === "config" && !programmaticRemoval) {
        dispatch("configClosed");
      }
      checkPreviewAlone();
    });

    api.onDidAddPanel((panel) => {
      if (panel.id === "preview") {
        dispatch("previewVisibleChange", true);
      }
      checkPreviewAlone();
    });

    // Expand all single-tab headers when a drag starts anywhere in the layout
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    containerEl.addEventListener("dragstart", handleDragStart);
    containerEl.addEventListener("dragenter", handleDragEnter);
    containerEl.addEventListener("dragleave", handleContainerDragLeave);
    document.addEventListener("dragleave", handleDocumentDragLeave);
    document.addEventListener("dragend", handleDragEnd);
    window.addEventListener("blur", handleWindowBlur);

    // Sash hover detection + top-edge detection
    containerEl.addEventListener("mouseover", handleMouseOver);
    containerEl.addEventListener("mouseout", handleMouseOut);
    containerEl.addEventListener("mousemove", handleMouseMove);

    dispatch("ready", { api, resetLayout, showPreview });
    // Fire initial preview-alone state once layout is ready
    // Use a microtask to ensure layoutReady is set first
    Promise.resolve().then(() => checkPreviewAlone());
  });

  onDestroy(() => {
    // Flush any pending layout save before disposal
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveLayout();
    }
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("pointerup", handlePointerUp, true);
    clearTimeout(sashHoverTimer);
    containerEl?.removeEventListener("dragstart", handleDragStart);
    containerEl?.removeEventListener("dragenter", handleDragEnter);
    containerEl?.removeEventListener("dragleave", handleContainerDragLeave);
    document.removeEventListener("dragleave", handleDocumentDragLeave);
    document.removeEventListener("dragend", handleDragEnd);
    window.removeEventListener("blur", handleWindowBlur);
    containerEl?.removeEventListener("mouseover", handleMouseOver);
    containerEl?.removeEventListener("mouseout", handleMouseOut);
    containerEl?.removeEventListener("mousemove", handleMouseMove);
    // Clean up all mounted Svelte components
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
