<script lang="ts">
  import ShaderViewer from './lib/ShaderViewer.svelte';

  function handleAppInitialized(data: any) {
    console.log('Shader viewer initialized successfully', data);
  }
</script>

<ShaderViewer onInitialized={handleAppInitialized} />