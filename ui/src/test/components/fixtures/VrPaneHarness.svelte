<script lang="ts">
  import VrPreviewButton from '../../../lib/components/menu/VrPreviewButton.svelte';
  import VrSettings from '../../../lib/components/menu/VrSettings.svelte';
  import { isVrPanelVisible } from '../../../lib/state/vrPreviewState.svelte';
  const visible = $derived(isVrPanelVisible());
</script>
<VrPreviewButton />
{#if visible}<VrSettings />{/if}
