<script lang="ts">
  import type { ShaderConfig, ShaderLanguageId } from '@shader-studio/types';
  import { configSourcePaths } from '../../config/configSourcePaths';
  import PathInput from './PathInput.svelte';
  import { existingShaderModes, type CreatedSource } from '../../config/PassSourceAuthoring';
  import type { FileDialogFileType } from '@shader-studio/types';
  interface Props {
    value: string; onPathChange: (path: string) => void; hasError: boolean;
    suggestedPath: string; bufferName: string; language: ShaderLanguageId; fileType: FileDialogFileType;
    shaderPath: string; projectConfig?: ShaderConfig | null;
    postMessage?: (message: unknown) => void; onMessage?: (handler: (event: MessageEvent) => void) => void;
    sourcePath: string; builtInSourcePath: string; passType: 'render' | 'compute'; hasNativeTemplate: boolean;
    outputCount: number; passSource: string; onCreated: (result: CreatedSource) => void;
  }
  let { value, onPathChange, hasError, suggestedPath, bufferName, language, fileType, shaderPath, projectConfig,
    postMessage, onMessage, sourcePath, builtInSourcePath, passType, hasNativeTemplate, outputCount, passSource, onCreated }: Props = $props();
  const files = $derived(configSourcePaths(projectConfig, shaderPath, language));
  let choice = $state<'new' | 'custom' | null>(null);
  const sourceMode = $derived(choice ?? (value || 'new'));
  const simpleControls = $derived(bufferName === 'common' || passType === 'compute');
  const showPath = $derived(simpleControls || sourceMode === 'new' || sourceMode === 'custom');
  function selectSource(path: string) {
    if (path === 'new' || path === 'custom') {
      choice = path;
      if (path === 'new') {
        onPathChange('');
      }
    } else {
      choice = null;
      onPathChange(path);
    }
  }
  function acceptSource(result: CreatedSource) {
    choice = null;
    onCreated(result);
  }
</script>
{#if !simpleControls}
  <label class="reuse-file">Shader file
    <select aria-label="Shader file" value={sourceMode} onchange={(event) => selectSource(event.currentTarget.value)}>
      <option value="new">New file</option>
      <option value="custom">Browse / custom path</option>
      {#if value && !files.includes(value)}<option value={value}>{value}</option>{/if}
      {#each files as path}<option value={path}>{path}</option>{/each}
    </select>
  </label>
{/if}
<PathInput inputId={`buffer-source-${bufferName}`} {value} {onPathChange} {hasError}
  hidePath={!showPath} allowSelect={simpleControls || sourceMode === 'custom'} selectLabel="Browse"
  allowCreate={simpleControls || sourceMode === 'new'} fileExists={sourceMode !== 'new'}
  note={showPath ? 'Relative, absolute, or @ for workspace root' : undefined}
  placeholder={suggestedPath || `e.g., ./${bufferName === 'common' ? 'common' : 'buffer'}.${language}`}
  {fileType} {shaderPath} suggestedPath={sourceMode === 'new' && value ? value : suggestedPath} {postMessage} {onMessage}
  {sourcePath} {builtInSourcePath} authoringMode={hasNativeTemplate ? 'native' : undefined}
  createAuthoringMode={passType === 'compute' || hasNativeTemplate ? 'native' : undefined}
  passName={bufferName} outputCount={passType === 'render' && hasNativeTemplate ? outputCount : undefined}
  allowInsert={bufferName !== 'common' && passType === 'compute'}
  existingModes={existingShaderModes(passSource, language, 'compute')} onCreated={acceptSource} />
<style>
  .reuse-file { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; color: var(--vscode-foreground, #ccc); font-size: 13px; }
  select { background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c)); padding: 6px; border-radius: 4px; }
</style>
