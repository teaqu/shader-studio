<svelte:options runes={true} />
<script lang="ts">
  import { isVrPanelVisible, toggleVrPanel } from '../../state/vrPreviewState.svelte';
  const visible = $derived(isVrPanelVisible());
</script>

<button class:active={visible} class="toolbar-icon-button" aria-label="VR" aria-pressed={visible}
  title="VR preview and headset settings" onclick={toggleVrPanel}>VR</button>
