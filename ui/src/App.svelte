<script lang="ts">
  import ShaderViewer from "./lib/components/ShaderViewer.svelte";

  function handleAppInitialized(data: any) {
    console.log("Shader viewer initialized successfully", data);
  }
</script>

<ShaderViewer onInitialized={handleAppInitialized} />
