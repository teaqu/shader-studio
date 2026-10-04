<script lang="ts">
  import type { BufferPass, ImagePass, ShaderEntryPoint, ShaderLanguageId, FileDialogFileType, MessageEvent as ViewerMessage } from '@shader-studio/types';
  import { applyFragmentSource, applyVertexSource, existingShaderModes } from '../../config/PassSourceAuthoring';
  import { getShaderEntryPoints } from '@shader-studio/types';
  import RenderEntryPointControls from './RenderEntryPointControls.svelte';
  import PathInput from './PathInput.svelte';

  interface Props {
    pass: BufferPass | ImagePass;
    entryPoints: ShaderEntryPoint[];
    vertexSource?: string;
    passSource?: string;
    language: ShaderLanguageId;
    fileType: FileDialogFileType;
    sourcePath: string;
    shaderPath: string;
    passName: string;
    authoringMode?: 'hooks' | 'native';
    isImagePass: boolean;
    outputCount: number;
    stage?: 'vertex' | 'fragment';
    onCommit: (pass: BufferPass | ImagePass) => void;
    postMessage?: (message: ViewerMessage) => void;
    onMessage?: (handler: (event: MessageEvent) => void) => void;
  }
  let { pass, entryPoints, vertexSource = '', passSource = '', language, fileType, sourcePath, shaderPath, passName,
    authoringMode, isImagePass, outputCount, stage, onCommit, postMessage, onMessage }: Props = $props();
  const stageEntries = $derived(pass.vertex && pass.vertex !== sourcePath
    ? [...entryPoints.filter(entry => entry.stage !== 'vertex'), ...getShaderEntryPoints(vertexSource, language).filter(entry => entry.stage === 'vertex')]
    : entryPoints);
</script>

{#snippet addFunction(selectedStage: 'vertex' | 'fragment')}
  <PathInput value="" hidePath={true} allowCreate={false} allowSelect={false} allowInsert={true} insertLabel="Add function…"
    sourcePath={selectedStage === 'vertex' ? pass.vertex || sourcePath : sourcePath} fileType={selectedStage === 'vertex' ? `${language}-vertex` : fileType}
    geometryType={pass.geometry?.type ?? 'fullscreen'}
    existingModes={existingShaderModes(selectedStage === 'vertex' && pass.vertex && pass.vertex !== sourcePath ? vertexSource : passSource, language, selectedStage).includes('hooks') ? ['hooks'] : []}
    vertexSpace={pass.geometry?.type === 'vertices' ? pass.geometry.space ?? 'world' : 'world'}
    {passName} {authoringMode} {outputCount} {shaderPath} {postMessage} {onMessage}
    onCreated={(result) => onCommit(selectedStage === 'vertex' ? applyVertexSource(pass, result)
      : applyFragmentSource(pass, { ...result, path: isImagePass ? '' : result.path }))} />
{/snippet}

{#if language !== 'glsl' || !existingShaderModes(pass.vertex && pass.vertex !== sourcePath ? vertexSource : passSource, language, 'vertex').includes('hooks')}
<div class="config-item">
  {#if language === 'glsl'}
    {@render addFunction('vertex')}
  {:else}
    <RenderEntryPointControls {pass} entryPoints={stageEntries} {language} {onCommit} {stage}
      showFragmentHook={existingShaderModes(passSource, language, 'fragment').includes('hooks')}
      authoringControls={addFunction} />
  {/if}
</div>
{/if}

<style>
  .config-item { display: flex; flex-direction: column; gap: 12px; }
</style>
