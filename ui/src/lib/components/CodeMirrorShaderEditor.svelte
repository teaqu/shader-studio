<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { ShaderCodeMirrorEditor, CodeMirrorLanguageService, defaultPreferences } from '@shader-studio/codemirror';
  import { shaderLanguageForPath } from '@shader-studio/types';
  import type { ShaderEditorProps } from '../editor/ShaderEditorProps';
  import { createLanguageServiceFactories } from '../editor/createLanguageServiceFactories';
  import { shaderAuthoringEnvironment } from '../editor/shaderAuthoringEnvironment';
  import { compilerDiagnostics } from '../editor/compilerDiagnostics';
  import { EditorSourceSession } from '../editor/EditorSourceSession';
  import { editorDescriptionsEnabled, getHostEditorPreferences, toggleHostEditorWordWrap } from '../state/hostState.svelte';
  import { getLanguageServiceSettings } from '../state/languageServiceState.svelte';
  import { getCommonShaderSource } from '../state/commonSourceState.svelte';
  import { createEditorSelectionSource, getEditorSelection, setEditorSelection } from '../state/editorSelectionState.svelte';
  import { currentTheme } from '../stores/themeStore';
  import EditorToolbar from './EditorToolbar.svelte';

  interface Props extends ShaderEditorProps {}
  let { ...props }: Props = $props();
  let container = $state<HTMLDivElement>();
  let editor = $state.raw<ShaderCodeMirrorEditor>();
  let service = $state.raw<CodeMirrorLanguageService>();
  let status = $state<'pending' | 'ready' | 'error'>('pending');
  let mounted = $state(false);
  let touch = $state(false);
  let generation = 0;
  let showingPath = '';
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSent: string | undefined;
  let applyingSelection = false;
  const selectionSource = createEditorSelectionSource();
  const navigationSource = createEditorSelectionSource();
  const selection = $derived(getEditorSelection(props.shaderPath ?? ''));
  const preferences = $derived(getHostEditorPreferences()?.() ?? defaultPreferences);
  const descriptions = $derived(editorDescriptionsEnabled(getHostEditorPreferences()?.(), touch));
  const factories = createLanguageServiceFactories();
  const session = untrack(() => new EditorSourceSession(props.transport,
    (code, path) => {
      if (props.shaderPath === path) {
        props.onCodeChange?.(code, path);
      }
    },
    (code, path) => {
      if (props.shaderPath === path) {
        lastSent = code;
      }
    }));

  function publishSelection(from: number, to: number) {
    const view = editor?.view;
    const path = props.shaderPath;
    if (!view || !path) {
      return;
    }
    const start = view.state.doc.lineAt(from);
    const end = view.state.doc.lineAt(to);
    if (!applyingSelection) {
      setEditorSelection(path, selectionSource, {
        startLineNumber: start.number, startColumn: from - start.from + 1,
        endLineNumber: end.number, endColumn: to - end.from + 1,
      });
    }
    clearTimeout(cursorTimer);
    const buffer = props.activeBufferName ?? 'Image';
    cursorTimer = setTimeout(() => props.onCursorChange?.(end.number - 1, end.text, buffer), 150);
  }

  function flush() {
    session.flush();
  }
  function save() {
    flush();
    props.transport.postMessage({ type: 'extensionCommand', payload: { command: 'saveCurrentShader' } });
  }
  function compile() {
    flush();
    if (props.onManualCompile) {
      props.onManualCompile();
    } else {
      props.transport.postMessage({ type: 'manualCompile' });
    }
  }

  $effect(() => {
    if (!mounted || !container || !props.isVisible) {
      return;
    }
    const created = untrack(() => new ShaderCodeMirrorEditor(container!, {
      path: props.shaderPath ?? '', code: props.shaderCode ?? '', preferences,
      dark: $currentTheme === 'dark', overlay: props.displayMode !== 'pane', vim: props.vimMode,
      tooltipParent: props.overflowWidgetsDomNode,
      onChange: (code, path) => session.change(path, code, (props.compileMode ?? 'hot') === 'hot'),
      onSelection: publishSelection, onSave: save, onCompile: compile, onToggleWrap: toggleHostEditorWordWrap,
    }));
    editor = created;
    showingPath = untrack(() => props.shaderPath ?? '');
    untrack(() => {
      if (!getEditorSelection(props.shaderPath ?? '')) {
        publishSelection(0, 0);
      }
    });
    return () => {
      session.dispose();
      clearTimeout(cursorTimer);
      created.dispose();
      editor = undefined;
    };
  });

  $effect(() => {
    const current = editor;
    const path = props.shaderPath ?? '';
    const code = props.shaderCode ?? '';
    if (!current) {
      return;
    }
    if (path !== showingPath) {
      flush();
      current.setDocument(path, code);
      showingPath = path;
      lastSent = undefined;
      const next = current.view.state.selection.main;
      untrack(() => {
        if (!getEditorSelection(path)) {
          publishSelection(next.from, next.to);
        }
      });
    } else if (current.view.state.doc.toString() === code || code === lastSent) {
      current.setDocument(path, code);
      lastSent = undefined;
    } else if (!current.hasDocumentFocus) {
      current.setDocument(path, code);
    }
  });

  $effect(() => {
    editor?.configure(preferences, $currentTheme === 'dark', props.vimMode ?? false, props.displayMode !== 'pane');
  });

  $effect(() => {
    const current = editor;
    const next = selection;
    if (!current || !next || next.source === selectionSource) {
      return;
    }
    const doc = current.view.state.doc;
    const start = doc.line(Math.min(Math.max(1, next.selection.startLineNumber), doc.lines));
    const end = doc.line(Math.min(Math.max(1, next.selection.endLineNumber), doc.lines));
    applyingSelection = true;
    current.view.dispatch({ selection: {
      anchor: start.from + Math.min(Math.max(0, next.selection.startColumn - 1), start.length),
      head: end.from + Math.min(Math.max(0, next.selection.endColumn - 1), end.length),
    }, scrollIntoView: true });
    applyingSelection = false;
  });

  $effect(() => {
    const current = editor;
    const language = shaderLanguageForPath(props.shaderPath ?? '');
    const settings = getLanguageServiceSettings();
    const enabled = language && settings[`${language}Enabled`];
    if (!current || !language || !enabled) {
      service = undefined;
      status = 'pending';
      current?.setServiceExtensions([]);
      return;
    }
    const created = new CodeMirrorLanguageService(factories[language], next => {
      status = next;
    }, {
      onNavigate: (uri, line, column) => {
        const path = decodeURIComponent(new URL(uri).pathname);
        flush();
        setEditorSelection(path, navigationSource, { startLineNumber: line + 1, startColumn: column + 1, endLineNumber: line + 1, endColumn: column + 1 });
        props.transport.postMessage({ type: 'navigateToBuffer', payload: { shaderPath: props.shaderPath ?? '', bufferPath: path } });
      },
    });
    service = created;
    current.setServiceExtensions(created.extensions(), created.completionSource);
    return () => {
      created.dispose();
    };
  });

  $effect(() => {
    service?.setDescriptionsEnabled(descriptions);
  });

  $effect(() => {
    const current = service;
    const environment = shaderAuthoringEnvironment(props, ++generation, getCommonShaderSource());
    if (!current || !environment) {
      return;
    }
    let cancelled = false;
    void (async () => {
      await current.syncEnvironment(environment);
      if (props.transport.getWorkspaceDocuments) {
        const workspaceDocuments = await props.transport.getWorkspaceDocuments(environment.languageId);
        if (!cancelled) {
          await current.syncEnvironment({ ...environment, workspaceDocuments });
        }
      }
    })().catch(() => {
      if (!cancelled) {
        status = 'error';
      }
    });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const current = editor;
    const errors = props.errors ?? [];
    const buffer = props.activeBufferName ?? 'Image';
    // Re-run after external content replacements too: compiler lines may need clamping.
    const code = props.shaderCode;
    if (!current || code === undefined) {
      return;
    }
    const doc = current.view.state.doc;
    const diagnostics = compilerDiagnostics(errors, buffer, { getLineCount: () => doc.lines, getLineMaxColumn: line => doc.line(line).length + 1 });
    current.setDiagnostics(diagnostics.map(diagnostic => {
      const line = doc.line(diagnostic.startLineNumber);
      return { from: line.from + diagnostic.startColumn - 1, to: line.from + diagnostic.endColumn - 1, severity: 'error', message: diagnostic.message };
    }));
  });

  onMount(() => {
    mounted = true;
    const media = window.matchMedia?.('(max-width: 767px), (pointer: coarse)');
    const update = () => {
      touch = media?.matches ?? false;
    };
    update();
    media?.addEventListener('change', update);
    const detach = props.transport.registerPendingSave?.(flush);
    return () => {
      detach?.(); media?.removeEventListener('change', update);
    };
  });
