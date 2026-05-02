<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Transport } from "../transport/MessageTransport";
  import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
  import { initVimMode, VimMode } from "monaco-vim";
  import { setupMonacoGlsl } from "@shader-studio/monaco";

  type CompileMode = "hot" | "save" | "manual";

  interface Props {
    isVisible?: boolean;
    shaderCode?: string;
    shaderPath?: string;
    transport: Transport;
    onCodeChange?: (code: string) => void;
    vimMode?: boolean;
    bottomInset?: number;
    bufferNames?: string[];
    activeBufferName?: string;
    onBufferSwitch?: (bufferName: string) => void;
    errors?: string[];
    compileMode?: CompileMode;
    onCursorChange?: (line: number, lineContent: string, bufferName: string) => void;
  }

  let {
    isVisible = false,
    shaderCode = "",
    shaderPath = "",
    transport,
    onCodeChange = () => {},
    vimMode = false,
    bottomInset = 0,
    bufferNames = ["Image"],
    activeBufferName = "Image",
    onBufferSwitch = (_bufferName: string) => {},
    errors = [],
    compileMode = "hot",
    onCursorChange = (_line: number, _lineContent: string, _bufferName: string) => {},
  }: Props = $props();

  let containerEl = $state<HTMLDivElement | null>(null);
  let statusBarEl = $state<HTMLDivElement | null>(null);
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let vimModeInstance: any = null;
  let editorReady = $state(false);
  let recompileTimer: ReturnType<typeof setTimeout> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentCode: string | null = null;
  let cursorChangeDisposable: monaco.editor.IDisposable | null = null;
  let lastShaderPath: string = "";
  let vimStatusAttached = false;
  let vimCurrentMode = "normal";
  const savedViewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  const PERSIST_DELAY_MS = 15;

  function focusMonacoTextInput() {
    if (!containerEl) {
      return;
    }
    const input = (containerEl.querySelector("textarea.inputarea")
      || containerEl.querySelector(".monaco-editor textarea")
      || containerEl.querySelector("textarea")) as HTMLTextAreaElement | null;
    input?.focus({ preventScroll: true });
  }

  function syncVimStatus(mode?: string) {
    vimCurrentMode = mode ?? "normal";
    if (!statusBarEl) {
      return;
    }

    switch (mode) {
      case "insert":
        statusBarEl.textContent = "-- INSERT --";
        break;
      case "visual":
        statusBarEl.textContent = "-- VISUAL --";
        break;
      case "visualblock":
        statusBarEl.textContent = "-- VISUAL BLOCK --";
        break;
      case "replace":
        statusBarEl.textContent = "-- REPLACE --";
        break;
      default:
        statusBarEl.textContent = "-- NORMAL --";
        break;
    }
  }

  function syncCursorForMode(mode?: string) {
    if (!editor) {
      return;
    }

    if (mode === "insert" || mode === "replace") {
      editor.updateOptions({
        cursorStyle: "line",
        cursorWidth: 1,
      });
      return;
    }

    editor.updateOptions({
      cursorStyle: "block",
      cursorWidth: 2,
    });
  }

  function handleContainerMouseDown() {
    focusMonacoTextInput();
  }

  function handleOverlaySave() {
    if (!transport || !shaderPath) {
      return;
    }
    transport.postMessage({
      type: "extensionCommand",
      payload: { command: "saveCurrentShader" },
    });
  }

  function editorHasFocus(): boolean {
    if (!editor) {
      return false;
    }
    return editor.hasTextFocus();
  }

  function switchToNextBuffer() {
    const idx = bufferNames.indexOf(activeBufferName);
    const next = bufferNames[(idx + 1) % bufferNames.length];
    onBufferSwitch(next);
  }

  function switchToPrevBuffer() {
    const idx = bufferNames.indexOf(activeBufferName);
    const prev = bufferNames[(idx - 1 + bufferNames.length) % bufferNames.length];
    onBufferSwitch(prev);
  }

  function switchToNamedBuffer(name: string) {
    const exact = bufferNames.find(b => b === name);
    if (exact) {
      onBufferSwitch(exact); return;
    }
    const lower = name.toLowerCase();
    const match = bufferNames.find(b => b.toLowerCase().startsWith(lower));
    if (match) {
      onBufferSwitch(match);
    }
  }

  let vimCommandsRegistered = false;

  function registerVimCommands() {
    if (vimCommandsRegistered) {
      return;
    }
    try {
      const vim = (VimMode as any).Vim;
      if (!vim?.defineEx) {
        return;
      }

      vim.defineEx('bnext', 'bn', () => switchToNextBuffer());
      vim.defineEx('bprev', 'bp', () => switchToPrevBuffer());
      vim.defineEx('buffer', 'b', (_cm: any, params: any) => {
        const name = params?.args?.[0];
        if (name) {
          switchToNamedBuffer(name);
        }
      });
      vim.defineEx('lnext', 'lne', () => {
        editor?.getAction('editor.action.marker.next')?.run();
      });
      vim.defineEx('lprev', 'lp', () => {
        editor?.getAction('editor.action.marker.prev')?.run();
      });

      vim.defineAction('nextDiagnostic', () => {
        editor?.trigger('vim', 'editor.action.marker.next', null);
      });
      vim.defineAction('prevDiagnostic', () => {
        editor?.trigger('vim', 'editor.action.marker.prev', null);
      });
      vim.defineAction('showHover', () => {
        editor?.trigger('vim', 'editor.action.showHover', null);
      });

      vim.mapCommand(']d', 'action', 'nextDiagnostic', {}, { context: 'normal' });
      vim.mapCommand('[d', 'action', 'prevDiagnostic', {}, { context: 'normal' });
      vim.mapCommand('gl', 'action', 'showHover', {}, { context: 'normal' });

      vimCommandsRegistered = true;
    } catch (e) {
      console.warn('Failed to register vim buffer commands:', e);
    }
  }

  function enableVim() {
    if (!editor || vimModeInstance) {
      return;
    }
    registerVimCommands();
    vimModeInstance = initVimMode(editor as any, statusBarEl ?? null);
    vimModeInstance.on?.("vim-mode-change", ({ mode }: { mode?: string }) => {
      syncVimStatus(mode);
      syncCursorForMode(mode);
      if (mode === "insert" || mode === "replace") {
        requestAnimationFrame(() => focusMonacoTextInput());
      }
    });
    editor.updateOptions({ readOnly: false, domReadOnly: false });
    editor.focus();
    requestAnimationFrame(() => focusMonacoTextInput());
    vimStatusAttached = !!statusBarEl;
    syncVimStatus();
    syncCursorForMode();
  }

  function disableVim() {
    if (vimModeInstance) {
      vimModeInstance.dispose();
      vimModeInstance = null;
    }
    vimStatusAttached = false;
    if (statusBarEl) {
      statusBarEl.textContent = "";
    }
  }

  function fallbackEnterInsertMode(key: string) {
    if (!editor || !vimModeInstance?.state?.vim) {
      return;
    }

    const position = editor.getPosition();
    const model = editor.getModel();
    if (!position || !model) {
      return;
    }

    const lineNumber = position.lineNumber;
    const lineContent = model.getLineContent(lineNumber);
    const lineMaxColumn = model.getLineMaxColumn(lineNumber);

    switch (key) {
      case "a":
        editor.setPosition({
          lineNumber,
          column: Math.min(position.column + 1, lineMaxColumn),
        });
        break;
      case "I": {
        const indentColumn = (lineContent.match(/^\s*/) ?? [""])[0].length + 1;
        editor.setPosition({ lineNumber, column: indentColumn });
        break;
      }
      case "A":
        editor.setPosition({ lineNumber, column: lineMaxColumn });
        break;
      case "o":
        editor.executeEdits("vim-fallback", [{
          range: new monaco.Range(lineNumber, lineMaxColumn, lineNumber, lineMaxColumn),
          text: "\n",
        }]);
        editor.setPosition({ lineNumber: lineNumber + 1, column: 1 });
        break;
      case "O":
        editor.executeEdits("vim-fallback", [{
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          text: "\n",
        }]);
        editor.setPosition({ lineNumber, column: 1 });
        break;
      default:
        break;
    }

    vimModeInstance.state.keyMap = "vim-insert";
    vimModeInstance.state.vim.insertMode = true;
    vimModeInstance.state.vim.visualMode = false;
    syncVimStatus("insert");
    syncCursorForMode("insert");
    requestAnimationFrame(() => focusMonacoTextInput());
  }

  function updateBlankLineDecorations() {
    if (!editor || !containerEl) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const padding = editor.getOption(monaco.editor.EditorOption.padding);
    const topPad = padding?.top ?? 0;
    requestAnimationFrame(() => {
      if (!containerEl) {
        return;
      }
      const viewLines = containerEl.querySelectorAll('.view-lines .view-line');
      viewLines.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const top = parseFloat(htmlEl.style.top);
        if (isNaN(top)) {
          return;
        }
        const lineNum = Math.round((top - topPad) / lineHeight) + 1;
        const isBlank = lineNum >= 1 && lineNum <= model!.getLineCount()
          && model!.getLineContent(lineNum).trim() === '';
        htmlEl.classList.toggle('blank-line', isBlank);
      });
    });
  }

  function createEditor() {
    if (!containerEl || editor) {
      return;
    }

    setupMonacoGlsl(monaco as any);

    const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions & { editContext?: boolean } = {
      value: shaderCode,
      language: "glsl",
      theme: "shader-studio-transparent",
      minimap: { enabled: false },
      scrollbar: {
        vertical: "hidden",
        horizontal: "hidden",
        useShadows: false,
      },
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      renderLineHighlight: "line",
      selectionHighlight: false,
      occurrencesHighlight: "off",
      automaticLayout: true,
      fontSize: 14,
      lineHeight: 20,
      padding: { top: 0 },
      stickyScroll: { enabled: false },
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 4,
      lineNumbers: "on",
      lineNumbersMinChars: 4,
      scrollBeyondLastLine: false,
      contextmenu: false,
      fixedOverflowWidgets: true,
      readOnly: false,
      domReadOnly: false,
      editContext: false,
      cursorStyle: "line",
      cursorWidth: 2,
      cursorBlinking: "smooth",
      guides: {
        indentation: false,
        bracketPairs: false,
        highlightActiveIndentation: false,
        bracketPairsHorizontal: false,
      },
    };

    editor = monaco.editor.create(containerEl, editorOptions);

    if (shaderPath && savedViewStates.has(shaderPath)) {
      editor.restoreViewState(savedViewStates.get(shaderPath) ?? null);
    }

    editor.onKeyDown?.((event: any) => {
      const browserKey = event.browserEvent?.key;
      const metaKey = !!event.browserEvent?.metaKey;
      const ctrlKey = !!event.browserEvent?.ctrlKey;

      if ((metaKey || ctrlKey) && browserKey?.toLowerCase() === "s") {
        event.browserEvent?.preventDefault?.();
        event.browserEvent?.stopPropagation?.();
        handleOverlaySave();
        return;
      }

      if (
        browserKey
        && ["i", "a", "I", "A", "o", "O"].includes(browserKey)
        && vimCurrentMode === "normal"
        && vimModeInstance?.state?.vim
      ) {
        event.browserEvent?.preventDefault?.();
        event.browserEvent?.stopPropagation?.();
        fallbackEnterInsertMode(browserKey);
      }
    });

    editor.onDidScrollChange(() => updateBlankLineDecorations());
    containerEl.addEventListener("mousedown", handleContainerMouseDown, true);

    editor.onDidChangeModelContent(() => {
      if (!editor) {
        return;
      }
      updateBlankLineDecorations();
      const code = editor.getValue();
      if (code === undefined || !shaderPath) {
        return;
      }

      if (compileMode === "hot") {
        if (recompileTimer) {
          clearTimeout(recompileTimer);
        }
        recompileTimer = setTimeout(() => {
          onCodeChange(code);
        }, 30);
      }

      if (persistTimer) {
        clearTimeout(persistTimer);
      }
      persistTimer = setTimeout(() => {
        if (transport && shaderPath) {
          lastSentCode = code;
          transport.postMessage({
            type: "updateShaderSource",
            payload: {
              code,
              path: shaderPath,
            },
          });
        }
      }, PERSIST_DELAY_MS);
    });

    lastShaderPath = shaderPath;

    if (vimMode) {
      enableVim();
    }

    cursorChangeDisposable = editor.onDidChangeCursorPosition(() => {
      const position = editor?.getPosition();
      const model = editor?.getModel();
      if (!position || !model) return;
      const line = position.lineNumber - 1;
      const content = model.getLineContent(position.lineNumber);
      const buffer = activeBufferName;
      queueMicrotask(() => onCursorChange(line, content, buffer));
    });

    editor.focus();
    requestAnimationFrame(() => focusMonacoTextInput());
    updateBlankLineDecorations();
    editorReady = true;
  }

  function destroyEditor() {
    if (recompileTimer) {
      clearTimeout(recompileTimer);
      recompileTimer = null;
    }
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (cursorChangeDisposable) {
      cursorChangeDisposable.dispose();
      cursorChangeDisposable = null;
    }
    disableVim();
    if (containerEl) {
      containerEl.removeEventListener("mousedown", handleContainerMouseDown, true);
    }
    if (editor) {
      if (shaderPath) {
        savedViewStates.set(shaderPath, editor.saveViewState());
      }
      editor.dispose();
      editor = null;
    }
    editorReady = false;
    lastSentCode = null;
  }

  $effect(() => {
    if (isVisible && containerEl && !editor) {
      createEditor();
    }
    if (!isVisible && editor) {
      destroyEditor();
    }
  });

  $effect(() => {
    if (isVisible && editor) {
      editor.focus();
      requestAnimationFrame(() => focusMonacoTextInput());
    }
  });

  $effect(() => {
    if (editor) {
      if (vimMode && !vimModeInstance) {
        enableVim();
      } else if (!vimMode && vimModeInstance) {
        disableVim();
      }
    }
  });

  $effect(() => {
    if (editor && vimMode && vimModeInstance && statusBarEl && !vimStatusAttached) {
      vimModeInstance.dispose();
      vimModeInstance = null;
      enableVim();
    }
  });

  $effect(() => {
    if (editor) {
      updateErrorMarkers(errors);
    }
  });

  function updateErrorMarkers(errs: string[]) {
    if (!editor) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }

    const bufferPrefix = activeBufferName === "Image" ? "Image" : activeBufferName;
    const markers: monaco.editor.IMarkerData[] = [];

    for (const err of errs) {
      const match = err.match(new RegExp(`^${bufferPrefix}: ERROR: 0:(\\d+):\\s*(.+)`, 's'));
      if (match) {
        const line = parseInt(match[1], 10);
        const message = match[2].trim();
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
          message,
        });
      }
    }

    monaco.editor.setModelMarkers(model, 'glsl', markers);
  }

  $effect(() => {
    if (editor && shaderCode !== undefined) {
      const fileChanged = shaderPath !== lastShaderPath;
      const currentValue = editor.getValue();

      if (fileChanged) {
        if (lastShaderPath) {
          savedViewStates.set(lastShaderPath, editor.saveViewState());
        }
        editor.setValue(shaderCode);
        const nextViewState = shaderPath ? savedViewStates.get(shaderPath) : null;
        if (nextViewState) {
          editor.restoreViewState(nextViewState);
        } else {
          editor.setPosition({ lineNumber: 1, column: 1 });
          editor.setScrollTop(0);
        }
        lastSentCode = null;
        lastShaderPath = shaderPath;
      } else if (currentValue === shaderCode) {
        lastSentCode = null;
      } else if (lastSentCode !== null && shaderCode === lastSentCode) {
        lastSentCode = null;
      } else if (!editorHasFocus()) {
        const position = editor.getPosition();
        const scrollTop = editor.getScrollTop();
        editor.setValue(shaderCode);
        if (position) {
          editor.setPosition(position);
        }
        editor.setScrollTop(scrollTop);
        lastSentCode = null;
      }
    }
  });

  onMount(() => {
    if (isVisible) {
      createEditor();
    }
  });

  onDestroy(() => {
    destroyEditor();
  });
