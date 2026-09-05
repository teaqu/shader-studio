<svelte:options runes={true} />

<script lang="ts">
  import { getViewerSession, ShaderEditor } from '@shader-studio/ui';

  import { getEditorDocument, setEditorDocument } from './state/editorDocuments.svelte';
  import type { WebTransport } from './WebTransport';
  import { requestEditor } from './state/shellState.svelte';
  interface Props { path?: string; transport?: WebTransport; }
  let { path, transport }: Props = $props();
  const fileCode = $derived(path ? getEditorDocument(path) ?? null : null);
  let fileError = $state('');
  $effect(() => {
    const filePath = path;
    const source = transport;
    let disposed = false;
    if (filePath && source) {
      void source.readEditorFile(filePath).then((code) => {
        if (!disposed) {
          setEditorDocument(filePath, code); fileError = code === null ? 'File is no longer available.' : '';
        }
      }).catch(() => {
        if (!disposed) {
          fileError = 'Could not load file.';
        }
      });
    }
    return () => {
      disposed = true;
    };
  });
  const session = $derived(getViewerSession());
  let vimMode = $state(false);
</script>

<div class="editor-pane">
  {#if path && transport}
    {#if fileError}<p role="alert">{fileError}</p>{/if}
    {#if fileCode !== null}
      <div class="editor-content">
        <ShaderEditor isVisible={true} shaderCode={fileCode} shaderPath={path} {transport}
          {vimMode} displayMode="pane" overflowWidgetsDomNode={document.body} />
      </div>
    {/if}
  {:else if session?.ready && session.transport}
    <div class="editor-content">
      <ShaderEditor
        isVisible={true}
        shaderCode={session.shaderCode}
        shaderPath={session.shaderPath}
        transport={session.transport}
        onCodeChange={session.onCodeChange}
        {vimMode}
        bufferNames={session.bufferNames}
        activeBufferName={session.activeBufferName}
        onBufferSwitch={session.onBufferSwitch}
        errors={session.errors}
        compileMode={session.compileMode}
        config={session.config}
        customUniformInfo={session.customUniformInfo}
        slangModules={session.slangModules}
        onCursorChange={session.onCursorChange}
        displayMode="pane"
        overflowWidgetsDomNode={document.body}
      />
    </div>
  {/if}
  <div class="editor-footer" role="toolbar" aria-label="Editor options">
    {#if !path && session?.shaderPath}
      <button class="vim-toggle" type="button" onclick={() => requestEditor(session?.shaderPath ?? null)}>
        Open in separate editor
      </button>
    {/if}
    <button
      class="vim-toggle"
      type="button"
      aria-label={vimMode ? 'Disable Vim mode' : 'Enable Vim mode'}
      aria-pressed={vimMode}
      disabled={path ? fileCode === null : !session?.ready || !session.transport}
      onclick={() => vimMode = !vimMode}
    >
      Vim{vimMode ? ' on' : ''}
    </button>
  </div>
</div>

<style>
  .editor-pane {
    display: flex;
    flex-direction: column;
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .editor-content {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .editor-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-height: 32px;
    box-sizing: border-box;
    margin-top: auto;
    flex-shrink: 0;
    padding: 4px 8px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-statusBar-background, var(--vscode-sideBar-background));
    color: var(--vscode-statusBar-foreground, var(--vscode-foreground));
  }

  .vim-toggle {
    padding: 3px 7px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 11px;
    line-height: 1.2;
  }
  .vim-toggle:hover:not(:disabled) {
    background: var(--vscode-statusBarItem-hoverBackground, var(--vscode-toolbar-hoverBackground));
  }

  .vim-toggle:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  .vim-toggle:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
