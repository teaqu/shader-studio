<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Transport } from "../transport/MessageTransport";
  import * as monaco from "monaco-editor";
  import { initVimMode, VimMode } from "monaco-vim";

  export let isVisible: boolean = false;
  export let shaderCode: string = "";
  export let shaderPath: string = "";
  export let transport: Transport;
  export let onCodeChange: (code: string) => void = () => {};
  export let vimMode: boolean = false;
  export let bufferNames: string[] = ["Image"];
  export let activeBufferName: string = "Image";
  export let onBufferSwitch: (bufferName: string) => void = () => {};

  let containerEl: HTMLDivElement;
  let statusBarEl: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let vimModeInstance: any = null;
  let editorReady = false;
  let recompileTimer: ReturnType<typeof setTimeout> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let languageRegistered = false;
  let lastSentCode: string | null = null;
  let lastShaderPath: string = "";

  // Provide a no-op worker stub. Monaco requires getWorker to return an
  // object with postMessage/onmessage — returning undefined crashes it.
  // We don't need language services (only Monarch syntax highlighting),
  // so this stub satisfies the interface without requiring CSP blob: access.
  if (typeof self !== 'undefined') {
    self.MonacoEnvironment = {
      getWorker() {
        return {
          postMessage() {},
          onmessage: null,
          terminate() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
          onerror: null,
          onmessageerror: null,
        } as any;
      },
    };
  }

  function ensureLanguageSetup() {
    if (languageRegistered) return;

    if (!monaco.languages.getLanguages().some((lang: any) => lang.id === 'glsl')) {
      monaco.languages.register({ id: 'glsl' });

      monaco.languages.setMonarchTokensProvider('glsl', {
        keywords: [
          'attribute', 'const', 'uniform', 'varying', 'layout',
          'centroid', 'flat', 'smooth', 'noperspective',
          'break', 'continue', 'do', 'for', 'while', 'switch', 'case', 'default',
          'if', 'else', 'in', 'out', 'inout',
          'float', 'int', 'uint', 'void', 'bool',
          'true', 'false',
          'invariant', 'precise', 'discard', 'return',
          'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4',
          'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
          'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
          'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4',
          'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow',
          'samplerCubeShadow', 'sampler2DArray', 'sampler2DArrayShadow',
          'isampler2D', 'isampler3D', 'isamplerCube', 'isampler2DArray',
          'usampler2D', 'usampler3D', 'usamplerCube', 'usampler2DArray',
          'struct',
          'lowp', 'mediump', 'highp', 'precision',
        ],
        builtins: [
          'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
          'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
          'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
          'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract',
          'mod', 'modf', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep',
          'isnan', 'isinf',
          'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward',
          'reflect', 'refract',
          'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
          'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual',
          'equal', 'notEqual', 'any', 'all', 'not',
          'texture', 'textureSize', 'textureLod', 'textureOffset',
          'texelFetch', 'texelFetchOffset', 'textureProj', 'textureGrad',
          'dFdx', 'dFdy', 'fwidth',
          'mainImage',
        ],
        shadertoyUniforms: [
          'iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iFrameRate',
          'iChannelTime', 'iChannelResolution', 'iMouse', 'iDate', 'iSampleRate',
          'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3',
        ],
        operators: [
          '=', '>', '<', '!', '~', '?', ':',
          '==', '<=', '>=', '!=', '&&', '||', '++', '--',
          '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>',
          '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=',
        ],
        symbols: /[=><!~?:&|+\-*\/\^%]+/,
        tokenizer: {
          root: [
            [/#\s*\w+/, 'keyword.preprocessor'],
            [/[a-zA-Z_]\w*/, {
              cases: {
                '@shadertoyUniforms': 'variable.predefined',
                '@builtins': 'support.function',
                '@keywords': 'keyword',
                '@default': 'identifier',
              }
            }],
            { include: '@whitespace' },
            [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
            [/0[xX][0-9a-fA-F]+[uU]?/, 'number.hex'],
            [/\d+[uU]?/, 'number'],
            [/[{}()\[\]]/, '@brackets'],
            [/@symbols/, {
              cases: {
                '@operators': 'operator',
                '@default': '',
              }
            }],
            [/[;,.]/, 'delimiter'],
          ],
          whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/\/\*/, 'comment', '@comment'],
            [/\/\/.*$/, 'comment'],
          ],
          comment: [
            [/[^\/*]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[\/*]/, 'comment'],
          ],
        },
      } as any);
    }

    monaco.editor.defineTheme('shader-studio-transparent', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'C586C0' },
        { token: 'keyword.preprocessor', foreground: '9B9B9B' },
        { token: 'support.function', foreground: 'DCDCAA' },
        { token: 'variable.predefined', foreground: '4FC1FF' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'number.float', foreground: 'B5CEA8' },
        { token: 'number.hex', foreground: 'B5CEA8' },
        { token: 'comment', foreground: '6A9955' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'delimiter', foreground: 'D4D4D4' },
        { token: 'identifier', foreground: '9CDCFE' },
      ],
      colors: {
        'editor.background': '#00000000',
        'editor.lineHighlightBackground': '#ffffff12',
        'editor.lineHighlightBorder': '#ffffff08',
        'editorGutter.background': '#00000000',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editorCursor.foreground': '#ffffff',
      },
    });

    languageRegistered = true;
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
      const vim = VimMode.Vim;
      if (!vim?.defineEx) return;

      vim.defineEx('bnext', 'bn', () => switchToNextBuffer());
      vim.defineEx('bprev', 'bp', () => switchToPrevBuffer());
      vim.defineEx('buffer', 'b', (_cm: any, params: any) => {
        const name = params?.args?.[0];
        if (name) switchToNamedBuffer(name);
      });

      vimCommandsRegistered = true;
    } catch (e) {
      // monaco-vim API may differ across versions
      console.warn('Failed to register vim buffer commands:', e);
    }
  }

  function enableVim() {
    if (!editor || !statusBarEl || vimModeInstance) return;
    registerVimCommands();
    vimModeInstance = initVimMode(editor, statusBarEl);
  }

  function disableVim() {
    if (vimModeInstance) {
      vimModeInstance.dispose();
      vimModeInstance = null;
    }
  }

  function createEditor() {
    if (!containerEl || editor) return;

    ensureLanguageSetup();

    editor = monaco.editor.create(containerEl, {
      value: shaderCode,
      language: "glsl",
      theme: "shader-studio-transparent",
      minimap: { enabled: false },
      scrollbar: {
        vertical: "hidden",
        horizontal: "hidden",
      },
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      renderLineHighlight: "line",
      automaticLayout: true,
      fontSize: 14,
      lineHeight: 20,
      padding: { top: 8 },
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 0,
      lineNumbers: "on",
      lineNumbersMinChars: 4,
      scrollBeyondLastLine: false,
      contextmenu: false,
      fixedOverflowWidgets: true,
      cursorStyle: "line",
      cursorWidth: 2,
      cursorBlinking: "smooth",
    });

    editor.onDidChangeModelContent(() => {
      if (!editor) return;
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

  // React to vim mode toggle
  $: if (editor) {
    if (vimMode && !vimModeInstance) {
      enableVim();
    } else if (!vimMode && vimModeInstance) {
      disableVim();
    }
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
  <div class="editor-wrapper" class:ready={editorReady}>
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
    z-index: 500;
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
    height: 20px;
    font-family: monospace;
    font-size: 12px;
    color: #d4d4d4;
    background: rgba(10, 10, 10, 0.85);
    padding: 0 8px;
    line-height: 20px;
    flex-shrink: 0;
  }

  .vim-status-bar:empty {
    display: none;
  }

  /* Make ALL Monaco backgrounds transparent */
  .editor-overlay :global(.monaco-editor),
  .editor-overlay :global(.monaco-editor .overflow-guard),
  .editor-overlay :global(.monaco-editor-background),
  .editor-overlay :global(.monaco-editor .inputarea.ime-input) {
    background: transparent !important;
  }

  /* Force-hide Monaco's internal textarea */
  .editor-overlay :global(.monaco-editor textarea) {
    resize: none !important;
  }

  /* Semi-transparent background on the inline text content */
  .editor-overlay :global(.monaco-editor .view-lines .view-line > span) {
    background: rgba(10, 10, 10, 0.82);
    border-radius: 0 2px 2px 0;
    padding-right: 4px;
  }

  /* Line numbers with matching background */
  .editor-overlay :global(.monaco-editor .margin-view-overlays .line-numbers) {
    background: rgba(10, 10, 10, 0.82);
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
    background: rgba(38, 79, 120, 0.7) !important;
  }

  /* Hide scrollbars */
  .editor-overlay :global(.monaco-editor .monaco-scrollable-element > .scrollbar) {
    opacity: 0;
  }

  /* Active line number in gutter */
  .editor-overlay :global(.monaco-editor .active-line-number) {
    color: #c6c6c6 !important;
  }
</style>
