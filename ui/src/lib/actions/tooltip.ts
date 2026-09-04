const SHOW_DELAY_MS = 350;
const GAP_PX = 6;

/**
 * Hover explanation for a control.
 *
 * The browser's own `title` tooltips do not reliably appear inside a VS Code
 * webview, and nothing about them can be styled or tested. This renders the
 * text itself: the element carries it as `data-tooltip` for assertions, and a
 * positioned element appears after a short hover.
 */
export function tooltip(node: HTMLElement, text: string) {
  let bubble: HTMLDivElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let current = text;

  const hide = (): void => {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    bubble?.remove();
    bubble = null;
    node.removeAttribute("aria-describedby");
  };

  const show = (): void => {
    if (bubble || !current) {
      return;
    }
    const rect = node.getBoundingClientRect();
    bubble = document.createElement("div");
    bubble.className = "ss-tooltip";
    bubble.setAttribute("role", "tooltip");
    bubble.id = `ss-tooltip-${Math.random().toString(36).slice(2, 9)}`;
    bubble.textContent = current;
    document.body.appendChild(bubble);
    node.setAttribute("aria-describedby", bubble.id);

    // Prefer below the control, flipping above when there is no room.
    const bubbleRect = bubble.getBoundingClientRect();
    const below = rect.bottom + GAP_PX;
    const fitsBelow = below + bubbleRect.height <= window.innerHeight;
    bubble.style.top = `${fitsBelow ? below : rect.top - bubbleRect.height - GAP_PX}px`;
    const left = rect.left + rect.width / 2 - bubbleRect.width / 2;
    bubble.style.left = `${Math.max(GAP_PX, Math.min(left, window.innerWidth - bubbleRect.width - GAP_PX))}px`;
  };

  const scheduleShow = (): void => {
    if (showTimer !== null) {
      return;
    }
    showTimer = setTimeout(() => {
      showTimer = null;
      show();
    }, SHOW_DELAY_MS);
  };

  node.setAttribute("data-tooltip", current);
  node.addEventListener("mouseenter", scheduleShow);
  node.addEventListener("focus", scheduleShow);
  node.addEventListener("mouseleave", hide);
  node.addEventListener("blur", hide);
  // A click has already been explained; keeping the bubble up just covers things.
  node.addEventListener("click", hide);

  return {
    update(next: string) {
      current = next;
      node.setAttribute("data-tooltip", next);
      if (bubble) {
        bubble.textContent = next;
      }
    },
    destroy() {
      hide();
      node.removeEventListener("mouseenter", scheduleShow);
      node.removeEventListener("focus", scheduleShow);
      node.removeEventListener("mouseleave", hide);
      node.removeEventListener("blur", hide);
      node.removeEventListener("click", hide);
    },
  };
}
