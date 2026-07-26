<script lang="ts">
  import {
    getPreviewSettings,
    resetPreviewCamera,
    resetPreviewMapping,
    resetPreviewObject,
    setPreviewAxesVisible,
    setPreviewGridVisible,
    setPreviewLightingMode,
    setPreviewMappingOffset,
    setPreviewMappingRotation,
    setPreviewMappingScale,
    setPreviewMesh,
    setPreviewMode,
    setPreviewObjectPosition,
    setPreviewObjectRotation,
    setPreviewObjectScale,
    setPreviewWrapMode,
  } from "../../state/preview3dState.svelte";

  interface Props {
    debugUnavailableNote?: string;
  }

  let { debugUnavailableNote }: Props = $props();
  let settings = $derived(getPreviewSettings());
  let settingsOpen = $state(false);

  const meshOptions = [
    ["cube", "Cube"],
    ["sphere", "Sphere"],
    ["plane", "Plane"],
  ] as const;
  const wrapOptions = ["repeat", "mirror", "clamp"] as const;

  function stopCanvasNavigation(event: Event) {
    event.stopPropagation();
  }

  function numericValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }

  function degreesToRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  function radiansToDegrees(radians: number): number {
    return Math.round((radians * 180 * 1000) / Math.PI) / 1000;
  }
</script>

<div
  class="preview-3d-controls"
  role="toolbar"
  aria-label="3D preview controls"
  tabindex="-1"
  onpointerdown={stopCanvasNavigation}
  onclick={stopCanvasNavigation}
  onkeydown={stopCanvasNavigation}
