<script lang="ts">
  import type { MessageEvent as ShaderMessage } from "@shader-studio/types";
  import type { ShaderConfig, ShaderLanguageId } from '@shader-studio/types';
  import ShaderFileControls from './ShaderFileControls.svelte';
  import type { CreatedSource } from '../../config/PassSourceAuthoring';
  import type { FileDialogFileType } from '@shader-studio/types';
  interface Props {
    value: string; onPathChange: (path: string) => void; hasError: boolean;
    suggestedPath: string; bufferName: string; language: ShaderLanguageId; fileType: FileDialogFileType;
    shaderPath: string; projectConfig?: ShaderConfig | null;
    postMessage?: (message: ShaderMessage) => void; onMessage?: (handler: (event: MessageEvent) => void) => void;
    sourcePath: string; builtInSourcePath: string; passType: 'render' | 'compute'; hasNativeTemplate: boolean;
    onCreated: (result: CreatedSource) => void;
    onOpen?: () => void;
  }
  let { value, onPathChange, hasError, suggestedPath, bufferName, language, fileType, shaderPath, projectConfig,
    postMessage, onMessage, onCreated, onOpen }: Props = $props();
</script>
  <ShaderFileControls {value} {onPathChange} {hasError} {suggestedPath} {language} {fileType} {shaderPath} {projectConfig}
    inputId={`buffer-source-${bufferName}`} passName={bufferName} {postMessage} {onMessage} {onCreated}
    summary={true} {onOpen} />
