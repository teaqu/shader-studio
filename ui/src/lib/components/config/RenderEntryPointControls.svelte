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
    stage?: Stage;
    showFragmentHook?: boolean;
  }

  let { pass, entryPoints = [], language = 'wgsl', onCommit, authoringControls, stage: onlyStage, showFragmentHook = true }: Props = $props();

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
  {#if !onlyStage}<h3>Shader functions</h3>{/if}
  {#each onlyStage ? [onlyStage] : ['vertex', 'fragment'] as stage}
    {@const stageName = stage as Stage}
    {@const candidates = entriesFor(stageName)}
    {@const current = selected(stageName)}
    <div class="function-row" class:compact={stage === 'fragment'} role="group" aria-label={`${stage === 'vertex' ? 'Vertex' : 'Fragment'} function controls`}>
    {#if stage === 'fragment'}
      {@const hasCurrent = !!current && candidates.some(entry => entry.name === current)}
      {@const missing = !!current && !hasCurrent}
      {@const count = candidates.length + (showFragmentHook ? 1 : 0) + (missing ? 1 : 0)}
      <span class="function-label">Function</span>
      <div class="fragment-choice">
        {#if count > 1 || (!current && !showFragmentHook && count > 0)}
          <select aria-label="Fragment function" class:missing onchange={(event) => setEntryPoint('fragment', event.currentTarget.value)} value={current}>
            {#if !current && !showFragmentHook}<option value="" disabled>Choose function</option>{/if}
            {#if showFragmentHook}<option value="">mainImage</option>{/if}
            {#if missing}<option value={current}>{current} (missing)</option>{/if}
            {#each candidates as entry}<option value={entry.name}>{entry.name === 'mainImage' ? 'mainImage (native)' : entry.name}</option>{/each}
          </select>
        {:else if count === 1}
          <code aria-label="Fragment function" class:missing>{current || 'mainImage'}{missing ? ' (missing)' : ''}</code>
        {:else}
          <span class="empty-function">No function found</span>
        {/if}
      </div>
    {:else}
    <fieldset>
      <legend>{stage === 'vertex' ? 'Vertex functions' : 'Fragment functions'}</legend>
      {#if stage === 'vertex' || showFragmentHook}
        <label class:active={!current}><input type="radio" name={`${stage}-function`} checked={!current} onchange={() => setEntryPoint(stageName, '')} />{stage === 'vertex' ? 'Built-in / mainVertex' : 'mainImage'}</label>
      {/if}
      {#if current && !candidates.some((entry) => entry.name === current)}
        <label class="active missing"><input type="radio" name={`${stage}-function`} checked />{current} (missing)</label>
      {/if}
      {#each candidates as entry}
        <label class:active={current === entry.name}><input type="radio" name={`${stage}-function`} checked={current === entry.name} onchange={() => setEntryPoint(stageName, entry.name)} />{nativeFunctionLabel(stageName)} {entry.name}</label>
      {/each}
    </fieldset>
    {/if}
    {#if authoringControls}{@render authoringControls(stageName)}{/if}
    </div>
  {/each}
</section>

<style>
  .entry-point-controls { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; padding-bottom: 6px; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); }
  label { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 3px; background: var(--vscode-input-background); font: 12px var(--vscode-editor-font-family, monospace); cursor: pointer; overflow-wrap: anywhere; }
  label.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  label.missing { color: var(--vscode-errorForeground); }
  fieldset { display: flex; flex-direction: column; gap: 5px; border: 0; padding: 0; margin: 0; min-width: 0; width: 100%; }
  legend { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
  .function-row { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  .function-row.compact { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  .function-label, .empty-function { color: var(--vscode-descriptionForeground); font-size: var(--shader-studio-label-size); }
  .fragment-choice { min-width: 0; }
  .fragment-choice select { width: 100%; min-width: 0; }
  .fragment-choice code { display: block; overflow-wrap: anywhere; font: var(--shader-studio-font-size) var(--vscode-editor-font-family, monospace); }
  .fragment-choice .missing { color: var(--vscode-errorForeground); }
  input { margin: 0; flex-shrink: 0; accent-color: var(--vscode-focusBorder); }
</style>
