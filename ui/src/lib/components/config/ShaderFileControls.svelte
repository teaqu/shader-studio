<script lang="ts">
  import type { FileDialogFileType, ShaderConfig, ShaderLanguageId, MessageEvent as ViewerMessage } from '@shader-studio/types';
  import type { CreatedSource } from '../../config/PassSourceAuthoring';
  import { configSourcePaths } from '../../config/configSourcePaths';
  import { portal } from '../../actions/portal';
  import PathInput from './PathInput.svelte';
  import { getDefaultAuthoringMode } from '../../state/authoringModeState.svelte';

  interface Props {
    value: string; shaderPath: string; language: ShaderLanguageId; fileType: FileDialogFileType;
    suggestedPath: string; inputId: string; projectConfig?: ShaderConfig | null; hasError?: boolean;
    passName?: string;
    onPathChange: (path: string) => void; onCreated: (source: CreatedSource) => void;
    postMessage?: (message: ViewerMessage) => void; onMessage?: (handler: (event: MessageEvent) => void) => void;
  }
  let { value, shaderPath, language, fileType, suggestedPath, inputId, projectConfig, hasError = false,
    onPathChange, onCreated, postMessage, onMessage, passName }: Props = $props();
  let open = $state(false);
  const paths = $derived(configSourcePaths(projectConfig, shaderPath, language));
  function accept(source: CreatedSource) {
 open = false; onCreated(source);
}
</script>
<svelte:window onkeydown={(event) => {
 if (event.key === 'Escape') {
open = false;
}
}} />

<div class="file-row">
  <PathInput {value} label="File" {inputId} {onPathChange} {hasError} allowSelect={false} allowCreate={false} />
  <button type="button" onclick={() => open = true}>Change…</button>
</div>
{#if open}
  <div use:portal class="backdrop" role="presentation">
    <div class="chooser" role="dialog" tabindex="-1" aria-modal="true" aria-label="Choose shader file">
      <header><h3>Choose shader file</h3><button type="button" aria-label="Close file chooser" onclick={() => open = false}>×</button></header>
      <p>Files in this config</p>
      <div class="files">{#each paths as path}<button type="button" onclick={() => {
 open = false; onPathChange(path);
}}>{path}</button>{/each}</div>
      <PathInput value="" hidePath={true} showSelectWhenHidden={true} {shaderPath} {suggestedPath} {fileType} {postMessage} {onMessage}
        {passName} createAuthoringMode={getDefaultAuthoringMode()} selectLabel="Browse workspace…" onCreated={accept} />
    </div>
  </div>
{/if}

<style>
  .file-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  button { box-sizing: border-box; min-height: 33px; padding: 6px 9px; font: 400 13px/1.4 var(--vscode-font-family, "Segoe UI", sans-serif); background: transparent; color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-list-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .backdrop { position: fixed; inset: 0; display: flex; justify-content: center; align-items: center; background: rgba(0,0,0,.45); z-index: 1000; padding: 16px; }
  .chooser { width: 420px; max-width: 100%; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 5px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h3 { font-size: 13px; margin: 0; } p { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .files { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; } .files button { text-align: left; overflow-wrap: anywhere; }
</style>
