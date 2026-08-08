<script lang="ts">
  import type { ShaderFile } from '../types/ShaderFile';
  import ShaderPreview from './ShaderPreview.svelte';

  let { shader, vscodeApi, cardSize = 280, refreshAll = false, forceFresh = false, layoutMode = 'grid', onOpen, onCompilationFailed }: {
    shader: ShaderFile;
    vscodeApi: any;
    cardSize?: number;
    refreshAll?: boolean;
    forceFresh?: boolean;
    layoutMode?: 'grid' | 'row';
    onOpen?: () => void;
    onCompilationFailed?: () => void;
  } = $props();

  const displayName = shader.name.replace(/\.(glsl|frag|vert|geom|tesc|tese|comp|slang)$/, '');

  let width = $derived(layoutMode === 'row' ? 96 : Math.round(cardSize * 2.286));
  let height = $derived(layoutMode === 'row' ? 54 : Math.round(width * 9 / 16));

  let menuX = $state(0);
  let menuY = $state(0);
  let menuOpen = $state(false);

  function showContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menuX = e.clientX;
    menuY = e.clientY;
    menuOpen = true;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function deleteShader() {
    vscodeApi?.postMessage({ type: 'deleteShader', path: shader.path });
    menuOpen = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeMenu();
  }

  function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const createdStr = $derived(shader.createdTime ? formatDate(shader.createdTime) : null);
  const modifiedStr = $derived(shader.modifiedTime ? formatDate(shader.modifiedTime) : null);
  const hasTimestamps = $derived(!!(createdStr || modifiedStr));
</script>

<svelte:window onclick={closeMenu} onkeydown={handleKeydown} />

<div
  class="shader-card"
  class:row={layoutMode === 'row'}
  role="button"
  tabindex="0"
  onclick={() => onOpen?.()}
  oncontextmenu={showContextMenu}
  onkeydown={(e) => e.key === 'Enter' && onOpen?.()}
>
  <div class="shader-thumbnail">
    <ShaderPreview
      {shader}
      {vscodeApi}
      {width}
      {height}
      {refreshAll}
      {forceFresh}
      compact={layoutMode === 'grid'}
      onCompilationFailed={onCompilationFailed}
    />
  </div>

  <div class="shader-info">
    <div class="shader-name" title={displayName}>{displayName}</div>
    <div class="shader-path" title={shader.relativePath}>{shader.relativePath}</div>

    {#if hasTimestamps}
      <div class="timestamp-popup">
        {#if createdStr}<div class="timestamp-row"><span class="ts-label">Created</span><span class="ts-value">{createdStr}</span></div>{/if}
        {#if modifiedStr}<div class="timestamp-row"><span class="ts-label">Edited</span><span class="ts-value">{modifiedStr}</span></div>{/if}
      </div>
    {/if}
  </div>
</div>

{#if menuOpen}
  <div class="context-menu" style="left: {menuX}px; top: {menuY}px;">
    <button class="context-menu-item" onclick={deleteShader}>
      🗑 Delete
    </button>
  </div>
{/if}

<style>
  .shader-card {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .shader-card.row {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    border-radius: 4px;
    height: 54px;
  }

  .shader-card.row .shader-thumbnail {
    width: 96px;
    height: 54px;
    flex-shrink: 0;
    aspect-ratio: unset;
  }

  .shader-card.row .shader-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 2px 6px;
    gap: 1px;
  }

  .shader-card.row .shader-name {
    font-size: 11px;
  }

  .shader-card.row .shader-path {
    font-size: 10px;
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

  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--vscode-menu-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
    border-radius: 4px;
    padding: 4px;
    min-width: 120px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    border-radius: 3px;
    white-space: nowrap;
  }

  .context-menu-item:hover {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
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