</script>

{#if props.isVisible}
  <div class="editor-wrapper codemirror-wrapper" class:pane={props.displayMode === 'pane'} data-editor-engine="codemirror" data-language-service-status={status} style={`bottom: ${props.bottomInset ?? 0}px; --editor-top-inset: ${props.topInset ?? 0}px; --editor-bottom-inset: ${props.bottomInset ?? 0}px;`}>
    <div class="codemirror-container" data-active-buffer={props.activeBufferName ?? 'Image'} bind:this={container}></div>
    {#if status === 'error'}<div class="service-status" role="status">Language assistance unavailable. Editing and saving are still available.</div>{/if}
    <EditorToolbar {touch} options={props.editorOptions}
      onCommand={command => editor?.command(command)}
      onInsert={symbol => editor?.insert(symbol)} />
  </div>
{/if}

<style>
  .codemirror-wrapper { position: absolute; inset: 0; z-index: 1200; pointer-events: auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .codemirror-wrapper.pane { position: relative; margin-top: var(--editor-top-inset, 0px); height: calc(100% - var(--editor-top-inset, 0px) - var(--editor-bottom-inset, 0px)); z-index: auto; }
  .codemirror-container { flex: 1; min-height: 0; overflow: hidden; }
  .service-status { font-size: 12px; padding: 4px 8px; color: var(--vscode-descriptionForeground, #aaa); }
</style>
