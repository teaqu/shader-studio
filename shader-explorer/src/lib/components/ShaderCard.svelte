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

  const displayName = shader.name.replace(/\.glsl$/, '');

  let width = $derived(Math.round(cardSize * 2.286));
  let height = $derived(Math.round(width * 9 / 16));

  function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const createdStr = $derived(shader.createdTime ? formatDate(shader.createdTime) : null);
  const modifiedStr = $derived(shader.modifiedTime ? formatDate(shader.modifiedTime) : null);
  const hasTimestamps = $derived(!!(createdStr || modifiedStr));
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

    {#if hasTimestamps}
      <div class="timestamp-popup">
        {#if createdStr}<div class="timestamp-row"><span class="ts-label">Created at</span><span class="ts-value">{createdStr}</span></div>{/if}
        {#if modifiedStr}<div class="timestamp-row"><span class="ts-label">Edited at</span><span class="ts-value">{modifiedStr}</span></div>{/if}
      </div>
    {/if}
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
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
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
    position: relative;
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

  .timestamp-popup {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 8px;
    background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
    border-radius: 4px;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
    white-space: nowrap;
    z-index: 10;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.12s ease, transform 0.12s ease;
  }

  .shader-info:hover .timestamp-popup {
    opacity: 1;
    transform: translateY(0);
  }

  .timestamp-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .ts-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    min-width: 48px;
  }

  .ts-value {
    font-size: 11px;
    color: var(--vscode-foreground);
  }
</style>
