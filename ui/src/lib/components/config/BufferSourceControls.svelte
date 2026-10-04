<script lang="ts">
  import type { ShaderConfig, ShaderLanguageId } from '@shader-studio/types';
  import PathInput from './PathInput.svelte';
  import ShaderFileControls from './ShaderFileControls.svelte';
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
  const simpleControls = $derived(bufferName === 'common' || passType === 'compute');
  function acceptSource(result: CreatedSource) {
 onCreated(result);
}
</script>
{#if !simpleControls}
  <ShaderFileControls {value} {onPathChange} {hasError} {suggestedPath} {language} {fileType} {shaderPath} {projectConfig}
    inputId={`buffer-source-${bufferName}`} passName={bufferName} {postMessage} {onMessage} onCreated={acceptSource} />
{:else}
<PathInput inputId={`buffer-source-${bufferName}`} {value} {onPathChange} {hasError}
  selectLabel="Browse" fileExists={!!value}
  note="Relative, absolute, or @ for workspace root"
  placeholder={suggestedPath || `e.g., ./${bufferName === 'common' ? 'common' : 'buffer'}.${language}`}
  {fileType} {shaderPath} {suggestedPath} {postMessage} {onMessage}
  {sourcePath} {builtInSourcePath} authoringMode={hasNativeTemplate ? 'native' : undefined}
  createAuthoringMode={passType === 'compute' || hasNativeTemplate ? 'native' : undefined}
  passName={bufferName} outputCount={passType === 'render' && hasNativeTemplate ? outputCount : undefined}
  allowInsert={bufferName !== 'common' && passType === 'compute'}
  existingModes={existingShaderModes(passSource, language, 'compute')} onCreated={acceptSource} />
{/if}
