<script lang="ts">
  import type { ShaderConfig } from '../types/ShaderConfig';

  /**
   * The shader configuration to preview
   */
  export let config: ShaderConfig;

  /**
   * Whether to show the preview in expanded format
   */
  let expanded: boolean = false;

  /**
   * Format the JSON with proper indentation
   */
  function formatJson(obj: any): string {
    return JSON.stringify(obj, null, expanded ? 4 : 2);
  }

  /**
   * Copy the configuration to clipboard
   */
  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(formatJson(config));
      // Could add a toast notification here in the future
      console.log('Configuration copied to clipboard');
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }

  /**
   * Toggle expanded/compact view
   */
  function toggleExpanded() {
    expanded = !expanded;
  }
</script>

<div class="container-card">
  <div 
    class="container-header clickable"
    role="button"
    tabindex="0"
    on:click={toggleExpanded}
    on:keydown={(e) => e.key === 'Enter' || e.key === ' ' ? toggleExpanded() : null}
    title={expanded ? 'Click to compact' : 'Click to expand'}
  >
    <h3>Configuration Preview {expanded ? '▼' : '▶'}</h3>
    <div class="preview-controls">
      <button 
        class="control-btn"
        on:click|stopPropagation={copyToClipboard}
        title="Copy to clipboard"
      >
        📋
      </button>
    </div>
  </div>
  
  <div class="scrollable-content" class:collapsed={!expanded}>
    <pre class="config-json" class:expanded>{formatJson(config)}</pre>
  </div>
</div>

<style>
  .preview-controls {
    display: flex;
    gap: 8px;
  }

  .container-header.clickable {
    cursor: pointer;
    user-select: none;
  }

  .container-header.clickable:hover {
    background-color: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.1));
  }

  .container-header.clickable:focus {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
    outline-offset: -1px;
  }

  .scrollable-content.collapsed {
    display: none;
  }

  .config-json {
    margin: 0;
    padding: 16px;
    font-family: var(--vscode-editor-font-family), 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.4;
    color: var(--vscode-editor-foreground);
    background: transparent;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .config-json.expanded {
    max-height: none;
  }
</style>
