<script lang="ts">
  import { getShaderOutputs, type BufferOutputFormat, type ShaderLanguageId } from '@shader-studio/types';
  import OutputFormatControl from './OutputFormatControl.svelte';
  interface Props {
    source: string; language: ShaderLanguageId; fragment?: string; format: BufferOutputFormat;
    maxAttachments: number; maxBytes: number; onchange: (event: Event) => void;
  }
  let { source, language, fragment, format, maxAttachments, maxBytes, onchange }: Props = $props();
  const discovery = $derived(getShaderOutputs(source, language, fragment));
  const limit = $derived(Math.min(maxAttachments, Math.floor(maxBytes / (format === 'rgba16float' ? 8 : 16))));
</script>
<section class="config-item" aria-label="Output">
  <h3 class="section-title">Output</h3>
  <OutputFormatControl value={format} {onchange} />
  {#if discovery.error}<p class="error" role="alert">{discovery.error}</p>
  {:else}
    <div class="outputs" aria-label="Detected output textures">
      {#each discovery.outputs as output}<div>Output {output.slot}{output.name ? ` · ${output.name}` : ''}</div>{/each}
    </div>
    {#if discovery.outputs.length > limit}<p class="error" role="alert">This format supports up to {limit} outputs on this device.</p>{/if}
  {/if}
</section>
<style>
  .config-item, .outputs { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0 0 8px; padding-bottom: 6px; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border); }
  .outputs { font-size: 12px; } .error { color: var(--vscode-errorForeground); margin: 0; font-size: 12px; }
</style>
