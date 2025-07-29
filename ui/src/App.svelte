<script lang="ts">
  import { onMount } from "svelte";
  import ShaderViewer from "./lib/components/ShaderViewer.svelte";
  import { currentTheme, applyTheme } from "./lib/stores/themeStore";

  function handleAppInitialized(data: { shaderStudio: any }) {
    console.log("Shadera initialized successfully", data);
  }

  onMount(() => {
    const unsubscribe = currentTheme.subscribe(theme => {
      applyTheme(theme);
    });

    return unsubscribe;
  });
</script>

<ShaderViewer onInitialized={handleAppInitialized} />
