<script lang="ts">
  import type { ShaderFile } from '../types/ShaderFile';
  import { createEventDispatcher } from 'svelte';
  import ShaderPreview from './ShaderPreview.svelte';

  export let shader: ShaderFile;
  export let vscodeApi: any;
  
  const dispatch = createEventDispatcher();
</script>

<div class="shader-list-item" on:click={() => dispatch('open')}>
  <div class="shader-icon">
    <ShaderPreview {shader} {vscodeApi} width={128} height={72} />
  </div>
  
  <div class="shader-details">
    <div class="shader-name">{shader.name}</div>
    <div class="shader-path">{shader.relativePath}</div>
  </div>

  <div class="shader-actions">
    {#if shader.hasConfig}
      <button 
        class="action-btn" 
        on:click|stopPropagation={() => dispatch('openConfig')}
        title="Open config"
      >
        ⚙️ Config
      </button>
    {:else}
      <button 
        class="action-btn create" 
        on:click|stopPropagation={() => dispatch('createConfig')}
        title="Create config"
      >
        + Config
      </button>
    {/if}
  </div>
</div>

<style>
  .shader-list-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .shader-list-item:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-focusBorder);
  }

  .shader-icon {
    width: 64px;
    height: 36px;
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--vscode-editorWidget-background);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .shader-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .icon-placeholder {
    font-size: 20px;
    opacity: 0.3;
  }

  .shader-details {
    flex: 1;
    min-width: 0;
  }

  .shader-name {
    font-weight: 600;
    font-size: 13px;
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
    margin-top: 2px;
  }

  .shader-actions {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    padding: 4px 12px;
    font-size: 11px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;
  }

  .action-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .action-btn.create {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .action-btn.create:hover {
    background: var(--vscode-button-hoverBackground);
  }
</style>
