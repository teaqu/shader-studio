<svelte:options runes={true} />

<script lang="ts">
  import { clearCubemapPreview, getCubemapPreview, setCubemapPreview } from '../../state/cubemapPreview.svelte';
  import type { CubemapFace, CubemapPreviewMode } from '../../cubemapPreview';

  interface Props { shaderPath: string; passName: string; }
  let { shaderPath, passName }: Props = $props();
  const preview = $derived(getCubemapPreview(shaderPath));

  function update(next: Partial<{ mode: CubemapPreviewMode; face: CubemapFace }>) {
    setCubemapPreview(shaderPath, { passName, mode: next.mode ?? preview.mode, face: next.face ?? preview.face });
  }
  function selectOutput(value: string) {
    if (value === 'image') {
      clearCubemapPreview(shaderPath);
      return;
    }
    update({ mode: value as CubemapPreviewMode });
  }
</script>

<div class="cubemap-preview-controls">
  <label>Preview
  <select aria-label="Cubemap preview mode" value={preview.passName === passName ? preview.mode : 'image'} onchange={(event) => selectOutput(event.currentTarget.value)}>
    <option value="image">Image output</option>
    <option value="face">Face</option>
    <option value="layout">Cross layout</option>
    <option value="environment">Environment</option>
  </select>
  </label>
  {#if preview.passName === passName && preview.mode === 'face'}
    <label>Face
    <select aria-label="Cubemap face" value={preview.face} onchange={(event) => update({ face: event.currentTarget.value as CubemapFace })}>
      <option value="positive-x">+X</option><option value="negative-x">-X</option>
      <option value="positive-y">+Y</option><option value="negative-y">-Y</option>
      <option value="positive-z">+Z</option><option value="negative-z">-Z</option>
    </select>
    </label>
  {/if}
</div>
