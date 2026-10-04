<script lang="ts">
  import type { ShaderConfig, BufferPass, ImagePass, ShaderLanguageId, FileDialogFileType, MessageEvent as ViewerMessage } from '@shader-studio/types';
  import { applyVertexSource, clearVertexSource } from '../../config/PassSourceAuthoring';
  import ShaderFileControls from './ShaderFileControls.svelte';

  interface Props {
    pass: BufferPass | ImagePass; projectConfig?: ShaderConfig | null; passSource: string; vertexSource: string;
    language: ShaderLanguageId; sourcePath: string; passName: string; vertexSpace: string; geometryType: string;
    fileType: FileDialogFileType; suggestedPath: string; shaderPath: string;
    onPathChange: (path: string) => void; onCommit: (pass: BufferPass | ImagePass) => void;
    postMessage?: (message: ViewerMessage) => void; onMessage?: (handler: (event: MessageEvent) => void) => void;
  }
  let { pass, projectConfig, language, sourcePath, passName, fileType, suggestedPath, shaderPath,
    onPathChange, onCommit, postMessage, onMessage }: Props = $props();
  let separate = $state(false);
  const mode = $derived(separate ? 'separate' : pass.vertex && pass.vertex === sourcePath ? 'same'
    : pass.vertex ? 'separate' : pass.entryPoints?.vertex ? 'same' : 'builtin');
  function selectSource(value: string) {
    separate = value === 'separate';
    if (value === 'builtin') {
      onCommit(clearVertexSource(pass));
    } else if (value === 'same') {
      onPathChange(sourcePath);
    }
  }
</script>

<div class="source-options" class:has-file={mode === 'separate'} role="group" aria-label="Vertex source">
  {#each [{ value: 'builtin', label: 'Built-in' }, { value: 'same', label: 'Same file' }, { value: 'separate', label: 'Separate file' }] as option}
    <button type="button" aria-pressed={mode === option.value} onclick={() => selectSource(option.value)}>{option.label}</button>
  {/each}
</div>
{#if mode === 'separate'}
  <ShaderFileControls value={pass.vertex ?? ''} {onPathChange} {projectConfig} {language} {fileType} {suggestedPath} {shaderPath}
    inputId={"vertex-source-" + passName} {passName} {postMessage} {onMessage}
    onCreated={(result) => onCommit(applyVertexSource(pass, result))} />
{/if}

<style>
  .source-options { display: flex; }
  .source-options.has-file { margin-bottom: 12px; }
  button { padding: 6px 9px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); cursor: pointer; }
  .source-options button { flex: 1; } .source-options button[aria-pressed='true'] { background: var(--vscode-list-activeSelectionBackground); border-color: var(--vscode-focusBorder); }
  .source-options button { display: flex; align-items: center; justify-content: center; gap: 6px; }
</style>
