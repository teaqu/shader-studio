<script lang="ts">
  import ShaderViewer from "./components/ShaderViewer.svelte";

  function handleAppInitialized(data: any) {
    console.log("Shader viewer initialized successfully", data);
  }
</script>

<ShaderViewer onInitialized={handleAppInitialized} />
