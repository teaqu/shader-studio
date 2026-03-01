<script lang="ts">
  import type { Snippet } from '../types/Snippet';
  import MonacoEditor from './MonacoEditor.svelte';

  let { isOpen = false, editingSnippet, onSave, onCancel }: {
    isOpen?: boolean;
    editingSnippet?: Snippet | null;
    onSave?: (data: { name: string; prefix: string; description: string; body: string[]; example?: string[]; oldName?: string }) => void;
    onCancel?: () => void;
  } = $props();

  let name: string = $state('');
  let prefix: string = $state('');
  let description: string = $state('');
  let bodyText: string = $state('');
  let previewLastLine: boolean = $state(false);

  const editorHeight = $derived(Math.max(bodyText.split('\n').length, 3) * 20);

  $effect(() => {
    if (isOpen && editingSnippet) {
      name = editingSnippet.name;
      prefix = editingSnippet.prefix;
      description = editingSnippet.description;
      // If snippet has example (preview code differs from body), show the full code
      if (editingSnippet.example && editingSnippet.example.length > 0) {
        bodyText = editingSnippet.example.join('\n');
        previewLastLine = true;
      } else {
        bodyText = editingSnippet.body.join('\n');
        previewLastLine = false;
      }
    } else if (isOpen) {
      name = '';
      prefix = '';
      description = '';
      bodyText = '';
      previewLastLine = false;
    }
  });

  function handleSave() {
    if (!name.trim() || !prefix.trim() || !bodyText.trim()) return;

    const allLines = bodyText.split('\n');

    let body: string[];
    let example: string[] | undefined;

    if (previewLastLine) {
      // Strip last non-empty line from body, keep full code as example
      let lastNonEmptyIdx = -1;
      for (let i = allLines.length - 1; i >= 0; i--) {
        if (allLines[i].trim()) { lastNonEmptyIdx = i; break; }
      }
      if (lastNonEmptyIdx > 0) {
        body = allLines.slice(0, lastNonEmptyIdx);
        example = allLines;
      } else {
        body = allLines;
      }
    } else {
      body = allLines;
    }

    onSave?.({
      name: name.trim(),
      prefix: prefix.trim(),
      description: description.trim(),
      body,
      example,
      oldName: editingSnippet ? editingSnippet.name : undefined,
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel?.();
    }
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="modal-overlay" role="dialog" aria-modal="true" onkeydown={handleKeydown}>
    <div class="modal-content">
      <h2>{editingSnippet ? 'Edit Snippet' : 'Add Custom Snippet'}</h2>

      <div class="form-group">
        <label for="snippet-name">Name</label>
        <input id="snippet-name" type="text" bind:value={name} placeholder="My SDF Function" />
      </div>

      <div class="form-group">
        <label for="snippet-prefix">Prefix (trigger)</label>
        <input id="snippet-prefix" type="text" bind:value={prefix} placeholder="my-sdf" />
      </div>

      <div class="form-group">
        <label for="snippet-description">Description</label>
        <textarea id="snippet-description" bind:value={description} placeholder="Description of what this snippet does" rows="2" class="auto-expand" oninput={(e) => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}></textarea>
      </div>

      <div class="form-group">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Code</label>
        <MonacoEditor value={bodyText} onChange={(v) => bodyText = v} height={editorHeight} />
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={previewLastLine} />
          Last line is preview only
        </label>
        <span class="preview-hint">Preview shows the last line of your code as a visual output</span>
      </div>

      <div class="file-path-info">
        Saved to: <code>.vscode/glsl-snippets.code-snippets</code>
      </div>

      <div class="modal-actions">
        <button class="btn-cancel" onclick={onCancel}>Cancel</button>
        <button class="btn-save" onclick={handleSave} disabled={!name.trim() || !prefix.trim() || !bodyText.trim()}>
          {editingSnippet ? 'Update' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-content {
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #444);
    border-radius: 8px;
    padding: 24px;
    width: 90%;
    max-width: 700px;
    max-height: 90vh;
    overflow-y: auto;
  }

  h2 {
    margin: 0 0 16px;
    font-size: 16px;
    color: var(--vscode-foreground, #ccc);
  }

  .form-group {
    margin-bottom: 12px;
  }

  .form-group label {
    display: block;
    font-size: 12px;
    color: var(--vscode-foreground, #ccc);
    margin-bottom: 4px;
  }

  .form-group input,
  .form-group textarea {
    width: 100%;
    padding: 6px 8px;
    font-size: 13px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    outline: none;
  }

  .form-group input:focus,
  .form-group textarea:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .form-group textarea {
    resize: vertical;
    font-family: inherit;
  }

  .form-group textarea.auto-expand {
    overflow: hidden;
    min-height: 52px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .btn-cancel {
    padding: 6px 16px;
    font-size: 13px;
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: var(--vscode-button-secondaryHoverBackground, #45494e);
  }

  .btn-save {
    padding: 6px 16px;
    font-size: 13px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-save:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .file-path-info {
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    margin-top: 8px;
    padding: 4px 8px;
    background: var(--vscode-textBlockQuote-background, #222);
    border-radius: 3px;
  }

  .file-path-info code {
    font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
    color: var(--vscode-textLink-foreground, #3794ff);
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--vscode-foreground, #ccc);
    margin-top: 6px;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    margin: 0;
    cursor: pointer;
  }

  .preview-hint {
    display: block;
    font-size: 11px;
    color: var(--vscode-descriptionForeground, #888);
    margin-top: 4px;
  }
</style>
