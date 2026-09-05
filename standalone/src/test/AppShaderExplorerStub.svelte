<script lang="ts">
  interface Props {
    compact: boolean;
    selectedShaderPath: string;
  }

  let { compact, selectedShaderPath }: Props = $props();
</script>

<div data-testid="shader-explorer" data-compact={compact} data-selected-path={selectedShaderPath}>Explorer</div>
