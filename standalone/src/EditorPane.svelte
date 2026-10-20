<svelte:options runes={true} />

<script lang="ts">
  import { getViewerSession, ShaderEditor, EditorToolbar, getHostEditorWordWrap, toggleHostEditorWordWrap } from '@shader-studio/ui';

  import { getEditorDocument, setEditorDocument } from './state/editorDocuments.svelte';
  import { passNameForFile } from './passSources';
  import type { WebTransport } from './WebTransport';
  import { isMobileViewport } from './state/mobileShellState.svelte';
  import { getEditorPreferences } from './settings/settingsState.svelte';
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
  // A separate editor keeps its file role when the preview navigates elsewhere.
  let commonEditorPath = $state<string>();
  $effect(() => {
    if (path && session?.commonPath === path) {
      commonEditorPath = path;
    }
  });
  // File panes stay on their own document when the preview switches shaders.
  const fileSession = $derived(session?.shaderPath === path ? session : null);
  // A pass file is authored against its owning shader's config: without it the
  // language service knows none of the configured storage or channels, and
  // reports every use of them as an undefined identifier. The preview's own
  // active buffer says nothing about which pass this file is.
  const owningPass = $derived(session?.shaderPath && path
    ? passNameForFile(session.config, session.shaderPath, path)
    : undefined);
  // The main shader usually has no explicit Image.path in its configuration,
  // so passNameForFile alone cannot establish its ownership.
  const authoringSession = $derived(fileSession ?? (owningPass ? session : null));
  let vimMode = $state(false);
  const wordWrap = $derived(getHostEditorWordWrap());
  const displayMode = $derived(isMobileViewport() && getEditorPreferences().mobileShaderBackdrop ? 'overlay' : 'pane');
  const canEdit = $derived(path && transport ? fileCode !== null : !!session?.ready && !!session.transport);
</script>

{#snippet editorOptions()}
  {#if wordWrap !== undefined}
    <button class="vim-toggle" type="button" aria-label="Wrap text"
      aria-pressed={wordWrap === 'on'} onmousedown={event => event.preventDefault()} onclick={toggleHostEditorWordWrap}>
      Wrap
    </button>
  {/if}
  <button
    class="vim-toggle"
    type="button"
    aria-label={vimMode ? 'Disable Vim mode' : 'Enable Vim mode'}
    aria-pressed={vimMode}
    disabled={!canEdit}
    onmousedown={event => event.preventDefault()}
    onclick={() => vimMode = !vimMode}
  >
    Vim
  </button>
{/snippet}

<div class="editor-pane" class:mobile={isMobileViewport()}>
  {#if path && transport}
    {#if fileError}<p role="alert">{fileError}</p>{/if}
    {#if fileCode !== null}
      <div class="editor-content">
        <ShaderEditor isVisible={true} shaderCode={fileCode} shaderPath={path} {transport}
          errors={fileSession?.errors ?? []}
          activeBufferName={owningPass ?? (commonEditorPath === path ? "Common" : (fileSession?.activeBufferName ?? "Image"))}
          config={authoringSession?.config}
          customUniformInfo={authoringSession?.customUniformInfo}
          slangModules={authoringSession?.slangModules}
          commonPath={session?.commonPath}
          commonSource={session?.commonSource}
          onCursorChange={(line, lineContent) => transport?.postMessage({ type: "cursorPosition", payload: { line, lineContent, filePath: path! } })}
          {vimMode} {editorOptions} {displayMode} overflowWidgetsDomNode={document.body} />
      </div>
    {/if}
  {:else}
    <!-- Keep the session snapshot available to editor teardown during viewer replacement. -->
    {#each session?.ready && session.transport ? [session] : [] as editorSession}
      <div class="editor-content">
        <ShaderEditor
          isVisible={true}
          shaderCode={editorSession.shaderCode}
          shaderPath={editorSession.shaderPath}
          transport={editorSession.transport!}
          onCodeChange={editorSession.onCodeChange}
          {vimMode}
          {editorOptions}
          bufferNames={editorSession.bufferNames}
          activeBufferName={editorSession.activeBufferName}
          onBufferSwitch={editorSession.onBufferSwitch}
          errors={editorSession.errors}
          compileMode={editorSession.compileMode}
          onManualCompile={editorSession.onManualCompile}
          config={editorSession.config}
          customUniformInfo={editorSession.customUniformInfo}
          slangModules={editorSession.slangModules}
          commonPath={editorSession.commonPath}
          commonSource={editorSession.commonSource}
          onCursorChange={editorSession.onCursorChange}
          {displayMode}
          overflowWidgetsDomNode={document.body}
        />
      </div>
    {/each}
  {/if}
  {#if !canEdit}<div class="editor-fallback"><EditorToolbar options={editorOptions} /></div>{/if}
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

  /* Keep the actual scroll surface and its scrollbar above the keyboard.
     The surrounding stage can still paint the shader behind browser chrome. */
  .editor-pane.mobile {
    box-sizing: border-box;
    padding-bottom: var(--mobile-keyboard-inset, 0px);
  }
  .editor-pane.mobile .editor-content {
    /* The editor now ends at the visible bottom, so its floating toolbar
       must not subtract the keyboard height for a second time. */
    --mobile-keyboard-inset: 0px;
  }

  .editor-fallback { margin-top: auto; }

  .vim-toggle {
    padding: var(--shader-studio-control-padding);
    border: 1px solid transparent;
    border-radius: var(--shader-studio-control-radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: var(--shader-studio-font-size);
    line-height: var(--shader-studio-control-line-height);
    min-height: var(--shader-studio-control-height);
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
