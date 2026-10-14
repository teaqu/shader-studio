<script lang="ts">
  import { tick } from 'svelte';
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
    outputKind?: '2d' | 'cubemap';
    onPathChange: (path: string) => void; onCreated: (source: CreatedSource) => void;
    postMessage?: (message: ViewerMessage) => void; onMessage?: (handler: (event: MessageEvent) => void) => void;
  }
  let { value, shaderPath, language, fileType, suggestedPath, inputId, projectConfig, hasError = false,
    onPathChange, onCreated, postMessage, onMessage, passName, summary = false, onOpen, outputKind }: Props = $props();
  let open = $state(false);
  let pickerRoot = $state<HTMLDivElement>();
  let pickerButton = $state<HTMLButtonElement>();
  const paths = $derived(configSourcePaths(projectConfig, shaderPath, language));
  const filename = (path: string) => path.split(/[/\\]/).pop() || path;
  const folder = (path: string) => path.slice(0, path.length - filename(path).length);

  function closeChooser() {
    open = false;
    pickerButton?.focus();
  }

  function accept(source: CreatedSource) {
    closeChooser();
    onCreated(source);
  }

  async function toggleChooser() {
    open = !open;
    if (open && summary) {
      await tick();
      pickerRoot?.querySelector<HTMLButtonElement>('.files button')?.focus();
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (open && event.key === 'Escape') {
      closeChooser();
    }
  }}
  onpointerdown={(event) => {
    if (summary && open && event.target instanceof Node && !pickerRoot?.contains(event.target)) {
      open = false;
    }
  }}
/>

