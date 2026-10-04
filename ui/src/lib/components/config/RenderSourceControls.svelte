<script lang="ts">
  import type { BufferPass, ImagePass, ShaderEntryPoint, ShaderLanguageId, FileDialogFileType, MessageEvent as ViewerMessage } from '@shader-studio/types';
  import { applyFragmentSource, applyVertexSource } from '../../config/PassSourceAuthoring';
  import RenderEntryPointControls from './RenderEntryPointControls.svelte';
  import PathInput from './PathInput.svelte';

  interface Props {
    pass: BufferPass | ImagePass;
    entryPoints: ShaderEntryPoint[];
    language: ShaderLanguageId;
    fileType: FileDialogFileType;
    sourcePath: string;
    shaderPath: string;
    passName: string;
    authoringMode?: 'hooks' | 'native';
    isImagePass: boolean;
    outputCount: number;
    onCommit: (pass: BufferPass | ImagePass) => void;
    postMessage?: (message: ViewerMessage) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
  }
  let { pass, entryPoints, language, fileType, sourcePath, shaderPath, passName,
    authoringMode, isImagePass, outputCount, onCommit, postMessage, onMessage }: Props = $props();
</script>

<div class="config-item">
  <RenderEntryPointControls {pass} {entryPoints} {language} {onCommit}>
    {#snippet authoringControls(stage)}
      <PathInput value="" hidePath={true} allowCreate={false} allowInsert={true} insertLabel="Add"
        {sourcePath} fileType={stage === 'vertex' ? `${language}-vertex` : fileType}
        geometryType={pass.geometry?.type ?? 'fullscreen'}
        vertexSpace={pass.geometry?.type === 'vertices' ? pass.geometry.space ?? 'world' : 'world'}
        {passName} {authoringMode} {outputCount} {shaderPath} {postMessage} {onMessage}
        onCreated={(result) => onCommit(stage === 'vertex' ? applyVertexSource(pass, result)
          : applyFragmentSource(pass, { ...result, path: isImagePass ? '' : result.path }))} />
    {/snippet}
  </RenderEntryPointControls>
</div>

<style>
  .config-item { display: flex; flex-direction: column; gap: 12px; }
</style>
