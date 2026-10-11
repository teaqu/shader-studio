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
    summary?: boolean;
    onOpen?: () => void;
    onPathChange: (path: string) => void; onCreated: (source: CreatedSource) => void;
    postMessage?: (message: ViewerMessage) => void; onMessage?: (handler: (event: MessageEvent) => void) => void;
  }
  let { value, shaderPath, language, fileType, suggestedPath, inputId, projectConfig, hasError = false,
    onPathChange, onCreated, postMessage, onMessage, passName, summary = false, onOpen }: Props = $props();
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

{#if summary}
<div class="file-summary">
  <div class="summary-label">Shader file</div>
  <div class="summary-file">
    <i class="codicon codicon-file-code" aria-hidden="true"></i>
    <div class="summary-details">
      <div>{value ? value.split(/[/\\]/).pop() : 'No shader file selected'}</div>
      <div class="summary-path">{value || 'Choose an existing shader or create a new one.'}</div>
    </div>
  </div>
  <div class="summary-actions">
    {#if value}
      <button class="open-editor-btn" type="button" onclick={onOpen} disabled={!onOpen}>
        <i class="codicon codicon-go-to-file" aria-hidden="true"></i>Open in editor
      </button>
    {/if}
    <button class:choose-primary={!value} type="button" onclick={() => open = true}>{value ? 'Choose another file…' : 'Choose file…'}</button>
    {#if !value}
      <PathInput {value} hidePath={true} allowSelect={false} createLabel="Create shader…"
        {shaderPath} {suggestedPath} {fileType} {postMessage} {onMessage} {passName}
        createAuthoringMode={fileType.endsWith('-compute') ? 'native' : getDefaultAuthoringMode()} onCreated={accept} />
    {/if}
  </div>
  {#if !value}
    <button class="open-editor-btn" type="button" disabled>Open in editor</button>
    <div class="summary-path">Available once a shader file exists.</div>
  {/if}
</div>
{:else}
<div class="file-row">
  <PathInput {value} placeholder={suggestedPath} label="File" {inputId} {onPathChange} {hasError} allowSelect={false} allowCreate={false} />
  <button type="button" onclick={() => open = true}>Change…</button>
</div>
{/if}
{#if open}
  <div use:portal class="backdrop" role="presentation">
    <div class="chooser" role="dialog" tabindex="-1" aria-modal="true" aria-label="Choose shader file">
      <header><h3>Choose shader file</h3><button type="button" aria-label="Close file chooser" onclick={() => open = false}>×</button></header>
      <p>Files in this config</p>
      <div class="files">{#each paths as path}<button type="button" onclick={() => {
 open = false; onPathChange(path);
}}>{path}</button>{/each}</div>
      <PathInput value="" hidePath={true} showSelectWhenHidden={true} {shaderPath} {suggestedPath} {fileType} {postMessage} {onMessage}
        {passName} createAuthoringMode={fileType.endsWith('-compute') ? 'native' : getDefaultAuthoringMode()} selectLabel="Browse workspace…" onCreated={accept} />
      {#if summary}
        <div class="chooser-path">
        <PathInput {value} {inputId} label="Shader file path" {hasError} placeholder={suggestedPath}
          onPathChange={onPathChange} allowCreate={false} allowSelect={false}
          note="Relative, absolute, or @ for workspace root" />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .file-summary { display: flex; flex-direction: column; gap: 8px; }
  .summary-label { font-size: 14px; font-weight: 500; color: var(--vscode-foreground); }
  .summary-file { display: flex; align-items: center; gap: 10px; color: var(--vscode-foreground); }
  .summary-details { min-width: 0; overflow-wrap: anywhere; }
  .summary-path { font-size: 12px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .summary-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .open-editor-btn { align-self: flex-start; }
  .open-editor-btn, .choose-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
  .open-editor-btn:hover:not(:disabled), .choose-primary:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .file-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  button { box-sizing: border-box; min-height: 33px; padding: 6px 9px; font: 400 13px/1.4 var(--vscode-font-family, "Segoe UI", sans-serif); background: transparent; color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-list-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .backdrop { position: fixed; inset: 0; display: flex; justify-content: center; align-items: center; background: rgba(0,0,0,.45); z-index: 1000; padding: 16px; }
  .chooser { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; width: 420px; max-width: 100%; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 5px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h3 { font-size: 13px; margin: 0; } p { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .files { display: flex; flex-direction: column; gap: 5px; } .files button { text-align: left; overflow-wrap: anywhere; }
  .chooser-path :global(.input-row) { flex-direction: column; align-items: stretch; gap: 6px; }
  .chooser-path :global(.config-input) { box-sizing: border-box; width: 100%; min-width: 0; }
  .chooser-path :global(.input-note) { font-size: 12px; font-style: normal; }
</style>
