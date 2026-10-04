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
</script>
<PathInput inputId={`buffer-source-${bufferName}`} {value} {onPathChange} {hasError} note="Relative, absolute, or @ for workspace root"
  placeholder={suggestedPath || `e.g., ./${bufferName === 'common' ? 'common' : 'buffer'}.${language}`} {fileType} {shaderPath} {suggestedPath} {postMessage} {onMessage}
  {sourcePath} {builtInSourcePath} authoringMode={hasNativeTemplate ? 'native' : undefined}
  createAuthoringMode={passType === 'compute' || hasNativeTemplate ? 'native' : undefined}
  passName={bufferName} outputCount={passType === 'render' && hasNativeTemplate ? outputCount : undefined}
  allowInsert={bufferName !== 'common' && passType === 'compute'}
  existingModes={existingShaderModes(passSource, language, 'compute')} {onCreated} />
{#if bufferName !== 'common' && files.length}
  <label class="reuse-file">Use file from config
    <select aria-label="Use file from config" value={files.includes(value) ? value : ''} onchange={(event) => {
      if (event.currentTarget.value) {
        onPathChange(event.currentTarget.value);
      }
}}>
      <option value="">Choose an existing file…</option>
      {#each files as path}<option value={path}>{path}</option>{/each}
    </select>
  </label>
{/if}
<style>
  .reuse-file { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; color: var(--vscode-foreground, #ccc); font-size: 13px; }
  select { background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c)); padding: 6px; border-radius: 4px; }
</style>
