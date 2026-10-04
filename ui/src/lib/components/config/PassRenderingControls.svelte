<script lang="ts">
  import type { DepthSettings, BlendMode, CullMode, SampleCount } from '@shader-studio/types';
  import DepthTestingControls from './DepthTestingControls.svelte';
  interface Props {
    bufferName: string; blend: BlendMode; clearHex: string; clearAlpha: number; depth: Required<DepthSettings> | null; cull: CullMode; samples: SampleCount;
    onBlend: (event: Event) => void; onColor: (event: Event) => void; onAlpha: (event: Event) => void;
    onCull: (event: Event) => void; onSamples: (event: Event) => void; onDepth: (value: DepthSettings) => void;
  }
  let { bufferName, blend, clearHex, clearAlpha, depth, cull, samples, onBlend, onColor, onAlpha, onCull, onSamples, onDepth }: Props = $props();
</script>
<section class="rendering">
  <h3 class="section-title">Rendering</h3>
  <div class="row"><label for={`blend-${bufferName}`}>Blend</label><select id={`blend-${bufferName}`} value={blend} onchange={onBlend}><option value="none">None</option><option value="alpha">Alpha</option><option value="premultiplied">Premultiplied alpha</option><option value="additive">Additive</option></select></div>
  <div class="row"><label for={`clear-color-${bufferName}`}>Clear colour</label><input id={`clear-color-${bufferName}`} type="color" value={clearHex} onchange={onColor} /></div>
  <div class="row"><label for={`clear-alpha-${bufferName}`}>Clear alpha</label><input id={`clear-alpha-${bufferName}`} type="number" min="0" max="1" step="0.05" value={clearAlpha} onchange={onAlpha} /></div>
  {#if depth}
    <div class="row"><label for={`cull-${bufferName}`}>Cull</label><select id={`cull-${bufferName}`} value={cull} onchange={onCull}><option value="none">None</option><option value="back">Back faces</option><option value="front">Front faces</option></select></div>
    <div class="row"><label for={`samples-${bufferName}`}>Antialiasing</label><select id={`samples-${bufferName}`} value={String(samples)} onchange={onSamples}><option value="1">Off</option><option value="4">4× MSAA</option></select></div>
    <details><summary>Depth settings</summary><DepthTestingControls {bufferName} {depth} onChange={onDepth} /></details>
  {/if}
</section>
<style>
  .rendering { display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0 0 8px; padding-bottom: 6px; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border); }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } label { font-size: 12px; min-width: 80px; color: var(--vscode-descriptionForeground); }
  input, select { min-width: 0; padding: 4px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; }
  input[type='number'] { width: 80px; } input[type='color'] { width: 44px; height: 28px; padding: 2px; }
  summary { font-size: 12px; color: var(--vscode-descriptionForeground); cursor: pointer; margin-bottom: 8px; }
</style>
