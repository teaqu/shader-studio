<script lang="ts">
  export let onResize: (ratio: number) => void;

  let isDragging = false;
  let containerHeight = 0;

  function handleMouseDown(event: MouseEvent) {
    event.preventDefault();
    isDragging = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isDragging) return;

    // Get the main container element
    const mainContainer = (event.target as HTMLElement).closest(".main-container");
    if (!mainContainer) return;

    const rect = mainContainer.getBoundingClientRect();
    containerHeight = rect.height;

    // Calculate position relative to container
    const mouseY = event.clientY - rect.top;

    // Calculate ratio (0.0 to 1.0) for canvas section
    let ratio = mouseY / containerHeight;

    // Clamp ratio between 0.3 and 0.9 to prevent collapse
    ratio = Math.max(0.3, Math.min(0.9, ratio));

    onResize(ratio);
  }

  function handleMouseUp() {
    isDragging = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Allow keyboard control for accessibility
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      // Adjust by 5% increments
      const currentRatio = 0.6; // Default ratio
      const adjustment = event.key === 'ArrowUp' ? -0.05 : 0.05;
      const newRatio = Math.max(0.3, Math.min(0.9, currentRatio + adjustment));
      onResize(newRatio);
    }
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="resize-handle"
  class:dragging={isDragging}
  on:mousedown={handleMouseDown}
  on:keydown={handleKeyDown}
  role="separator"
  aria-orientation="horizontal"
  aria-label="Resize split"
  tabindex="0"
></div>

<style>
  .resize-handle {
    height: 4px;
    background: var(--vscode-panel-border);
    cursor: ns-resize;
    flex-shrink: 0;
    transition: background 0.2s;
    position: relative;
    z-index: 10;
  }

  .resize-handle:hover,
  .resize-handle.dragging {
    background: var(--vscode-button-background);
  }

  .resize-handle:focus {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: -2px;
  }
</style>