</script>

{#if isVisible}
  <div class="editor-wrapper" class:ready={editorReady} style={`bottom: ${bottomInset}px;`}>
    <div
      class="editor-overlay"
      bind:this={containerEl}
    ></div>
    {#if vimMode}
      <div class="vim-status-bar" bind:this={statusBarEl}></div>
    {/if}
  </div>
{/if}

<style>
  .editor-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1200;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    /* Hidden until Monaco initializes */
    opacity: 0;
    transition: opacity 0.15s ease-in;
  }

  .editor-wrapper.ready {
    opacity: 1;
  }

  .editor-overlay {
    flex: 1;
    overflow: hidden;
  }

  .vim-status-bar {
    position: absolute;
    bottom: 8px;
    right: 8px;
    min-height: 20px;
    font-family: monospace;
    font-size: 12px;
    color: #d4d4d4;
    background: rgba(10, 10, 10, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 0 8px;
    line-height: 20px;
    z-index: 1200;
    pointer-events: none;
  }

  /* Make ALL Monaco backgrounds transparent */
  .editor-overlay :global(.monaco-editor),
  .editor-overlay :global(.monaco-editor .overflow-guard),
  .editor-overlay :global(.monaco-editor-background),
  .editor-overlay :global(.monaco-editor .inputarea.ime-input) {
    background: transparent !important;
    outline: none !important;
    box-shadow: none !important;
    border: none !important;
  }

  .editor-overlay :global(.monaco-editor.focused),
  .editor-overlay :global(.monaco-editor:focus),
  .editor-overlay :global(.monaco-editor [tabindex]:focus),
  .editor-overlay :global(.monaco-editor textarea:focus) {
    outline: none !important;
    box-shadow: none !important;
    border-color: transparent !important;
  }

  /* Force-hide Monaco's internal textarea */
  .editor-overlay :global(.monaco-editor textarea) {
    resize: none !important;
  }

  /* Semi-transparent background on the inline text content */
  .editor-overlay :global(.monaco-editor .view-lines .view-line > span) {
    background: rgba(10, 10, 10, 0.75);
    border-radius: 0;
    padding-right: 4px;
    text-shadow: 0 0 1px rgba(0, 0, 0, 0.8), 0 0 3px rgba(0, 0, 0, 0.4);
  }

  /* No background for blank lines */
  .editor-overlay :global(.monaco-editor .view-line.blank-line > span) {
    background: transparent !important;
  }

  /* Line numbers with matching background */
  .editor-overlay :global(.monaco-editor .margin-view-overlays .line-numbers) {
    background: rgba(10, 10, 10, 0.75);
    border-radius: 0;
    padding-left: 4px;
    padding-right: 8px;
  }

  /* Current line number highlight */
  .editor-overlay :global(.monaco-editor .margin-view-overlays .current-line ~ .line-numbers) {
    color: #c6c6c6;
  }

  /* Current line highlight */
  .editor-overlay :global(.monaco-editor .current-line) {
    background: rgba(255, 255, 255, 0.06) !important;
    border: none !important;
  }

  /* Make the margin/gutter background transparent */
  .editor-overlay :global(.monaco-editor .margin) {
    background: transparent !important;
  }

  /* Cursor — bright and visible */
  .editor-overlay :global(.monaco-editor .cursor) {
    background: #ffffff !important;
    border-color: #ffffff !important;
  }

  /* Selection styling */
  .editor-overlay :global(.monaco-editor .selected-text) {
    background: rgba(255, 255, 255, 0.3) !important;
  }

  /* Hide scrollbars */
  .editor-overlay :global(.monaco-editor .monaco-scrollable-element > .scrollbar) {
    opacity: 0;
  }

  /* Active line number in gutter */
  .editor-overlay :global(.monaco-editor .active-line-number) {
    color: #c6c6c6 !important;
  }

/* Error squiggly — raise above the semi-transparent text backgrounds */
  .editor-overlay :global(.monaco-editor .view-overlays) {
    z-index: 1 !important;
    pointer-events: none;
  }
  .editor-overlay :global(.monaco-editor .squiggly-error) {
    opacity: 1 !important;
  }

  /* Hover widget (error tooltips) */
  .editor-overlay :global(.monaco-editor .monaco-hover) {
    background: rgba(30, 30, 30, 0.95) !important;
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
  }

  .editor-overlay :global(.monaco-editor .monaco-hover-content) {
    background: transparent !important;
    color: #d4d4d4 !important;
  }

  /* Hover status bar (bottom of hover widget) */
  .editor-overlay :global(.monaco-editor .monaco-hover .hover-row.status-bar) {
    background: rgba(255, 255, 255, 0.05) !important;
  }
</style>
