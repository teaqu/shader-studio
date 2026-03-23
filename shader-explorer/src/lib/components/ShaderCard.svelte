<script lang="ts">
  import type { ShaderFile } from '../types/ShaderFile';
  import ShaderPreview from './ShaderPreview.svelte';

  let { shader, vscodeApi, cardSize = 280, forceFresh = false, onOpen, onCompilationFailed }: {
    shader: ShaderFile;
    vscodeApi: any;
    cardSize?: number;
    forceFresh?: boolean;
    onOpen?: () => void;
    onCompilationFailed?: () => void;
  } = $props();
  
  // Remove .glsl extension from display name
  const displayName = shader.name.replace(/\.glsl$/, '');
  
  // Calculate preview dimensions based on card size (16:9 aspect ratio)
  // Scale resolution proportionally to card size
  let width = $derived(Math.round(cardSize * 2.286)); // 640/280 ratio for medium
  let height = $derived(Math.round(width * 9 / 16)); // 16:9 aspect ratio
</script>

<div 
  class="shader-card" 
  role="button" 
  tabindex="0"
  onclick={() => onOpen?.()}
  onkeydown={(e) => e.key === 'Enter' && onOpen?.()}
>
  <div class="shader-thumbnail">
    <ShaderPreview 
      {shader} 
      {vscodeApi} 
      {width} 
      {height}
      {forceFresh}
      onCompilationFailed={onCompilationFailed}
    />
  </div>
  
  <div class="shader-info">
    <div class="shader-name" title={displayName}>{displayName}</div>
    <div class="shader-path" title={shader.relativePath}>{shader.relativePath}</div>
  </div>
</div>

<style>
  .shader-card {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .shader-card:hover {
    border-color: var(--vscode-focusBorder);
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }

  .shader-thumbnail {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: var(--vscode-editor-background);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .shader-info {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shader-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--vscode-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shader-path {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
