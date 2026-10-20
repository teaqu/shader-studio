<script lang="ts">
  import { onMount } from 'svelte';
  import type { ShaderEditorProps } from '../editor/ShaderEditorProps';
  import { getHostEditorPreferences } from '../state/hostState.svelte';
  import MonacoShaderEditor from './MonacoShaderEditor.svelte';
  import CodeMirrorShaderEditor from './CodeMirrorShaderEditor.svelte';

  interface Props extends ShaderEditorProps {}
  let { ...props }: Props = $props();
  let mobile = $state(window.matchMedia?.('(max-width: 767px), (pointer: coarse)')?.matches ?? false);
  const engine = $derived(mobile
    ? getHostEditorPreferences()?.().mobileEditor ?? 'codemirror'
    : getHostEditorPreferences()?.().desktopEditor ?? 'monaco');

  onMount(() => {
    const media = window.matchMedia?.('(max-width: 767px), (pointer: coarse)');
    if (!media) {
      return;
    }
    const update = () => {
      mobile = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
</script>

{#if engine === 'codemirror'}
  <CodeMirrorShaderEditor {...props} />
{:else}
  <MonacoShaderEditor {...props} />
{/if}