>
  <div class="segmented" role="group" aria-label="Preview mode">
    <button
      type="button"
      aria-pressed={settings.mode === "2d"}
      onclick={() => setPreviewMode("2d")}
    >2D preview</button>
    <button
      type="button"
      aria-pressed={settings.mode === "3d"}
      onclick={() => setPreviewMode("3d")}
    >3D preview</button>
  </div>

  {#if settings.mode === "3d"}
    <div class="quick-controls">
      <div class="choice-row" role="group" aria-label="Preview mesh">
        {#each meshOptions as [mesh, label] (mesh)}
          <button type="button" aria-pressed={settings.mesh === mesh} onclick={() => setPreviewMesh(mesh)}>{label}</button>
        {/each}
      </div>
      <div class="choice-row" role="group" aria-label="Lighting">
        <button type="button" aria-pressed={settings.lighting === "unlit"} onclick={() => setPreviewLightingMode("unlit")}>Unlit</button>
        <button type="button" aria-pressed={settings.lighting === "lit"} onclick={() => setPreviewLightingMode("lit")}>Lit</button>
      </div>
    </div>

    {#if debugUnavailableNote}
      <p class="debug-note" role="status">{debugUnavailableNote}</p>
    {/if}

    <button
      class="settings-toggle"
      type="button"
      aria-expanded={settingsOpen}
      aria-controls="preview-3d-settings"
      onclick={() => (settingsOpen = !settingsOpen)}
    >{settingsOpen ? "Hide 3D settings" : "Show 3D settings"}</button>

    {#if settingsOpen}
      <div id="preview-3d-settings" class="settings">
        <fieldset>
          <legend>Mapping</legend>
          <div class="field-grid">
            <label>Scale X <input aria-label="Mapping scale X" type="number" min="0.05" max="16" step="0.05" value={settings.mapping.scale[0]} oninput={(event) => setPreviewMappingScale(0, numericValue(event))} /></label>
            <label>Scale Y <input aria-label="Mapping scale Y" type="number" min="0.05" max="16" step="0.05" value={settings.mapping.scale[1]} oninput={(event) => setPreviewMappingScale(1, numericValue(event))} /></label>
            <label>Offset X <input aria-label="Mapping offset X" type="number" min="-16" max="16" step="0.05" value={settings.mapping.offset[0]} oninput={(event) => setPreviewMappingOffset(0, numericValue(event))} /></label>
            <label>Offset Y <input aria-label="Mapping offset Y" type="number" min="-16" max="16" step="0.05" value={settings.mapping.offset[1]} oninput={(event) => setPreviewMappingOffset(1, numericValue(event))} /></label>
            <label>Rotation <input aria-label="Mapping rotation" type="number" min="-360" max="360" step="1" value={radiansToDegrees(settings.mapping.rotation)} oninput={(event) => setPreviewMappingRotation(degreesToRadians(numericValue(event)))} /></label>
          </div>
          <div class="choice-row" role="group" aria-label="Texture wrap">
            {#each wrapOptions as wrap (wrap)}
              <button type="button" aria-pressed={settings.mapping.wrap === wrap} onclick={() => setPreviewWrapMode(wrap)}>{wrap}</button>
            {/each}
          </div>
          <button type="button" class="reset" onclick={resetPreviewMapping}>Reset mapping</button>
        </fieldset>

        <fieldset>
          <legend>Object</legend>
          <div class="field-grid">
            {#each ["X", "Y", "Z"] as axis, index (axis)}
              <label>Position {axis} <input aria-label={`Position ${axis}`} type="number" min="-20" max="20" step="0.05" value={settings.object.position[index]} oninput={(event) => setPreviewObjectPosition(index as 0 | 1 | 2, numericValue(event))} /></label>
            {/each}
            {#each ["X", "Y", "Z"] as axis, index (axis)}
              <label>Rotation {axis} <input aria-label={`Rotation ${axis}`} type="number" min="-360" max="360" step="1" value={radiansToDegrees(settings.object.rotation[index])} oninput={(event) => setPreviewObjectRotation(index as 0 | 1 | 2, degreesToRadians(numericValue(event)))} /></label>
            {/each}
            <label>Scale <input aria-label="Uniform scale" type="number" min="0.05" max="10" step="0.05" value={settings.object.scale[0]} oninput={(event) => setPreviewObjectScale(numericValue(event))} /></label>
          </div>
          <button type="button" class="reset" onclick={resetPreviewObject}>Reset object</button>
        </fieldset>

        <fieldset class="scene-controls">
          <legend>Scene</legend>
          <label><input aria-label="Show grid" type="checkbox" checked={settings.scene.grid} onchange={(event) => setPreviewGridVisible((event.currentTarget as HTMLInputElement).checked)} /> Show grid</label>
          <label><input aria-label="Show axes" type="checkbox" checked={settings.scene.axes} onchange={(event) => setPreviewAxesVisible((event.currentTarget as HTMLInputElement).checked)} /> Show axes</label>
        </fieldset>
      </div>
    {/if}

    <button type="button" class="reset-view" onclick={resetPreviewCamera}>Reset view</button>
    <p class="hint">Drag orbit · Shift-drag pan · Scroll zoom</p>
  {/if}
</div>

<style>
  .preview-3d-controls {
    position: absolute;
    z-index: 2;
    top: 0.75rem;
    left: 0.75rem;
    width: min(20rem, calc(100% - 1.5rem));
    max-height: calc(100% - 1.5rem);
    overflow: auto;
    padding: 0.5rem;
    border: 1px solid color-mix(in srgb, var(--border-color, #566) 75%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--background-color, #1c2028) 90%, transparent);
    box-shadow: 0 0.3rem 1.2rem rgb(0 0 0 / 25%);
    color: var(--text-color, #e8edf4);
    font-size: 0.75rem;
    backdrop-filter: blur(0.45rem);
  }

  .segmented, .choice-row, .quick-controls, .field-grid, .scene-controls {
    display: flex;
    gap: 0.3rem;
  }

  .segmented, .quick-controls, .settings-toggle, .debug-note, .hint, .reset-view { margin-top: 0.3rem; }
  .segmented { margin-top: 0; }
  .quick-controls { justify-content: space-between; flex-wrap: wrap; }
  .choice-row { flex-wrap: wrap; }

  button {
    border: 1px solid var(--border-color, #566);
    border-radius: 0.25rem;
    background: var(--panel-background-color, #262d38);
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0.25rem 0.4rem;
  }

  button[aria-pressed="true"] { background: var(--accent-color, #3675d3); border-color: var(--accent-color, #3675d3); }
  .settings-toggle, .reset-view { width: 100%; text-align: left; }
  .reset { margin-top: 0.35rem; }
  .settings { display: grid; gap: 0.45rem; margin-top: 0.35rem; }
  fieldset { min-width: 0; margin: 0; padding: 0.45rem; border: 1px solid var(--border-color, #566); border-radius: 0.3rem; }
  legend { padding: 0 0.2rem; }
  .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field-grid label, .scene-controls label { display: grid; gap: 0.15rem; }
  input[type="number"] { box-sizing: border-box; width: 100%; min-width: 0; background: var(--input-background-color, #111820); border: 1px solid var(--border-color, #566); color: inherit; border-radius: 0.2rem; padding: 0.18rem; }
  .scene-controls { flex-wrap: wrap; }
  .scene-controls label { display: flex; align-items: center; gap: 0.25rem; }
  .hint, .debug-note { margin-bottom: 0; color: var(--muted-text-color, #b5bdca); line-height: 1.3; }
  .debug-note { color: var(--warning-text-color, #f0c674); }

  @media (max-width: 42rem) {
    .preview-3d-controls { top: 0.4rem; left: 0.4rem; width: min(18rem, calc(100% - 0.8rem)); }
  }
</style>
