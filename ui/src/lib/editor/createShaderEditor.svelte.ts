import * as monaco from 'monaco-editor/editor/editor.api.js';
import { setupMonacoGlsl, setupMonacoJson, setupMonacoSlang, setupMonacoWgsl } from '@shader-studio/monaco';
import { getHostEditorPreferences, type HostEditorPreferences } from '../state/hostState.svelte';

export interface ShaderEditorFactoryOptions {
  shaderCode: string;
  shaderPath: string;
  language: string;
  theme: string;
  overflowWidgetsDomNode?: HTMLElement;
}

// The lean editor.api entrypoint contains the language registration surface
// used by these helpers, while their package type is the broader Monaco root.
type MonacoSetupApi = Parameters<typeof setupMonacoGlsl>[0];

function registerShaderLanguages(api: MonacoSetupApi): void {
  setupMonacoGlsl(api);
  setupMonacoSlang(api);
  setupMonacoWgsl(api);
  setupMonacoJson(api);
}

function applyModelPreferences(model: monaco.editor.ITextModel | null, preferences: HostEditorPreferences): void {
  model?.updateOptions({ tabSize: preferences.tabSize, insertSpaces: preferences.insertSpaces });
}

function lineHeightFor(fontSize: number): number {
  // Preserve the established 14px/20px editor rhythm while allowing larger
  // user-selected fonts enough vertical room for glyph ascenders/descenders.
  return Math.max(20, Math.ceil(fontSize * 1.4));
}

export class HostEditorPreferencesController {
  private readonly cleanup: () => void;

  constructor(private readonly editor: monaco.editor.IStandaloneCodeEditor) {
    const getter = getHostEditorPreferences();
    this.cleanup = getter
      ? $effect.root(() => {
        $effect(() => {
          const preferences = getter();
          this.apply(preferences);
        });
      })
      : () => {};
  }

  applyToModel(model: monaco.editor.ITextModel | null = this.editor.getModel()): void {
    const getter = getHostEditorPreferences();
    if (getter) {
      applyModelPreferences(model, getter());
    }
  }

  dispose(): void {
    this.cleanup();
  }

  private apply(preferences: HostEditorPreferences): void {
    this.editor.updateOptions({
      fontSize: preferences.fontSize,
      lineHeight: lineHeightFor(preferences.fontSize),
      wordWrap: preferences.wordWrap,
      minimap: { enabled: preferences.minimap },
      lineNumbers: preferences.lineNumbers,
    });
    applyModelPreferences(this.editor.getModel(), preferences);
  }
}

export function createShaderEditor(
  container: HTMLElement,
  options: ShaderEditorFactoryOptions,
): { editor: monaco.editor.IStandaloneCodeEditor; popupContainer: HTMLDivElement | null; preferences: HostEditorPreferencesController } {
  registerShaderLanguages(monaco as unknown as MonacoSetupApi);

  let popupContainer: HTMLDivElement | null = null;
  if (options.overflowWidgetsDomNode) {
    popupContainer = document.createElement('div');
    popupContainer.className = 'monaco-editor shader-editor-popups';
    options.overflowWidgetsDomNode.appendChild(popupContainer);
  }
  const model = options.shaderPath
    ? monaco.editor.getModel(monaco.Uri.file(options.shaderPath))
      ?? monaco.editor.createModel(options.shaderCode, options.language, monaco.Uri.file(options.shaderPath))
    : monaco.editor.createModel(options.shaderCode, options.language);
  const editor = monaco.editor.create(container, {
    model, theme: options.theme, minimap: { enabled: false },
    scrollbar: { vertical: 'hidden', horizontal: 'hidden', useShadows: false },
    overviewRulerLanes: 0, overviewRulerBorder: false, hideCursorInOverviewRuler: true,
    renderLineHighlight: 'line', selectionHighlight: false, occurrencesHighlight: 'singleFile',
    automaticLayout: true, fontSize: 14, lineHeight: 20, padding: { top: 0 }, stickyScroll: { enabled: false },
    folding: false, glyphMargin: false, lineDecorationsWidth: 4, lineNumbers: 'on', lineNumbersMinChars: 4,
    scrollBeyondLastLine: false, contextmenu: false, fixedOverflowWidgets: true,
    ...(popupContainer ? { overflowWidgetsDomNode: popupContainer } : {}),
    readOnly: false, domReadOnly: false, editContext: false, cursorStyle: 'line', cursorWidth: 2,
    cursorBlinking: 'smooth',
    guides: { indentation: false, bracketPairs: false, highlightActiveIndentation: false, bracketPairsHorizontal: false },
  } as monaco.editor.IStandaloneEditorConstructionOptions);
  const preferences = new HostEditorPreferencesController(editor);
  return { editor, popupContainer, preferences };
}
