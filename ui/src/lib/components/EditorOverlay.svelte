<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Transport } from "../transport/MessageTransport";
  import * as monaco from "monaco-editor";
  import { initVimMode, VimMode } from "monaco-vim";
  import { setupMonacoGlsl } from "@shader-studio/monaco";

  export let isVisible: boolean = false;
  export let shaderCode: string = "";
  export let shaderPath: string = "";
  export let transport: Transport;
  export let onCodeChange: (code: string) => void = () => {};
  export let vimMode: boolean = false;
  export let bottomInset: number = 0;
  export let bufferNames: string[] = ["Image"];
  export let activeBufferName: string = "Image";
  export let onBufferSwitch: (bufferName: string) => void = () => {};
  export let errors: string[] = [];

  let containerEl: HTMLDivElement;
  let statusBarEl: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let vimModeInstance: any = null;
  let editorReady = false;
  let recompileTimer: ReturnType<typeof setTimeout> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentCode: string | null = null;
  let lastShaderPath: string = "";
  let vimStatusAttached = false;
  let vimCurrentMode = "normal";

  function focusMonacoTextInput() {
    if (!containerEl) return;
    const input = (containerEl.querySelector("textarea.inputarea")
      || containerEl.querySelector(".monaco-editor textarea")
      || containerEl.querySelector("textarea")) as HTMLTextAreaElement | null;
    input?.focus({ preventScroll: true });
  }

  function syncVimStatus(mode?: string) {
    vimCurrentMode = mode ?? "normal";
    if (!statusBarEl) return;

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
    if (!editor) return;

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

  function editorHasFocus(): boolean {
    if (!editor) return false;
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
    // Try exact match first, then case-insensitive prefix match
    const exact = bufferNames.find(b => b === name);
    if (exact) { onBufferSwitch(exact); return; }
    const lower = name.toLowerCase();
    const match = bufferNames.find(b => b.toLowerCase().startsWith(lower));
    if (match) onBufferSwitch(match);
  }

  let vimCommandsRegistered = false;

  function registerVimCommands() {
    if (vimCommandsRegistered) return;
    try {
      const vim = (VimMode as any).Vim;
      if (!vim?.defineEx) return;

      vim.defineEx('bnext', 'bn', () => switchToNextBuffer());
      vim.defineEx('bprev', 'bp', () => switchToPrevBuffer());
      vim.defineEx('buffer', 'b', (_cm: any, params: any) => {
        const name = params?.args?.[0];
        if (name) switchToNamedBuffer(name);
      });
      vim.defineEx('lnext', 'lne', () => {
        editor?.getAction('editor.action.marker.next')?.run();
      });
      vim.defineEx('lprev', 'lp', () => {
        editor?.getAction('editor.action.marker.prev')?.run();
      });

      // Custom vim actions that trigger Monaco editor commands
      vim.defineAction('nextDiagnostic', () => {
        editor?.trigger('vim', 'editor.action.marker.next', null);
      });
      vim.defineAction('prevDiagnostic', () => {
        editor?.trigger('vim', 'editor.action.marker.prev', null);
      });
      vim.defineAction('showHover', () => {
        editor?.trigger('vim', 'editor.action.showHover', null);
      });

      // ]d / [d — next/prev diagnostic
      vim.mapCommand(']d', 'action', 'nextDiagnostic', {}, { context: 'normal' });
      vim.mapCommand('[d', 'action', 'prevDiagnostic', {}, { context: 'normal' });
      // gl — show hover (error tooltip) at cursor
      vim.mapCommand('gl', 'action', 'showHover', {}, { context: 'normal' });

      vimCommandsRegistered = true;
    } catch (e) {
      // monaco-vim API may differ across versions
      console.warn('Failed to register vim buffer commands:', e);
    }
  }

  function enableVim() {
    if (!editor || vimModeInstance) return;
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
    if (!editor || !vimModeInstance?.state?.vim) return;

    const position = editor.getPosition();
    const model = editor.getModel();
    if (!position || !model) return;

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
    if (!editor || !containerEl) return;
    const model = editor.getModel();
    if (!model) return;
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const padding = editor.getOption(monaco.editor.EditorOption.padding);
    const topPad = padding?.top ?? 0;
    requestAnimationFrame(() => {
      if (!containerEl) return;
      const viewLines = containerEl.querySelectorAll('.view-lines .view-line');
      viewLines.forEach((el) => {
        const htmlEl = el as HTMLElement;
        const top = parseFloat(htmlEl.style.top);
        if (isNaN(top)) return;
        const lineNum = Math.round((top - topPad) / lineHeight) + 1;
        const isBlank = lineNum >= 1 && lineNum <= model!.getLineCount()
          && model!.getLineContent(lineNum).trim() === '';
        htmlEl.classList.toggle('blank-line', isBlank);
      });
    });
  }

  function createEditor() {
    if (!containerEl || editor) return;

    setupMonacoGlsl(monaco as any);

    editor = monaco.editor.create(containerEl, {
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
    });

    editor.onKeyDown?.((event: any) => {
      const browserKey = event.browserEvent?.key;

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
      if (!editor) return;
      updateBlankLineDecorations();
      const code = editor.getValue();
      if (code === undefined || !shaderPath) return;

      // Fast recompile for immediate visual feedback
      if (recompileTimer) clearTimeout(recompileTimer);
      recompileTimer = setTimeout(() => {
        onCodeChange(code);
      }, 30);

      // Slower debounce for file persistence to extension
      if (persistTimer) clearTimeout(persistTimer);
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
      }, 500);
    });

    lastShaderPath = shaderPath;

    if (vimMode) {
      enableVim();
    }

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
    disableVim();
    if (containerEl) {
      containerEl.removeEventListener("mousedown", handleContainerMouseDown, true);
    }
    if (editor) {
      editor.dispose();
      editor = null;
    }
    editorReady = false;
    lastSentCode = null;
  }

  // React to visibility changes
  $: if (isVisible && containerEl && !editor) {
    createEditor();
  }
  $: if (!isVisible && editor) {
    destroyEditor();
  }
  $: if (isVisible && editor) {
    editor.focus();
    requestAnimationFrame(() => focusMonacoTextInput());
  }

  // React to vim mode toggle
  $: if (editor) {
    if (vimMode && !vimModeInstance) {
      enableVim();
    } else if (!vimMode && vimModeInstance) {
      disableVim();
    }
  }

  // The status bar element can bind after editor creation.
  // Re-attempt so Vim mode can attach status UI when available.
  $: if (editor && vimMode && !vimModeInstance) {
    enableVim();
  }
  $: if (editor && vimMode && vimModeInstance && statusBarEl && !vimStatusAttached) {
    vimModeInstance.dispose();
    vimModeInstance = null;
    enableVim();
  }

  // React to error changes — set Monaco markers
  $: if (editor) {
    updateErrorMarkers(errors);
  }

  function updateErrorMarkers(errs: string[]) {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    // Parse errors for the active buffer, extract line numbers
    const bufferPrefix = activeBufferName === "Image" ? "Image" : activeBufferName;
    const markers: monaco.editor.IMarkerData[] = [];

    for (const err of errs) {
      // Format: "BufferName: ERROR: 0:LINE: message"
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

  // React to external shader code changes.
  // When the file path changes (buffer switch), always apply the new content.
  // When the same file updates, only apply if the editor doesn't have focus.
  $: if (editor && shaderCode !== undefined) {
    const fileChanged = shaderPath !== lastShaderPath;
    const currentValue = editor.getValue();

    if (fileChanged) {
      // Switched to a different file — always apply, reset state
      editor.setValue(shaderCode);
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.setScrollTop(0);
      lastSentCode = null;
      lastShaderPath = shaderPath;
    } else if (currentValue === shaderCode) {
      lastSentCode = null;
    } else if (lastSentCode !== null && shaderCode === lastSentCode) {
      lastSentCode = null;
    } else if (!editorHasFocus()) {
      // Genuine external change and editor doesn't have focus — apply it
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
    <div class="vim-status-bar" bind:this={statusBarEl}></div>
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
