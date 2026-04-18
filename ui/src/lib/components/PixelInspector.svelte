<script lang="ts">
  interface Props {
    isActive?: boolean;
    isLocked?: boolean;
    mouseX?: number;
    mouseY?: number;
    rgb?: { r: number; g: number; b: number } | null;
    fragCoord?: { x: number; y: number } | null;
    canvasWidth?: number;
    canvasHeight?: number;
  }

  let {
    isActive = false,
    isLocked = false,
    mouseX = 0,
    mouseY = 0,
    rgb = null as { r: number; g: number; b: number } | null,
    fragCoord = null as { x: number; y: number } | null,
    canvasWidth = 0,
    canvasHeight = 0,
  }: Props = $props();

  let inspectorElement: HTMLDivElement;
  const OFFSET = 20;
  const ESTIMATED_WIDTH = 250;

  let displayY = $derived(mouseY);
  let shouldFlipLeft = $derived(typeof window !== 'undefined' && (mouseX + OFFSET + ESTIMATED_WIDTH > window.innerWidth));
  let positionX = $derived(shouldFlipLeft ? mouseX - ESTIMATED_WIDTH - OFFSET : mouseX + OFFSET);
</script>

{#if isActive && rgb && fragCoord}
  <div
    bind:this={inspectorElement}
    class="pixel-inspector"
    class:locked={isLocked}
    style="left: {positionX}px; top: {displayY + OFFSET}px;"
  >
    <div class="inspector-content">
      <div class="color-preview" style="background-color: rgb({rgb.r}, {rgb.g}, {rgb.b});"></div>
      <div class="info">
        <div class="info-row">
          <span class="label">RGB:</span>
          <span class="value">({rgb.r}, {rgb.g}, {rgb.b})</span>
        </div>
        <div class="info-row">
          <span class="label">Float:</span>
          <span class="value">({(rgb.r / 255).toFixed(3)}, {(rgb.g / 255).toFixed(3)}, {(rgb.b / 255).toFixed(3)})</span>
        </div>
        <div class="info-row">
          <span class="label">Hex:</span>
          <span class="value">#{rgb.r.toString(16).padStart(2, '0')}{rgb.g.toString(16).padStart(2, '0')}{rgb.b.toString(16).padStart(2, '0')}</span>
        </div>
        <div class="info-row">
          <span class="label">fragCoord:</span>
          <span class="value">({fragCoord.x.toFixed(1)}, {fragCoord.y.toFixed(1)})</span>
        </div>
        <div class="info-row">
          <span class="label">UV:</span>
          <span class="value">({(fragCoord.x / canvasWidth).toFixed(3)}, {(fragCoord.y / canvasHeight).toFixed(3)})</span>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .pixel-inspector {
    position: fixed;
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #454545);
    border-radius: 4px;
    padding: 8px;
    z-index: 10000;
    pointer-events: none;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    font-family: var(--vscode-font-family, monospace);
    font-size: 12px;
    color: var(--vscode-editor-foreground, #d4d4d4);
  }

  .inspector-content {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .color-preview {
    width: 40px;
    height: 40px;
    border: 1px solid var(--vscode-panel-border, #454545);
    border-radius: 2px;
    flex-shrink: 0;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .info-row {
    display: flex;
    gap: 6px;
    white-space: nowrap;
  }

  .label {
    font-weight: 600;
    color: var(--vscode-textLink-foreground, #4daafc);
  }

  .value {
    font-family: monospace;
    color: var(--vscode-editor-foreground, #d4d4d4);
  }
</style>
