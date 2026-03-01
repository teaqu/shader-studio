<script lang="ts">
  import type { Snippet } from '../types/Snippet';
  import { CATEGORY_LABELS } from '../types/Snippet';
  import SnippetPreview from './SnippetPreview.svelte';
  import MonacoEditor from './MonacoEditor.svelte';
  import { stripSnippetPlaceholders } from '../preview/previewTemplates';

  let { snippet, onClose, onInsert, onCreateScene }: {
    snippet: Snippet | null;
    onClose: () => void;
    onInsert: (snippet: Snippet) => void;
    onCreateScene?: (snippet: Snippet) => void;
  } = $props();

  let codeCopied = $state(false);

  const cleanCode = $derived(
    snippet ? stripSnippetPlaceholders(snippet.body.join('\n')) : ''
  );

  const codeLineCount = $derived(
    cleanCode.split('\n').length
  );

  interface ParamInfo {
    type: string;
    name: string;
    description: string;
  }

  const GLSL_PARAM_DESCRIPTIONS: Record<string, Record<string, string>> = {
    'vec2 p': 'Sample point in 2D space',
    'vec3 p': 'Sample point in 3D space',
    'float r': 'Radius',
    'float s': 'Size (uniform scale)',
    'float n': 'Number of repetitions or segments',
    'float h': 'Height',
    'float d': 'Distance value',
    'float d1': 'First distance value',
    'float d2': 'Second distance value',
    'float k': 'Smoothing factor (higher = smoother blend)',
    'float a': 'Angle in radians',
    'vec2 b': 'Half-extents (width, height)',
    'vec3 b': 'Half-extents (width, height, depth)',
    'vec4 r': 'Per-corner radii',
    'vec2 a': 'Start point',
    'vec2 c': 'Center point',
    'vec3 a': 'Start point or axis direction',
    'float t': 'Interpolation parameter (0-1)',
    'float turns': 'Number of spiral turns',
    'float freq': 'Frequency',
    'float amp': 'Amplitude',
    'float octaves': 'Number of noise octaves',
    'float scale': 'Scale factor',
    'vec2 uv': 'UV texture coordinates',
    'vec3 col': 'Color value (RGB)',
    'float angle': 'Rotation angle in radians',
    'mat2 m': 'Rotation matrix (2x2)',
    'mat3 m': 'Transformation matrix (3x3)',
    'float R': 'Major radius (distance from center to tube center)',
    'float thickness': 'Thickness or minor radius',
  };

  function parseParams(body: string[]): ParamInfo[] {
    const code = stripSnippetPlaceholders(body.join('\n'));
    // Match GLSL function signatures: returnType funcName(params)
    const funcMatch = code.match(/^\s*(?:float|vec[234]|mat[234]|void|int|bool)\s+\w+\s*\(([^)]*)\)/m);
    if (!funcMatch) return [];

    const paramStr = funcMatch[1].trim();
    if (!paramStr) return [];

    return paramStr.split(',').map(p => {
      const trimmed = p.trim();
      // Handle inout/in/out qualifiers
      const cleaned = trimmed.replace(/^(inout|in|out)\s+/, '');
      const parts = cleaned.split(/\s+/);
      if (parts.length < 2) return null;
      const type = parts[0];
      const name = parts[1];
      const key = `${type} ${name}`;
      const typeKey = `${type} ${name.charAt(0)}`; // fallback: match by first char
      const description = GLSL_PARAM_DESCRIPTIONS[key]
        || GLSL_PARAM_DESCRIPTIONS[typeKey]
        || descriptionFromType(type, name);
      const qualifier = trimmed.startsWith('inout') ? 'inout ' : trimmed.startsWith('out ') ? 'out ' : '';
      return { type: qualifier + type, name, description };
    }).filter((p): p is ParamInfo => p !== null);
  }

  function descriptionFromType(type: string, name: string): string {
    if (type === 'float') return 'Scalar value';
    if (type === 'vec2') return '2D vector';
    if (type === 'vec3') return '3D vector';
    if (type === 'vec4') return '4D vector';
    if (type === 'mat2') return '2x2 matrix';
    if (type === 'mat3') return '3x3 matrix';
    if (type === 'mat4') return '4x4 matrix';
    if (type === 'int') return 'Integer value';
    if (type === 'bool') return 'Boolean flag';
    return `${type} value`;
  }

  const params = $derived(snippet ? parseParams(snippet.body) : []);

  async function copyCode() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(cleanCode);
      codeCopied = true;
      setTimeout(() => codeCopied = false, 2000);
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('detail-overlay')) {
      onClose();
    }
  }
