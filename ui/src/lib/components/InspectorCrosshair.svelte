<script lang="ts">
  export let isVisible: boolean = false;
  export let canvasX: number = 0;
  export let canvasY: number = 0;
  export let canvasElement: HTMLCanvasElement | null = null;

  let screenX = 0;
  let screenY = 0;

  $: if (canvasElement && isVisible) {
    const rect = canvasElement.getBoundingClientRect();
    // Convert canvas coordinates to screen coordinates
    screenX = rect.left + (canvasX / canvasElement.width) * rect.width;
    screenY = rect.top + (canvasY / canvasElement.height) * rect.height;
  }
</script>

{#if isVisible && canvasElement}
  <div class="crosshair" style="left: {screenX}px; top: {screenY}px;">
    <!-- Horizontal line -->
    <div class="line horizontal"></div>
    <!-- Vertical line -->
    <div class="line vertical"></div>
    <!-- Center dot -->
    <div class="center-dot"></div>
  </div>
{/if}

<style>
  .crosshair {
    position: fixed;
    width: 20px;
    height: 20px;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 9999;
  }

  .line {
    position: absolute;
    background: rgba(14, 99, 156, 0.8);
  }

  .line.horizontal {
    width: 20px;
    height: 1px;
    left: 0;
    top: 50%;
    transform: translateY(-0.5px);
  }

  .line.vertical {
    width: 1px;
    height: 20px;
    left: 50%;
    top: 0;
    transform: translateX(-0.5px);
  }

  .center-dot {
    position: absolute;
    width: 4px;
    height: 4px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    border: 1px solid rgba(14, 99, 156, 0.9);
    border-radius: 50%;
    background: rgba(14, 99, 156, 0.2);
  }
</style>
