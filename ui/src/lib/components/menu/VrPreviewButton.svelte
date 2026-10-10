<svelte:options runes={true} />
<script lang="ts">
  import { getVrPreviewState, toggleVrPreview, toggleImmersiveVr } from '../../state/vrPreviewState.svelte';
  const state = $derived(getVrPreviewState());
</script>

{#if state.available}
  <button disabled={state.immersive || state.busy} class:active={state.enabled} aria-label="VR preview" aria-pressed={state.enabled}
    title="VR preview — move with WASD/QE; look with mouse drag or IJKL" onclick={toggleVrPreview}>VR</button>
  {#if state.supported}
    <button disabled={state.busy} aria-label={state.immersive ? 'Exit VR' : 'Enter VR'}
      title="Use a WebXR headset" onclick={toggleImmersiveVr}>{state.immersive ? 'Exit VR' : 'Enter VR'}</button>
  {/if}
  {#if state.error}<span role="status">{state.error}</span>{/if}
{/if}

<style>
  button { background: transparent; color: var(--vscode-foreground, inherit); border: 1px solid transparent; border-radius: 4px; cursor: pointer; padding: 4px 6px; }
  button.active { background: var(--vscode-button-background, #345); color: var(--vscode-button-foreground, white); }
</style>
