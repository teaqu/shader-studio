<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Transport } from "../transport/MessageTransport";
  import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
  import "monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError";
  import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution";
  import { initVimMode, VimMode } from "monaco-vim";
  import {
    SLANG_COMPILE_MARKER_OWNER,
    setupMonacoGlsl,
    setupMonacoSlang,
    type SlangMonacoAdapter,
  } from "@shader-studio/monaco";
  import { getBrowserSlangLanguageClient } from "../slangLanguageClient";
  import { acquireEditorModel, canonicalEditorUri, releaseEditorModel } from "../monacoModelRegistry";
  import type { SlangDiagnostic, SlangWorkspaceSnapshot } from "@shader-studio/types";

  type CompileMode = "hot" | "save" | "manual";

  interface Props {
    isVisible?: boolean;
    shaderCode?: string;
    shaderPath?: string;
    shaderLanguage?: "glsl" | "slang";
    slangWorkspace?: SlangWorkspaceSnapshot;
    transport: Transport;
    onCodeChange?: (code: string) => void;
    vimMode?: boolean;
    bottomInset?: number;
    bufferNames?: string[];
    activeBufferName?: string;
    onBufferSwitch?: (bufferName: string) => void;
    errors?: string[];
    diagnostics?: SlangDiagnostic[];
    compileMode?: CompileMode;
    onCursorChange?: (line: number, lineContent: string, bufferName: string) => void;
  }

  interface OverlayKeyEvent {
    preventDefault?: () => void;
    stopPropagation?: () => void;
    browserEvent?: {
      key?: string;
      metaKey?: boolean;
      ctrlKey?: boolean;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    };
  }

  let {
    isVisible = false,
    shaderCode = "",
    shaderPath = "",
    shaderLanguage = "glsl",
    slangWorkspace,
    transport,
    onCodeChange = () => {},
    vimMode = false,
    bottomInset = 0,
    bufferNames = ["Image"],
    activeBufferName = "Image",
    onBufferSwitch = (_bufferName: string) => {},
    errors = [],
    diagnostics = [],
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
  let cursorChangeDisposable: monaco.IDisposable | null = null;
  let modelChangeDisposable: monaco.IDisposable | null = null;
  let cursorChangeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastShaderPath: string = "";
  let lastShaderLanguage: "glsl" | "slang" = "glsl";
  let activeModel: monaco.editor.ITextModel | null = null;
  let activeModelUri = $state("");
  let activeModelPath = "";
  let activeModelLanguage = $state<"glsl" | "slang">("glsl");
  let settingEditorModel = false;
  let slangAdapter: SlangMonacoAdapter | null = null;
  let workspaceUpdateRunning = false;
  let workspaceLifecycle = 0;
  let lastQueuedWorkspaceFingerprint = "";
  let lastWorkspaceError = "";
  const workspaceUpdateQueue: Array<{
    snapshot: SlangWorkspaceSnapshot;
    fingerprint: string;
    lifecycle: number;
  }> = [];
  const compileMarkerOwners = new WeakMap<monaco.editor.ITextModel, string>();
  const structuredCompileModels = new Set<monaco.editor.ITextModel>();
  let vimStatusAttached = false;
  let vimCurrentMode = "normal";
  const savedViewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
  const PERSIST_DELAY_MS = 15;

  function currentSlangWorkspace(): SlangWorkspaceSnapshot {
    if (slangWorkspace) {
      return slangWorkspace;
    }
    const uri = canonicalEditorUri(monaco, shaderPath).toString();
    const parsed = new URL(uri);
    const name = parsed.pathname.split("/").at(-1) || "shader.slang";
    return {
      rootUri: new URL(".", parsed).href,
      files: [{ uri, path: name, source: shaderCode, version: 1 }],
    };
  }

  async function drainWorkspaceUpdates() {
    if (workspaceUpdateRunning) {
      return;
    }
    workspaceUpdateRunning = true;
    while (workspaceUpdateQueue.length > 0) {
      const update = workspaceUpdateQueue.shift()!;
      if (update.lifecycle !== workspaceLifecycle || !slangAdapter) {
        continue;
      }
      try {
        await slangAdapter.setWorkspace(update.snapshot);
        updateStructuredDiagnosticMarkers(diagnostics);
        lastWorkspaceError = "";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastWorkspaceError) {
          console.error("Failed to initialize Slang workspace:", error);
          lastWorkspaceError = message;
        }
        if (lastQueuedWorkspaceFingerprint === update.fingerprint) {
          lastQueuedWorkspaceFingerprint = "";
        }
      }
    }
    workspaceUpdateRunning = false;
  }

  function queueCurrentSlangWorkspace() {
    if (shaderLanguage !== "slang") {
      return;
    }
    if (!slangAdapter) {
      if (!editor) {
        return;
      }
      slangAdapter = setupMonacoSlang(monaco, getBrowserSlangLanguageClient());
    }
    const snapshot = currentSlangWorkspace();
    const fingerprint = JSON.stringify(snapshot);
    if (fingerprint === lastQueuedWorkspaceFingerprint) {
      return;
    }
    lastQueuedWorkspaceFingerprint = fingerprint;
    workspaceUpdateQueue.push({ snapshot, fingerprint, lifecycle: workspaceLifecycle });
    void drainWorkspaceUpdates();
  }

  function clearCompileMarkers(model: monaco.editor.ITextModel) {
    const owner = compileMarkerOwners.get(model);
    if (!owner) {
      return;
    }
    monaco.editor.setModelMarkers(model, owner, []);
    compileMarkerOwners.delete(model);
  }

  function languageForModel(model: monaco.editor.ITextModel): "glsl" | "slang" {
    return model.getLanguageId() === "slang" ? "slang" : "glsl";
  }

  function pathForModel(model: monaco.editor.ITextModel): string {
    const uri = model.uri.toString();
    try {
      const parsed = new URL(uri);
      return parsed.protocol === "file:" ? decodeURIComponent(parsed.pathname) : uri;
    } catch {
      return uri;
    }
  }

  function handleEditorModelChange() {
    if (!editor || settingEditorModel) {
      return;
    }
    const navigatedModel = editor.getModel();
    if (!navigatedModel || navigatedModel === activeModel) {
      return;
    }
    const previousModel = activeModel;
    const language = languageForModel(navigatedModel);
    const nextModel = acquireEditorModel(
      monaco,
      navigatedModel.uri.toString(),
      navigatedModel.getValue(),
      language,
    );
    activeModel = nextModel;
    activeModelUri = nextModel.uri.toString();
    activeModelPath = pathForModel(nextModel);
    activeModelLanguage = language;
    lastSentCode = null;
    if (previousModel) {
      clearCompileMarkers(previousModel);
      releaseEditorModel(monaco, previousModel);
    }
    updateErrorMarkers(errors, nextModel, language);
    updateBlankLineDecorations();
  }

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
    const statusBar = statusBarEl;
    if (!statusBar) {
      return;
    }

    const setStatusText = (text: string) => {
      const modeNode = statusBar.firstElementChild;
      if (modeNode) {
        modeNode.textContent = text;
        return;
      }
      statusBar.textContent = text;
    };

    switch (mode) {
      case "insert":
        setStatusText("-- INSERT --");
        break;
      case "visual":
        setStatusText("-- VISUAL --");
        break;
      case "visualblock":
        setStatusText("-- VISUAL BLOCK --");
        break;
      case "replace":
        setStatusText("-- REPLACE --");
        break;
      default:
        setStatusText("-- NORMAL --");
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

  function runEditorAction(actionId: string, args?: unknown) {
    editor?.getAction(actionId)?.run(args);
  }

  function stopKeyEvent(event: OverlayKeyEvent) {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.browserEvent?.preventDefault?.();
    event.browserEvent?.stopPropagation?.();
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
        runEditorAction('editor.action.marker.next');
      });
      vim.defineEx('lprev', 'lp', () => {
        runEditorAction('editor.action.marker.prev');
      });

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
    setTimeout(() => {
      if (vimModeInstance) {
        syncVimStatus(vimCurrentMode);
      }
    }, 0);
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
    if (shaderLanguage === "slang") {
      slangAdapter = setupMonacoSlang(monaco, getBrowserSlangLanguageClient());
      queueCurrentSlangWorkspace();
    }

    activeModel = acquireEditorModel(monaco, shaderPath, shaderCode, shaderLanguage);
    activeModelUri = activeModel.uri.toString();
    activeModelPath = shaderPath;
    activeModelLanguage = shaderLanguage;

    const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions & { editContext?: boolean } = {
      model: activeModel,
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
    modelChangeDisposable = editor.onDidChangeModel?.(handleEditorModelChange) ?? null;

    if (activeModelUri && savedViewStates.has(activeModelUri)) {
      editor.restoreViewState(savedViewStates.get(activeModelUri) ?? null);
    }

    editor.onKeyDown?.((event: OverlayKeyEvent) => {
      const browserKey = event.browserEvent?.key;
      const metaKey = !!event.browserEvent?.metaKey;
      const ctrlKey = !!event.browserEvent?.ctrlKey;

      if ((metaKey || ctrlKey) && browserKey?.toLowerCase() === "s") {
        stopKeyEvent(event);
        handleOverlaySave();
        return;
      }

      if (
        browserKey
        && ["i", "a", "I", "A", "o", "O"].includes(browserKey)
        && vimCurrentMode === "normal"
        && vimModeInstance?.state?.vim
        && !vimModeInstance.state.vim.inputState?.operator
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
      const path = activeModelPath;
      if (code === undefined || !path) {
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
        if (transport && path) {
          lastSentCode = code;
          transport.postMessage({
            type: "updateShaderSource",
            payload: {
              code,
              path,
            },
          });
        }
      }, PERSIST_DELAY_MS);
    });

    lastShaderPath = shaderPath;
    lastShaderLanguage = shaderLanguage;

    if (vimMode) {
      enableVim();
    }

    cursorChangeDisposable = editor.onDidChangeCursorPosition(() => {
      const position = editor?.getPosition();
      const model = editor?.getModel();
      if (!position || !model) {
        return;
      }
      const line = position.lineNumber - 1;
      const content = model.getLineContent(position.lineNumber);
      const buffer = activeBufferName;
      if (cursorChangeTimer) {
        clearTimeout(cursorChangeTimer);
      }
      cursorChangeTimer = setTimeout(() => onCursorChange(line, content, buffer), 150);
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
    if (cursorChangeTimer) {
      clearTimeout(cursorChangeTimer);
      cursorChangeTimer = null;
    }
    if (cursorChangeDisposable) {
      cursorChangeDisposable.dispose();
      cursorChangeDisposable = null;
    }
    if (modelChangeDisposable) {
      modelChangeDisposable.dispose();
      modelChangeDisposable = null;
    }
    disableVim();
    if (containerEl) {
      containerEl.removeEventListener("mousedown", handleContainerMouseDown, true);
    }
    if (editor) {
      if (activeModelUri) {
        savedViewStates.set(activeModelUri, editor.saveViewState());
      }
      editor.dispose();
      editor = null;
    }
    for (const model of structuredCompileModels) {
      monaco.editor.setModelMarkers(model, SLANG_COMPILE_MARKER_OWNER, []);
    }
    structuredCompileModels.clear();
    if (activeModel) {
      clearCompileMarkers(activeModel);
      releaseEditorModel(monaco, activeModel);
      activeModel = null;
      activeModelUri = "";
      activeModelPath = "";
    }
    editorReady = false;
    workspaceLifecycle += 1;
    workspaceUpdateQueue.length = 0;
    slangAdapter = null;
    lastQueuedWorkspaceFingerprint = "";
    lastWorkspaceError = "";
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
    // Read reactive deps (vimMode, editorReady) unconditionally so the effect
    // re-runs on toggle. `editor` is a plain let and can't be a dependency, so
    // gate on editorReady ($state) which tracks the lazily-created editor.
    const enabled = vimMode;
    if (!editorReady || !editor) {
      return;
    }
    if (enabled && !vimModeInstance) {
      enableVim();
    } else if (!enabled && vimModeInstance) {
      disableVim();
    }
  });

  $effect(() => {
    const enabled = vimMode;
    const statusBar = statusBarEl;
    if (!editorReady || !editor) {
      return;
    }
    if (enabled && vimModeInstance && statusBar && !vimStatusAttached) {
      vimModeInstance.dispose();
      vimModeInstance = null;
      enableVim();
    }
  });

  $effect(() => {
    const modelUri = activeModelUri;
    const language = activeModelLanguage;
    const currentErrors = errors;
    const currentDiagnostics = diagnostics;
    if (editorReady && modelUri && activeModel) {
      const structuredCount = updateStructuredDiagnosticMarkers(currentDiagnostics);
      if (structuredCount === 0) {
        updateErrorMarkers(currentErrors, activeModel, language);
      }
    }
  });

  function updateStructuredDiagnosticMarkers(items: SlangDiagnostic[]): number {
    for (const model of structuredCompileModels) {
      monaco.editor.setModelMarkers(model, SLANG_COMPILE_MARKER_OWNER, []);
    }
    structuredCompileModels.clear();
    if (shaderLanguage !== "slang") {
      return 0;
    }
    const grouped = new Map<monaco.editor.ITextModel, monaco.editor.IMarkerData[]>();
    const compileItems = items.filter((item) => item.source !== "slang-language");
    for (const diagnostic of compileItems) {
      const model = monaco.editor.getModel(canonicalEditorUri(monaco, diagnostic.uri));
      if (!model) {
        continue;
      }
      const markers = grouped.get(model) ?? [];
      markers.push({
        severity: diagnostic.severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : diagnostic.severity === "information" || diagnostic.severity === "hint"
          ? monaco.MarkerSeverity.Info
          : monaco.MarkerSeverity.Error,
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: Math.max(diagnostic.range.start.character + 2, diagnostic.range.end.character + 1),
        message: diagnostic.passName ? `${diagnostic.passName}: ${diagnostic.message}` : diagnostic.message,
        code: diagnostic.code,
      });
      grouped.set(model, markers);
    }
    for (const [model, markers] of grouped) {
      monaco.editor.setModelMarkers(model, SLANG_COMPILE_MARKER_OWNER, markers);
      structuredCompileModels.add(model);
    }
    return [...grouped.values()].reduce((count, markers) => count + markers.length, 0);
  }

  function updateErrorMarkers(
    errs: string[],
    model: monaco.editor.ITextModel,
    language: "glsl" | "slang" = activeModelLanguage,
  ) {

    const activeBufferKey = activeBufferName.trim().toLowerCase();
    const markers: monaco.editor.IMarkerData[] = [];

    for (const err of errs) {
      const match = err.match(/^(?:(.+?):\s*)?ERROR:\s*\d+:(\d+):\s*(.+)$/s);
      if (match) {
        const [, passName, lineNumber, diagnostic] = match;
        if (passName && passName.trim().toLowerCase() !== activeBufferKey) {
          continue;
        }

        const line = parseInt(lineNumber, 10);
        const message = diagnostic.trim();
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

    const owner = language === 'slang' ? SLANG_COMPILE_MARKER_OWNER : 'glsl';
    const previousOwner = compileMarkerOwners.get(model);
    if (previousOwner && previousOwner !== owner) {
      monaco.editor.setModelMarkers(model, previousOwner, []);
    }
    monaco.editor.setModelMarkers(model, owner, markers);
    compileMarkerOwners.set(model, owner);
  }

  $effect(() => {
    if (!editorReady) {
      return;
    }
    queueCurrentSlangWorkspace();
  });

  $effect(() => {
    if (editor && shaderCode !== undefined) {
      const fileChanged = shaderPath !== lastShaderPath || shaderLanguage !== lastShaderLanguage;
      const propModelUri = canonicalEditorUri(monaco, shaderPath).toString();
      const navigationActive = !fileChanged && activeModelUri !== propModelUri;
      if (navigationActive) {
        return;
      }
      const currentValue = editor.getValue();

      if (fileChanged) {
        if (activeModelUri) {
          savedViewStates.set(activeModelUri, editor.saveViewState());
        }
        const previousModel = activeModel;
        const nextModel = acquireEditorModel(monaco, shaderPath, shaderCode, shaderLanguage);
        activeModel = nextModel;
        activeModelUri = nextModel.uri.toString();
        activeModelPath = shaderPath;
        activeModelLanguage = shaderLanguage;
        settingEditorModel = true;
        try {
          editor.setModel(nextModel);
        } finally {
          settingEditorModel = false;
        }
        editor.setValue(shaderCode);
        if (previousModel) {
          clearCompileMarkers(previousModel);
          releaseEditorModel(monaco, previousModel);
        }
        const nextViewState = activeModelUri ? savedViewStates.get(activeModelUri) : null;
        if (nextViewState) {
          editor.restoreViewState(nextViewState);
        } else {
          editor.setPosition({ lineNumber: 1, column: 1 });
          editor.setScrollTop(0);
        }
        lastSentCode = null;
        lastShaderPath = shaderPath;
        lastShaderLanguage = shaderLanguage;
        updateErrorMarkers(errors, nextModel, shaderLanguage);
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