</script>

{#if snippet}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="detail-overlay"
    role="dialog"
    aria-modal="true"
    onkeydown={handleKeydown}
    onclick={handleOverlayClick}
  >
    <div class="detail-content">
      <div class="detail-header">
        <div class="header-info">
          <h2>{snippet.name}</h2>
          <div class="header-meta">
            <code class="detail-prefix">{snippet.prefix}</code>
            <span class="detail-category">{CATEGORY_LABELS[snippet.category]}</span>
          </div>
        </div>
        <button class="close-btn" onclick={onClose} title="Close">&times;</button>
      </div>

      <div class="detail-body">
        <div class="preview-area">
          <SnippetPreview
            {snippet}
            width={400}
            height={225}
            interactive={true}
          />
        </div>

        {#if snippet.description}
          <p class="detail-description">{snippet.description}</p>
        {/if}

        {#if params.length > 0}
          <div class="params-section">
            <span class="section-label">Parameters</span>
            <div class="params-table">
              {#each params as param}
                <div class="param-row">
                  <code class="param-type">{param.type}</code>
                  <code class="param-name">{param.name}</code>
                  <span class="param-desc">{param.description}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="code-section">
          <div class="section-header">
            <span class="section-label">Code</span>
            <button class="copy-btn" onclick={copyCode}>
              {codeCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <MonacoEditor value={cleanCode} readOnly={true} language="glsl" height={codeLineCount * 20} />
        </div>
      </div>

      <div class="detail-actions">
        {#if onCreateScene}
          <button class="btn-create-scene" onclick={() => onCreateScene(snippet)}>Create Scene</button>
        {/if}
        <button class="btn-insert" onclick={() => onInsert(snippet)}>Insert into Editor</button>
        <button class="btn-close" onclick={onClose}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .detail-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .detail-content {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--vscode-panel-border, #333);
  }

  .header-info {
    flex: 1;
    min-width: 0;
  }

  .header-info h2 {
    margin: 0 0 6px;
    font-size: 16px;
    color: var(--vscode-foreground, #ccc);
  }

  .header-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .detail-prefix {
    font-size: 12px;
    color: var(--vscode-textLink-foreground, #3794ff);
    background: var(--vscode-badge-background, #333);
    padding: 1px 6px;
    border-radius: 3px;
  }

  .detail-category {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground, #ccc);
    font-size: 22px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    opacity: 0.7;
  }

  .close-btn:hover {
    opacity: 1;
  }

  .detail-body {
    padding: 16px 20px;
    flex: 1;
    overflow-y: auto;
  }

  .preview-area {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 12px;
    background: #000;
  }

  .preview-area :global(.snippet-preview-container) {
    height: 100% !important;
  }

  .preview-area :global(canvas) {
    width: 100% !important;
    height: 100% !important;
  }

  .detail-description {
    font-size: 13px;
    color: var(--vscode-foreground, #ccc);
    line-height: 1.5;
    margin: 0 0 12px;
  }

  .params-section {
    margin-bottom: 12px;
  }

  .params-table {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .param-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    background: var(--vscode-textCodeBlock-background, #0d0d0d);
    border-radius: 3px;
    font-size: 12px;
  }

  .param-type {
    color: var(--vscode-symbolIcon-typeParameterForeground, #4ec9b0);
    font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
    flex-shrink: 0;
  }

  .param-name {
    color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
    font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
    font-weight: 600;
    flex-shrink: 0;
  }

  .param-desc {
    color: var(--vscode-descriptionForeground, #888);
    font-size: 11px;
  }

  .code-section {
    margin-bottom: 12px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground, #ccc);
  }

  .copy-btn {
    padding: 2px 8px;
    font-size: 11px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }

  .copy-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  .detail-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--vscode-panel-border, #333);
  }

  .btn-create-scene {
    padding: 6px 16px;
    font-size: 13px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-right: auto;
  }

  .btn-create-scene:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  .btn-insert {
    padding: 6px 16px;
    font-size: 13px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-insert:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .btn-close {
    padding: 6px 16px;
    font-size: 13px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-close:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }
</style>
