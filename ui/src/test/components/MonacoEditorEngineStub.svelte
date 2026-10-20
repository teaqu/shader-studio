<script lang="ts">
  interface Props { isVisible?: boolean; }
  let { isVisible = false }: Props = $props();
</script>
{#if isVisible}<div data-editor-engine="monaco"></div>{/if}
