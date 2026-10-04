<script lang="ts">
  import type { MessageEvent as ShaderMessage } from "@shader-studio/types";
  import type { ShaderConfig, ShaderLanguageId } from '@shader-studio/types';
  import PathInput from './PathInput.svelte';
  import ShaderFileControls from './ShaderFileControls.svelte';
  import type { CreatedSource } from '../../config/PassSourceAuthoring';
  import type { FileDialogFileType } from '@shader-studio/types';
  interface Props {
    value: string; onPathChange: (path: string) => void; hasError: boolean;
    suggestedPath: string; bufferName: string; language: ShaderLanguageId; fileType: FileDialogFileType;
    shaderPath: string; projectConfig?: ShaderConfig | null;
    postMessage?: (message: ShaderMessage) => void; onMessage?: (handler: (event: MessageEvent) => void) => void;
    sourcePath: string; builtInSourcePath: string; passType: 'render' | 'compute'; hasNativeTemplate: boolean;
    outputCount: number; passSource: string; onCreated: (result: CreatedSource) => void;
  }
  let { value, onPathChange, hasError, suggestedPath, bufferName, language, fileType, shaderPath, projectConfig,
    postMessage, onMessage, onCreated }: Props = $props();
  const simpleControls = $derived(bufferName === 'common');
</script>
{#if !simpleControls}
  <ShaderFileControls {value} {onPathChange} {hasError} {suggestedPath} {language} {fileType} {shaderPath} {projectConfig}
    inputId={`buffer-source-${bufferName}`} passName={bufferName} {postMessage} {onMessage} {onCreated} />
{:else}
<PathInput inputId={`buffer-source-${bufferName}`} {value} {onPathChange} {hasError}
  selectLabel="Browse" fileExists={!!value}
  note="Relative, absolute, or @ for workspace root"
  placeholder={suggestedPath || `e.g., ./common.${language}`}
  {fileType} {shaderPath} {suggestedPath} {postMessage} {onMessage}
  passName={bufferName} {onCreated} />
{/if}
