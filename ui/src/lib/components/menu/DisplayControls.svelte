<svelte:options runes={true} />
<script lang="ts">
  import { portal } from "../../actions/portal";
  import { resolutionStore, type ResolutionState } from "../../stores/resolutionStore";
  import type { AspectRatioMode } from "../../stores/aspectRatioStore";
  import type { ResolutionSessionController } from "../../resolution/ResolutionSessionController.svelte";
  import { MenuOverlay } from "./MenuOverlay.svelte";

  interface Props {
    fpsMenu: MenuOverlay;
    resolutionMenu: MenuOverlay;
    currentFPS: number;
    currentFPSLimit: number;
    isPerformancePanelVisible: boolean;
    currentResolution: ResolutionState;
    currentAspectRatio: AspectRatioMode;
    resCtrl: ResolutionSessionController;
    onFpsLimitSelect: (limit: number) => void;
    onTogglePerformancePanel: () => void;
    onZoomChange: (zoom: number) => void;
  }

  let { fpsMenu, resolutionMenu, currentFPS, currentFPSLimit, isPerformancePanelVisible,
    currentResolution, currentAspectRatio, resCtrl, onFpsLimitSelect,
    onTogglePerformancePanel, onZoomChange }: Props = $props();
  let widthInput = $state<number | null>(null);
  let heightInput = $state<number | null>(null);
  let zoomLevel = $state(1);

  $effect(() => {
    widthInput = currentResolution.width === undefined ? null : Number(currentResolution.width) || null;
    heightInput = currentResolution.height === undefined ? null : Number(currentResolution.height) || null;
  });

  function selectResolutionScale(scale: number) {
    if (resCtrl.menuVM.targetKind === "image") {
resCtrl.setImageScale(scale);
} else {
resCtrl.setBufferScale(scale);
}
  }
  function applyCustomResolution() {
    if (widthInput && heightInput) {
resCtrl.setImageCustomResolution(String(widthInput), String(heightInput));
}
  }
  function clearCustomResolution(event: MouseEvent) {
    event.stopPropagation(); widthInput = null; heightInput = null;
    resCtrl.setImageCustomResolution(undefined, undefined);
  }
  function resetResolution() {
    widthInput = null; heightInput = null; resCtrl.resetCurrentTarget();
  }
  function syncWithConfig(event: Event) {
 resCtrl.setSyncWithConfig((event.target as HTMLInputElement).checked);
}
  function setBufferWidth(event: Event) {
 resCtrl.setBufferFixedResolution((event.target as HTMLInputElement).value, resCtrl.menuVM.bufferResolutionState.height);
}
  function setBufferHeight(event: Event) {
 resCtrl.setBufferFixedResolution(resCtrl.menuVM.bufferResolutionState.width, (event.target as HTMLInputElement).value);
}
  function changeZoom(event: Event) {
 zoomLevel = parseFloat((event.target as HTMLInputElement).value); onZoomChange(zoomLevel);
}
  function setBlackBackground(event: Event) {
 resolutionStore.setForceBlackBackground((event.target as HTMLInputElement).checked);
}
</script>

