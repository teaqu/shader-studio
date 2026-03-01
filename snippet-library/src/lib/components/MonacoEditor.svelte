<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { setupMonacoGlsl } from '@shader-studio/monaco';

  let { value = '', onChange, readOnly = false, language = 'glsl', height = 300 }: {
    value?: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
    language?: string;
    height?: number;
  } = $props();

  let container: HTMLDivElement = $state()!;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;

  onMount(async () => {
    const monaco = await import('monaco-editor');

    setupMonacoGlsl(monaco);

    editor = monaco.editor.create(container, {
      value,
      language,
      theme: 'shader-studio',
      minimap: { enabled: false },
      tabSize: 4,
      insertSpaces: false,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      padding: { top: 0, bottom: 0 },
      lineNumbers: 'on',
      fontSize: 13,
      wordWrap: 'on',
      renderWhitespace: 'selection',
      readOnly,
    });

    editor.onDidChangeModelContent(() => {
      const newValue = editor?.getValue() ?? '';
      onChange?.(newValue);
    });
  });

  onDestroy(() => {
    editor?.dispose();
    editor = null;
  });

  $effect(() => {
    if (editor && value !== editor.getValue()) {
      editor.setValue(value);
    }
  });
</script>

<div bind:this={container} class="monaco-container" style="height: {height}px"></div>

<style>
  .monaco-container {
    width: 100%;
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 4px;
    overflow: hidden;
  }
</style>
