<script lang="ts">
  import type { ShaderConfig, BufferPass, ImagePass, ShaderLanguageId, FileDialogFileType, MessageEvent as ViewerMessage } from '@shader-studio/types';
  import { applyVertexSource, clearVertexSource, existingShaderModes } from '../../config/PassSourceAuthoring';
  import { configSourcePaths } from '../../config/configSourcePaths';
  import PathInput from './PathInput.svelte';

  interface Props {
    pass: BufferPass | ImagePass;
    projectConfig?: ShaderConfig | null;
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
  let { pass, projectConfig, passSource, vertexSource, language, sourcePath, passName, vertexSpace,
    geometryType, fileType, suggestedPath, shaderPath, onPathChange, onCommit, postMessage, onMessage }: Props = $props();
  let custom = $state(false);
  const files = $derived(configSourcePaths(projectConfig, shaderPath, language).filter(path => path !== sourcePath));
  const mode = $derived(pass.vertex && pass.vertex === sourcePath ? 'same' : pass.vertex && files.includes(pass.vertex) ? pass.vertex : pass.vertex || pass.entryPoints?.vertex || custom ? 'custom' : 'builtin');
  function selectSource(value: string) {
    custom = value === 'custom';
    if (value === 'builtin') {
      onCommit(clearVertexSource(pass));
    } else if (value === 'same') {
      onPathChange(sourcePath);
    } else if (value !== 'custom') {
      onPathChange(value);
    }
  }
  function clearSource() {
    custom = false;
    onCommit(clearVertexSource(pass));
  }
</script>
<label class="source-select">Vertex source
  <select aria-label="Vertex source" value={mode} onchange={(event) => selectSource(event.currentTarget.value)}>
    <option value="builtin">Built-in</option>
    <option value="same">Same file</option>
    <option value="custom">Custom file</option>
    {#each files as path}<option value={path}>{path}</option>{/each}
  </select>
</label>
{#if mode !== 'builtin'}

<PathInput inputId={`vertex-source-${passName}`} value={pass.vertex ?? ''} {onPathChange} allowInsert={true}
  existingModes={existingShaderModes(passSource + '\n' + vertexSource, language, 'vertex')}
  clearEnabled={!!pass.vertex || !!pass.entryPoints?.vertex}
  onClear={clearSource}
  onCreated={(result) => onCommit(applyVertexSource(pass, result))}
  {sourcePath} {passName} {vertexSpace} {geometryType} {fileType} {suggestedPath} {shaderPath} {postMessage} {onMessage} />
{/if}
<style>
  .source-select { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; color: var(--vscode-foreground, #ccc); }
  select { background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c)); padding: 6px; border-radius: 4px; }
</style>
