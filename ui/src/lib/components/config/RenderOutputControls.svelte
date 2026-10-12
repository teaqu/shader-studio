<script lang="ts">
  import type { Snippet } from "svelte";
  import { getShaderOutputs, type BufferOutputFormat, type ShaderLanguageId } from '@shader-studio/types';
  import OutputFormatControl from './OutputFormatControl.svelte';
  interface Props {
    source: string; language: ShaderLanguageId; fragment?: string; format: BufferOutputFormat;
    children?: Snippet;
    cubemap?: boolean;
    maxAttachments: number; maxBytes: number; onchange: (event: Event) => void;
  }
  let { source, language, fragment, format, maxAttachments, maxBytes, onchange, children, cubemap = false }: Props = $props();
  const discovery = $derived(getShaderOutputs(source, language, fragment));
  const limit = $derived(Math.min(maxAttachments, Math.floor(maxBytes / (format === 'rgba16float' ? 8 : 16))));
</script>
<section class="config-item" aria-label="Output">
  <h3 class="section-title">Output</h3>
  {@render children?.()}
  <OutputFormatControl value={format} {onchange} />
  {#if cubemap}<div>Six cubemap faces</div>
  {:else if discovery.error}<p class="error" role="alert">{discovery.error}</p>
  {:else}
    {#if discovery.outputs.length > limit}<p class="error" role="alert">This format supports up to {limit} outputs on this device.</p>{/if}
  {/if}
</section>
<style>
  .config-item { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0 0 8px; padding-bottom: 6px; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border); }
  .error { color: var(--vscode-errorForeground); margin: 0; font-size: 12px; }
</style>
