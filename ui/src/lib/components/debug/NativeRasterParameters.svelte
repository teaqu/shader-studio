<script lang="ts">
  import type { DebugParameterInfo } from "../../types/ShaderDebugState";

  interface Props {
    parameters: DebugParameterInfo[];
  }

  let { parameters }: Props = $props();
</script>

{#each parameters as param}
  <div class="native-parameter-row" data-testid="native-raster-parameter">
    <span>{param.name}: {param.type}</span>
    <span class="gpu-provided">GPU-provided</span>
  </div>
{/each}
<span class="hint-text">Native raster inputs are provided by the GPU.</span>

<style>
  .native-parameter-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
  }

  .gpu-provided {
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint-text {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    font-size: 12px;
  }
</style>
