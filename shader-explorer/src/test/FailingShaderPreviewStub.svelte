<svelte:options runes={true} />
<script lang="ts">
  import { untrack } from 'svelte';
  import type { ShaderFile } from '../lib/types/ShaderFile';

  interface Props {
    shader: ShaderFile;
    onCompilationFailed?: () => void;
  }

  let { shader, onCompilationFailed }: Props = $props();

  // Versions below 2 stand in for a shader that fails to compile.
  $effect(() => {
    if ((shader.thumbnailVersion ?? 0) < 2) {
      // The real preview reports failure asynchronously, outside this effect.
      untrack(() => onCompilationFailed?.());
    }
  });
</script>
