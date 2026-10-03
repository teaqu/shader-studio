<script lang="ts">
  import type { BufferPass, GeometryType, ImagePass } from '@shader-studio/types';
  import GeometrySelector from './GeometrySelector.svelte';
  import { useViewerCameraDefault } from '../../config/ViewerCameraContext';
  import { getGlobalViewerCamera } from '../../state/viewerCameraState.svelte';

  interface Props {
    config: BufferPass | ImagePass;
    geometry: GeometryType;
    showViewerCamera: boolean;
    onGeometryChange: (geometry: GeometryType) => void;
    onUpdate: (config: BufferPass | ImagePass) => void;
  }
  let { config, geometry, showViewerCamera, onGeometryChange, onUpdate }: Props = $props();
  const shaderDefault = useViewerCameraDefault();
  const inherited = $derived(shaderDefault() ?? getGlobalViewerCamera());

  function reset(): void {
    const { useViewerCamera: _override, ...rest } = config;
    onUpdate(rest);
  }
</script>

<GeometrySelector {geometry} {showViewerCamera} {onGeometryChange}
  useViewerCamera={config.useViewerCamera ?? inherited}
  onUseViewerCameraChange={(useViewerCamera) => onUpdate({ ...config, useViewerCamera })} />
{#if showViewerCamera}
  <div class="camera-inheritance">
    {#if config.useViewerCamera === undefined}
      <span>Using {shaderDefault() === undefined ? 'global' : 'shader'} default</span>
    {:else}
      <button onclick={reset}>Use shader default</button>
    {/if}
  </div>
{/if}

<style>
  .camera-inheritance { font-size: 11px; color: var(--vscode-descriptionForeground); }
  button { color: var(--vscode-textLink-foreground); background: none; border: none; padding: 0; cursor: pointer; font: inherit; }
</style>
