<svelte:options runes={true} />
<script lang="ts">
  import { getVrPreviewState, isVrPanelVisible, toggleVrPanel } from '../../state/vrPreviewState.svelte';
  const state = $derived(getVrPreviewState());
  const visible = $derived(isVrPanelVisible());
</script>

{#if state.available}
  <button class:active={visible} class="toolbar-icon-button" aria-label="VR" aria-pressed={visible}
    title="VR preview and headset settings" onclick={toggleVrPanel}>VR</button>
{/if}