{#snippet chooserContents()}
  <p>Files in this config</p>
  <div class="files">
    {#each paths as path}
      <button type="button" aria-label={path} title={path} onclick={() => {
        closeChooser();
        onPathChange(path);
      }}>
        {#if summary}
          <i class="codicon codicon-file-code" aria-hidden="true"></i>
          <span class="file-details"><span>{filename(path)}</span>{#if folder(path)}<small>{folder(path)}</small>{/if}</span>
          {#if path === value}<i class="codicon codicon-check" aria-hidden="true"></i>{/if}
        {:else}
          {path}
        {/if}
      </button>
    {/each}
  </div>
  <div class:picker-actions={summary}>
    <PathInput value="" hidePath={true} showSelectWhenHidden={true} {shaderPath} {suggestedPath} {fileType} {postMessage} {onMessage}
      {passName} {outputKind} createAuthoringMode={fileType.endsWith('-compute') ? 'native' : getDefaultAuthoringMode()}
      selectLabel="Browse workspace…" createLabel={summary ? 'Create file…' : 'Create'} onCreated={accept} />
  </div>
  {#if summary}
    <details class="chooser-path">
      <summary>Enter a path…</summary>
      <PathInput {value} {inputId} label="Shader file path" {hasError} placeholder={suggestedPath}
        {onPathChange} allowCreate={false} allowSelect={false}
        note="Relative, absolute, or @ for workspace root" />
    </details>
  {/if}
{/snippet}

{#if summary}
  <div class="file-picker" bind:this={pickerRoot}>
    <div class="picker-label">Shader file</div>
    <div class="picker-row">
      <button class="picker-button" class:error={hasError} type="button" bind:this={pickerButton}
        aria-label="Choose shader file" aria-expanded={open} aria-controls={`${inputId}-chooser`}
        aria-haspopup="dialog" title={value || 'Choose file…'} onclick={toggleChooser}>
        <i class="codicon codicon-file-code" aria-hidden="true"></i>
        <span>{value ? filename(value) : 'Choose file…'}</span>
        <i class="codicon codicon-chevron-down" aria-hidden="true"></i>
      </button>
      <button class="open-editor-btn" type="button" disabled={!value || !onOpen} onclick={() => {
        open = false;
        onOpen?.();
      }}>
        <i class="codicon codicon-go-to-file" aria-hidden="true"></i>Open editor
      </button>
    </div>
    {#if value && folder(value)}
      <div class="file-location"><i class="codicon codicon-folder" aria-hidden="true"></i><span>{folder(value)}</span></div>
    {/if}
    {#if open}
      <div class="picker-chooser" id={`${inputId}-chooser`} role="dialog" aria-label="Choose shader file" tabindex="-1">
        {@render chooserContents()}
      </div>
    {:else if !value}
      <div class="empty-actions">
        <PathInput {value} hidePath={true} allowSelect={false} createLabel="Create file…"
          {shaderPath} {suggestedPath} {fileType} {postMessage} {onMessage} {passName} {outputKind}
          createAuthoringMode={fileType.endsWith('-compute') ? 'native' : getDefaultAuthoringMode()} onCreated={accept} />
      </div>
    {/if}
  </div>
{:else}
  <div class="file-row">
    <PathInput {value} placeholder={suggestedPath} label="File" {inputId} {onPathChange} {hasError} allowSelect={false} allowCreate={false} />
    <button type="button" onclick={toggleChooser}>Change…</button>
  </div>
  {#if open}
    <div use:portal class="backdrop" role="presentation">
      <div class="chooser" role="dialog" tabindex="-1" aria-modal="true" aria-label="Choose shader file">
        <header><h3>Choose shader file</h3><button type="button" aria-label="Close file chooser" onclick={closeChooser}>×</button></header>
        {@render chooserContents()}
      </div>
    </div>
  {/if}
{/if}

<style>
  .file-picker { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .picker-label { font-size: 13px; font-weight: 500; color: var(--vscode-foreground); }
  .picker-row { display: flex; align-items: stretch; flex-wrap: wrap; gap: 8px; }
  .file-picker .picker-button { flex: 1; min-width: min(170px, 100%); text-align: left; background: var(--vscode-input-background); }
  .picker-button > span { flex: 1; overflow-wrap: anywhere; }
  .file-picker .picker-button.error { border-color: var(--vscode-inputValidation-errorBorder, #f48771); }
  .file-location { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
  .file-picker .open-editor-btn { white-space: nowrap; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
  .file-picker .open-editor-btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .file-picker .open-editor-btn:disabled { background: var(--vscode-button-secondaryBackground); color: var(--vscode-descriptionForeground); border-color: var(--vscode-input-border, var(--vscode-panel-border)); }
  button:disabled { opacity: 0.5; cursor: default; }
  .file-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
  button { display: inline-flex; align-items: center; gap: 8px; box-sizing: border-box; min-height: 33px; padding: 7px 10px; font: 400 13px/1.4 var(--vscode-font-family, "Segoe UI", sans-serif); background: transparent; color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; cursor: pointer; }
  button:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  button:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  i { flex-shrink: 0; }
  .backdrop { position: fixed; inset: 0; display: flex; justify-content: center; align-items: center; background: rgba(0,0,0,.45); z-index: 1000; padding: 16px; }
  .chooser, .picker-chooser { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 5px; }
  .chooser { width: 420px; max-width: 100%; }
  .picker-chooser { padding: 8px; gap: 6px; max-height: 360px; overflow-y: auto; }
  .picker-chooser > p { padding: 4px 8px; }
  .picker-chooser .files { gap: 2px; }
  .picker-chooser .files button { border: 0; }
  .picker-actions { border-top: 1px solid var(--vscode-panel-border); padding-top: 4px; }
  .picker-actions :global(.input-actions) { flex-direction: column; align-items: stretch; gap: 2px; margin: 0; }
  .file-picker .picker-actions :global(button) { text-align: left; border: 0; padding: 8px; }
  .empty-actions :global(.input-actions) { margin: 0; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h3 { font-size: 13px; margin: 0; }
  p { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .files { display: flex; flex-direction: column; gap: 5px; }
  .files button { text-align: left; overflow-wrap: anywhere; }
  .file-details { display: flex; flex: 1; flex-direction: column; min-width: 0; }
  .file-details small { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .chooser-path { border-top: 1px solid var(--vscode-panel-border); padding: 8px; }
  summary { cursor: pointer; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .chooser-path[open] summary { margin-bottom: 10px; }
  .chooser-path :global(.input-row) { flex-direction: column; align-items: stretch; gap: 6px; }
  .chooser-path :global(.config-input) { box-sizing: border-box; width: 100%; min-width: 0; }
  .chooser-path :global(.input-note) { font-size: 12px; font-style: normal; }
</style>