{#if fpsMenu.open}
  <div
    use:portal
    bind:this={fpsMenu.element}
    class="fps-menu"
    style="top: {fpsMenu.position.top}px; left: {fpsMenu.position.left}px; visibility: {fpsMenu.visible ? 'visible' : 'hidden'};"
  >
    <div class="resolution-section">
      <h4>Frame Rate Limit</h4>
      <button class="resolution-option menu-title" class:active={currentFPSLimit === 30} onclick={() => onFpsLimitSelect(30)}>30 FPS</button>
      <button class="resolution-option menu-title" class:active={currentFPSLimit === 60} onclick={() => onFpsLimitSelect(60)}>60 FPS</button>
      <button class="resolution-option menu-title" class:active={currentFPSLimit === 0} onclick={() => onFpsLimitSelect(0)}>Unlimited</button>
    </div>
    <div class="resolution-separator"></div>
    <button
      class="resolution-option menu-title"
      class:active={isPerformancePanelVisible}
      onclick={() => {
        onTogglePerformancePanel(); fpsMenu.open = false;
      }}
    >
      <i class="codicon codicon-graph-line"></i> Performance
    </button>
  </div>
{/if}

{#if resolutionMenu.open}
  {@const hasCustom = currentResolution.width !== undefined && currentResolution.height !== undefined}
  <div
    use:portal
    bind:this={resolutionMenu.element}
    class="resolution-menu"
    style="top: {resolutionMenu.position.top}px; left: {resolutionMenu.position.left}px; visibility: {resolutionMenu.visible ? 'visible' : 'hidden'};"
  >
    <div class="resolution-section save-to-config-section">
      <label class="save-to-config-label">
        <input type="checkbox" aria-label="Sync With Config" checked={resCtrl.menuVM.syncWithConfig} onchange={syncWithConfig} />
        Sync With Config
      </label>
      {#if !resCtrl.menuVM.syncWithConfig}
        <div class="save-to-config-hint">Local Override</div>
      {/if}
      <div class="save-to-config-target">Target: {resCtrl.menuVM.targetLabel}</div>
    </div>

    {#if resCtrl.menuVM.targetKind === "image"}
      <div class="resolution-section">
        <div class="resolution-section-header">
          <h4>Resolution Scale</h4>
          <button class="reset-resolution-btn" onclick={resetResolution}>Reset</button>
        </div>
        <div class="scale-buttons">
          {#each [0.25, 0.5, 1, 2, 4] as scale}
            <button class="resolution-option menu-title" class:active={currentResolution.scale === scale} onclick={() => selectResolutionScale(scale)}>{scale}x</button>
          {/each}
        </div>
      </div>
      <div class="resolution-section">
        <h4>Fixed Size</h4>
        <div class="custom-resolution-row">
          <input type="number" class="custom-res-input" placeholder="W" min="1" step="1" bind:value={widthInput} oninput={applyCustomResolution} />
          <span class="custom-res-separator">&times;</span>
          <input type="number" class="custom-res-input" placeholder="H" min="1" step="1" bind:value={heightInput} oninput={applyCustomResolution} />
          {#if hasCustom}
            <button class="custom-res-btn clear-btn" onclick={clearCustomResolution}>Clear</button>
          {/if}
        </div>
      </div>
      <div class="resolution-section">
        <h4>Aspect Ratio</h4>
        <div class="scale-buttons">
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "16:9"} disabled={hasCustom} onclick={() => resCtrl.setAspectRatio("16:9")}>16:9</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "4:3"} disabled={hasCustom} onclick={() => resCtrl.setAspectRatio("4:3")}>4:3</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "1:1"} disabled={hasCustom} onclick={() => resCtrl.setAspectRatio("1:1")}>1:1</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "fill"} disabled={hasCustom} onclick={() => resCtrl.setAspectRatio("fill")}>Fill</button>
          <button class="resolution-option menu-title" class:active={currentAspectRatio === "auto"} disabled={hasCustom} onclick={() => resCtrl.setAspectRatio("auto")}>Screen</button>
        </div>
      </div>
    {:else}
      <div class="resolution-section">
        <div class="resolution-section-header">
          <h4>Buffer Resolution</h4>
          <button class="reset-resolution-btn" onclick={resetResolution}>Reset</button>
        </div>
        <div class="scale-buttons">
          <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "none"} onclick={() => resCtrl.setBufferResolutionMode("none")}>Inherit</button>
          <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "fixed"} onclick={() => resCtrl.setBufferResolutionMode("fixed")}>Fixed px</button>
          <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.mode === "scale"} onclick={() => resCtrl.setBufferResolutionMode("scale")}>Scale</button>
        </div>
      </div>
      {#if resCtrl.menuVM.bufferResolutionState.mode === "fixed"}
        <div class="resolution-section">
          <h4>Fixed Size</h4>
          <div class="custom-resolution-row">
            <input type="number" class="custom-res-input" placeholder="Width" min="1" step="1" value={resCtrl.menuVM.bufferResolutionState.width} oninput={setBufferWidth} />
            <span class="custom-res-separator">&times;</span>
            <input type="number" class="custom-res-input" placeholder="Height" min="1" step="1" value={resCtrl.menuVM.bufferResolutionState.height} oninput={setBufferHeight} />
          </div>
        </div>
      {/if}
      {#if resCtrl.menuVM.bufferResolutionState.mode === "scale"}
        <div class="resolution-section">
          <h4>Resolution Scale</h4>
          <div class="scale-buttons">
            {#each [0.25, 0.5, 1, 2, 4] as scale}
              <button class="resolution-option menu-title" class:active={resCtrl.menuVM.bufferResolutionState.scale === scale} onclick={() => resCtrl.setBufferScale(scale)}>{scale}x</button>
            {/each}
          </div>
        </div>
      {/if}
    {/if}

    <div class="resolution-section">
      <h4>Zoom</h4>
      <div class="zoom-control">
        <label for="zoom-slider">Zoom: {zoomLevel.toFixed(1)}x</label>
        <input id="zoom-slider" type="range" min="0.1" max="3.0" step="0.1" bind:value={zoomLevel} oninput={changeZoom} class="zoom-slider" />
      </div>
    </div>
    <div class="resolution-section save-to-config-section">
      <label class="save-to-config-label">
        <input type="checkbox" checked={currentResolution.forceBlackBackground} onchange={setBlackBackground} />
        Black canvas background
      </label>
    </div>
  </div>
{/if}
