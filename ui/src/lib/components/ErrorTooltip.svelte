<svelte:options runes={true} />
<script lang="ts">
  import { splitCompilerErrorBlocks } from "@shader-studio/rendering";
  import { portal } from "../actions/portal";

  interface Props {
    /** Raw payload entries; split into one block per diagnostic for display. */
    messages: string[];
    visible: boolean;
    /** The element the tooltip opens from. It is positioned against this. */
    anchor: HTMLElement | null;
    variant?: "error" | "warning";
    onmouseenter?: () => void;
    onmouseleave?: (event: MouseEvent) => void;
  }

  let {
    messages,
    visible,
    anchor,
    variant = "error",
    onmouseenter,
    onmouseleave,
  }: Props = $props();

  let tooltipEl = $state<HTMLDivElement | null>(null);
  let position = $state<{ top: number; left: number } | null>(null);
  let maxHeight = $state<number | null>(null);
  let maxWidth = $state<number | null>(null);

  /**
   * Gap kept between the tooltip and the viewport edge. It is deliberately not
   * applied against the anchor: the tooltip is portalled to the body and is
   * hovered to reach its copy button, so a gap there is dead space that hands
   * the pointer to the body mid-crossing, disarming the hover and closing the
   * tooltip before it can be reached.
   */
  const MARGIN = 8;
  const MAX_HEIGHT = 640;
  const MAX_WIDTH = 1100;

  const blocks = $derived(
    splitCompilerErrorBlocks(messages).map((block) => block.text),
  );

  /**
   * The tooltip is portalled to the body: inside the menu bar it was trapped in
   * the dockview pane's stacking and clipping context, which cut it off at the
   * pane edge and let neighbouring panels paint over it. Positioning is
   * therefore ours to do - fixed, against the anchor, clamped to the viewport.
   */
  function measure() {
    const anchorEl = anchor;
    const element = tooltipEl;
    if (!anchorEl || !element) {
      return;
    }

    maxWidth = Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2);

    const anchorRect = anchorEl.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // Nothing laid out yet (jsdom, a hidden pane): leave it to the stylesheet.
      return;
    }

    // Sized to the side it opens on rather than to the viewport: a tooltip
    // taller than the space available would otherwise cover its own anchor and
    // swallow the hover that opened it.
    const spaceAbove = anchorRect.top - MARGIN;
    const spaceBelow = window.innerHeight - anchorRect.bottom - MARGIN;
    const opensAbove = spaceAbove >= rect.height || spaceAbove >= spaceBelow;
    const available = Math.max(0, opensAbove ? spaceAbove : spaceBelow);

    maxHeight = Math.min(MAX_HEIGHT, available);
    const height = Math.min(rect.height, maxHeight);

    position = {
      top: opensAbove ? anchorRect.top - height : anchorRect.bottom,
      left: Math.max(MARGIN, Math.min(anchorRect.left, window.innerWidth - rect.width - MARGIN)),
    };
  }

  async function copyMessages() {
    try {
      await navigator.clipboard.writeText(messages.join("\n"));
    } catch {
    // clipboard write failed — silently ignore
    }
  }

  $effect(() => {
    // Read what the position depends on so it is recomputed when any changes.
    const isVisible = visible;
    const currentBlocks = blocks;
    if (!isVisible || !tooltipEl || currentBlocks.length === 0) {
      return;
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  });
</script>

<div
  use:portal
  bind:this={tooltipEl}
  class="error-tooltip"
  class:warning={variant === "warning"}
  class:visible
  style={[
    position === null ? '' : `top: ${position.top}px; left: ${position.left}px;`,
    maxHeight === null ? '' : `max-height: ${maxHeight}px;`,
    maxWidth === null ? '' : `max-width: ${maxWidth}px;`,
  ].join('') || undefined}
  role="presentation"
  onmouseenter={() => onmouseenter?.()}
  onmouseleave={(event) => onmouseleave?.(event)}
>
  <div class="error-tooltip-content">
    <button
      class="error-tooltip-copy"
      onclick={copyMessages}
      aria-label="Copy error to clipboard"
    >
      <i class="codicon codicon-copy"></i>
    </button>
    {#each blocks as block}
      <div class="error-tooltip-block">{block}</div>
    {/each}
  </div>
</div>
