<script lang="ts">
  import type { BufferPass, ImagePass, ShaderLanguageId, FileDialogFileType, MessageEvent as ViewerMessage } from '@shader-studio/types';
  import { applyVertexSource, clearVertexSource, existingShaderModes } from '../../config/PassSourceAuthoring';
  import PathInput from './PathInput.svelte';

  interface Props {
    pass: BufferPass | ImagePass;
    passSource: string;
    vertexSource: string;
    language: ShaderLanguageId;
    sourcePath: string;
    passName: string;
    vertexSpace: string;
    geometryType: string;
    fileType: FileDialogFileType;
    suggestedPath: string;
    shaderPath: string;
    onPathChange: (path: string) => void;
    onCommit: (pass: BufferPass | ImagePass) => void;
    postMessage?: (message: ViewerMessage) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
  }
  let { pass, passSource, vertexSource, language, sourcePath, passName, vertexSpace,
    geometryType, fileType, suggestedPath, shaderPath, onPathChange, onCommit, postMessage, onMessage }: Props = $props();
</script>

<PathInput value={pass.vertex ?? ''} {onPathChange} allowInsert={true}
  existingModes={existingShaderModes(passSource + '\n' + vertexSource, language, 'vertex')}
  clearEnabled={!!pass.vertex || !!pass.entryPoints?.vertex}
  onClear={() => onCommit(clearVertexSource(pass))}
  onCreated={(result) => onCommit(applyVertexSource(pass, result))}
  {sourcePath} {passName} {vertexSpace} {geometryType} {fileType} {suggestedPath} {shaderPath} {postMessage} {onMessage} />
