<script lang="ts">
  import type { GeometryType } from '@shader-studio/types';

  interface Props {
    geometry: GeometryType;
    showViewerCamera: boolean;
    useViewerCamera: boolean;
    onGeometryChange: (geometry: GeometryType) => void;
    onUseViewerCameraChange: (useViewerCamera: boolean) => void;
  }

  let { geometry, showViewerCamera, useViewerCamera, onGeometryChange, onUseViewerCameraChange }: Props = $props();
</script>

<h3 class="section-title">Geometry</h3>
<select aria-label="Geometry" value={geometry} onchange={(event) => onGeometryChange((event.currentTarget as HTMLSelectElement).value as GeometryType)}>
  <option value="fullscreen">Fullscreen</option>
  <option value="plane">Plane</option>
  <option value="cube">Cube</option>
  <option value="sphere">Sphere</option>
  <option value="model">GLB model</option>
</select>
{#if showViewerCamera}
  <label class="viewer-camera-row" title="When disabled, vertex positions must already be in WebGPU clip space.">
    <input aria-label="Use viewer camera" type="checkbox" checked={useViewerCamera} onchange={(event) => onUseViewerCameraChange(event.currentTarget.checked)} />
    Use viewer camera
  </label>
{/if}

<style>
  .section-title {
    margin: 0 0 8px 0;
    padding-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground, #cccccc);
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
  }
  select { padding: 3px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; font-size: 12px; outline: none; }
  select:focus { border-color: var(--vscode-focusBorder, #007acc); }
  .viewer-camera-row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vscode-foreground, #cccccc); cursor: pointer; }
  .viewer-camera-row input { margin: 0; }
</style>
