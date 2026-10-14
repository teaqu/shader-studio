import type { DockviewApi } from 'dockview-core';
import './singleTabHeaders.css';

/** Shared single-tab hover and drag behavior for the VS Code and standalone docks. */
export function setupDockviewTabs(containerEl: HTMLElement, api: Pick<DockviewApi, 'onDidLayoutChange'>): () => void {
  containerEl.classList.add('dv-autohide-tabs');
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

  const listeners = new AbortController();
  const { signal } = listeners;
  document.addEventListener("pointerdown", handlePointerDown, { signal, capture: true });
  document.addEventListener("pointerup", handlePointerUp, { signal, capture: true });
  containerEl.addEventListener("dragstart", handleDragStart, { signal });
  containerEl.addEventListener("dragenter", handleDragEnter, { signal });
  containerEl.addEventListener("dragleave", handleContainerDragLeave, { signal });
  document.addEventListener("dragleave", handleDocumentDragLeave, { signal });
  document.addEventListener("dragend", handleDragEnd, { signal });
  window.addEventListener("blur", handleWindowBlur, { signal });

  containerEl.addEventListener("mouseover", handleMouseOver, { signal });
  containerEl.addEventListener("mouseout", handleMouseOut, { signal });
  containerEl.addEventListener("mousemove", handleMouseMove, { signal });

  const layoutListener = api.onDidLayoutChange(cancelActiveDrag);
  return () => {
    layoutListener.dispose();
    listeners.abort();
    clearTimeout(sashHoverTimer);
    clearTimeout(sashRevealTimer);
    containerEl.classList.remove('dv-autohide-tabs', 'dv-sash-hover', 'dv-drag-active');
  };
}
