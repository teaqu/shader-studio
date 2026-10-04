<svelte:options runes={true} />

<script lang="ts">
  import type { BufferPass, ImagePass, ShaderEntryPoint, ShaderLanguageId } from '@shader-studio/types';

  type RenderPass = BufferPass | ImagePass;
  type Stage = 'vertex' | 'fragment';

  interface Props {
    pass: RenderPass;
    entryPoints?: ShaderEntryPoint[];
    language?: ShaderLanguageId;
    onCommit: (pass: RenderPass) => void;
    authoringControls?: import('svelte').Snippet<[Stage]>;
  }

  let { pass, entryPoints = [], language = 'wgsl', onCommit, authoringControls }: Props = $props();

  const vertexEntries = $derived(entryPoints.filter((entry) => entry.stage === 'vertex'));
  const fragmentEntries = $derived(entryPoints.filter((entry) => entry.stage === 'fragment'));

  function entriesFor(stage: Stage): ShaderEntryPoint[] {
    return stage === 'vertex' ? vertexEntries : fragmentEntries;
  }

  function selected(stage: Stage): string {
    return pass.entryPoints?.[stage] ?? '';
  }

  function setEntryPoint(stage: Stage, name: string) {
    const current = pass.entryPoints ?? {};
    const next = { ...current };
    if (name) {
      next[stage] = name;
    } else {
      delete next[stage];
    }
    onCommit({ ...pass, entryPoints: next });
  }

  function nativeFunctionLabel(stage: Stage): string {
    return language === 'slang' ? `[shader("${stage}")]` : `@${stage}`;
  }
</script>

<section class="entry-point-controls" aria-label="Render entry points">
  <h3>Shader functions</h3>
  {#each ['vertex', 'fragment'] as stage}
    {@const stageName = stage as Stage}
    {@const candidates = entriesFor(stageName)}
    {@const current = selected(stageName)}
    <div class="function-row" role="group" aria-label={`${stage === 'vertex' ? 'Vertex' : 'Fragment'} function controls`}>
    <label>{stage === 'vertex' ? 'Vertex function' : 'Fragment function'}
      <select aria-label={`${stage === 'vertex' ? 'Vertex' : 'Fragment'} function`} value={current} onchange={(event) => setEntryPoint(stageName, event.currentTarget.value)}>
        <option value="">{stage === 'vertex' ? 'Built-in / mainVertex' : 'mainImage'}</option>
        {#if current && !candidates.some((entry) => entry.name === current)}
          <option value={current}>{current} (missing)</option>
        {/if}
        {#each candidates as entry}<option value={entry.name}>{nativeFunctionLabel(stageName)} {entry.name}</option>{/each}
      </select>
    </label>
    {#if authoringControls}{@render authoringControls(stageName)}{/if}
    </div>
  {/each}
</section>

<style>
  .entry-point-controls { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; padding-bottom: 6px; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); }
  label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .function-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  select { min-width: 140px; padding: 4px 6px; border-radius: 4px; color: var(--vscode-input-foreground, #ccc); background: var(--vscode-input-background, #3c3c3c); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c)); }
</style>
