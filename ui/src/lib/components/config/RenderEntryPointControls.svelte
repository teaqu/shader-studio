<svelte:options runes={true} />

<script lang="ts">
  import type { BufferPass, ImagePass, ShaderEntryPoint } from '@shader-studio/types';

  type RenderPass = BufferPass | ImagePass;
  type Stage = 'vertex' | 'fragment';

  interface Props {
    pass: RenderPass;
    entryPoints?: ShaderEntryPoint[];
    onCommit: (pass: RenderPass) => void;
  }

  let { pass, entryPoints = [], onCommit }: Props = $props();

  const native = $derived(pass.entryPoints !== undefined);
  const vertexEntries = $derived(entryPoints.filter((entry) => entry.stage === 'vertex'));
  const fragmentEntries = $derived(entryPoints.filter((entry) => entry.stage === 'fragment'));

  function entriesFor(stage: Stage): ShaderEntryPoint[] {
    return stage === 'vertex' ? vertexEntries : fragmentEntries;
  }

  function selected(stage: Stage): string {
    return pass.entryPoints?.[stage] ?? (entriesFor(stage).length === 1 ? entriesFor(stage)[0]!.name : '');
  }

  function setAuthoring(mode: 'hooks' | 'native') {
    if (mode === 'hooks') {
      const { entryPoints: _entryPoints, ...hooksPass } = pass;
      onCommit(hooksPass);
      return;
    }
    const { vertex: _vertex, ...nativePass } = pass;
    onCommit({
      ...nativePass,
      entryPoints: {
        ...(vertexEntries.length === 1 ? { vertex: vertexEntries[0]!.name } : {}),
        ...(fragmentEntries.length === 1 ? { fragment: fragmentEntries[0]!.name } : {}),
      },
    });
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
</script>

<section class="entry-point-controls" aria-label="Render entry points">
  <h3>Shader entry points</h3>
  <label>Authoring
    <select aria-label="Render authoring" value={native ? 'native' : 'hooks'} onchange={(event) => setAuthoring(event.currentTarget.value as 'hooks' | 'native')}>
      <option value="hooks">ShaderToy hooks</option>
      <option value="native">Native WebGPU entry points</option>
    </select>
  </label>

  {#if native}
    {#each ['vertex', 'fragment'] as stage}
      {@const candidates = entriesFor(stage as Stage)}
      {@const current = selected(stage as Stage)}
      <label>{stage === 'vertex' ? 'Vertex' : 'Fragment'}
        <select aria-label={`${stage === 'vertex' ? 'Vertex' : 'Fragment'} entrypoint`} value={current} onchange={(event) => setEntryPoint(stage as Stage, event.currentTarget.value)}>
          <option value="">Select entry point</option>
          {#if current && !candidates.some((entry) => entry.name === current)}
            <option value={current}>{current} (missing)</option>
          {/if}
          {#each candidates as entry}<option value={entry.name}>{entry.name}</option>{/each}
        </select>
      </label>
    {/each}
    {#if entryPoints.length === 0}
      <p>Current source has no native WebGPU entry points.</p>
    {/if}
  {/if}
</section>

<style>
  .entry-point-controls { display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; padding-bottom: 6px; font-size: 13px; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); }
  label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  select { min-width: 140px; padding: 3px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
  p { margin: 0; color: var(--vscode-descriptionForeground, #888); font-size: 12px; }
</style>
