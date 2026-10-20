import { Compartment, EditorState, Transaction, Annotation, type Extension } from '@codemirror/state';
import { EditorView, gutters, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, tooltips } from '@codemirror/view';
import { defaultKeymap, indentWithTab, indentMore, indentLess, selectAll } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, foldGutter, foldKeymap } from '@codemirror/language';
import { autocompletion, closeCompletion, closeBrackets, closeBracketsKeymap, completionKeymap, acceptCompletion, startCompletion, type CompletionSource } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { forceLinting, lintGutter, lintKeymap, linter, nextDiagnostic, type Diagnostic } from '@codemirror/lint';
import { CodeMirror, vim } from '@replit/codemirror-vim';
import { editorLanguage } from './languages';
import { editorTheme } from './theme';
import { SharedDocument, sharedDocumentChange } from './sharedDocuments';
import { visibleEditorViewport } from './viewport';

// Vim calls its CM5 command adapter directly instead of CodeMirror keymaps.
// Route only our views through the same shared history as toolbar/keyboard undo.
const vimHistories = new WeakMap<EditorView, (direction: 'undo' | 'redo') => boolean>();
const defaultVimUndo = CodeMirror.commands.undo;
const defaultVimRedo = CodeMirror.commands.redo;
CodeMirror.commands.undo = cm => {
  const run = vimHistories.get(cm.cm6);
  if (run) {
    run('undo');
  } else {
    defaultVimUndo(cm);
  }
};
CodeMirror.commands.redo = cm => {
  const run = vimHistories.get(cm.cm6);
  if (run) {
    run('redo');
  } else {
    defaultVimRedo(cm);
  }
};

export interface EditorPreferences {
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: 'on' | 'off';
  lineNumbers: 'on' | 'off';
  autoSuggestions?: boolean;
}
export interface CodeMirrorEditorOptions {
  path: string;
  code: string;
  preferences?: EditorPreferences;
  dark?: boolean;
  overlay?: boolean;
  vim?: boolean;
  tooltipParent?: HTMLElement;
  onChange?: (code: string, path: string) => void;
  onSelection?: (from: number, to: number) => void;
  onSave?: () => void;
  onCompile?: () => void;
  onToggleWrap?: () => void;
}
export interface EditorDiagnostic {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
}
export const defaultPreferences: EditorPreferences = { fontSize: 14, tabSize: 4, insertSpaces: true, wordWrap: 'off', lineNumbers: 'on', autoSuggestions: true };
const hostChange = Annotation.define<boolean>();

/** Owns CodeMirror configuration, per-file undo history, and view lifecycle. */
export class ShaderCodeMirrorEditor {
  readonly view: EditorView;
  private path: string;
  private readonly documents = new Map<string, { state: EditorState; scrollTop: number; scrollLeft: number }>();
  private readonly configuration = new Compartment();
  private readonly language = new Compartment();
  private readonly services = new Compartment();
  private readonly completion = new Compartment();
  private completionSource?: CompletionSource;
  private readonly hostDiagnostics = new Compartment();
  private diagnostics: readonly Diagnostic[] = [];
  private preferences: EditorPreferences;
  private dark: boolean;
  private overlay: boolean;
  private vim: boolean;
  private destroyed = false;
  private readonly anonymousKey = Symbol();
  private readonly sharedDocuments = new Map<string, SharedDocument>();
  private readonly hostSnapshots = new Map<string, string>();
  private sharedDocument: SharedDocument;
  private readonly undoCommand = () => this.sharedDocument.runHistory(this.view, 'undo');
  private readonly redoCommand = () => this.sharedDocument.runHistory(this.view, 'redo');

  constructor(parent: HTMLElement, private readonly options: CodeMirrorEditorOptions) {
    this.path = options.path;
    this.preferences = options.preferences ?? defaultPreferences;
    this.dark = options.dark ?? false;
    this.overlay = options.overlay ?? false;
    this.vim = options.vim ?? false;
    this.sharedDocument = this.acquireDocument(options.path, options.code);
    this.view = new EditorView({ parent, state: this.createState(this.sharedDocument.text) });
    this.sharedDocument.attach(this.view);
    vimHistories.set(this.view, direction => this.sharedDocument.runHistory(this.view, direction));
    this.view.contentDOM.setAttribute('aria-label', 'Shader code');
  }

  private acquireDocument(path: string, code: string): SharedDocument {
    let document = this.sharedDocuments.get(path);
    if (!document) {
      document = SharedDocument.acquire(path || this.anonymousKey, code);
      this.sharedDocuments.set(path, document);
      this.hostSnapshots.set(path, code);
    }
    return document;
  }

  private createState(code: string): EditorState {
    return EditorState.create({ doc: code, extensions: [
      visibleEditorViewport,
      highlightSpecialChars(), drawSelection(), dropCursor(), rectangularSelection(), crosshairCursor(),
      highlightActiveLine(), highlightActiveLineGutter(), bracketMatching(), closeBrackets(), indentOnInput(),
      highlightSelectionMatches(), search({ top: true }), gutters({ fixed: false }), lintGutter(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.contentAttributes.of({ autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Shader code' }),
      tooltips({ position: 'fixed', ...(this.options.tooltipParent ? { parent: this.options.tooltipParent } : {}) }),
      keymap.of([
        { key: 'Mod-z', run: this.undoCommand },
        { key: 'Mod-Shift-z', run: this.redoCommand },
        { key: 'Ctrl-z', run: this.undoCommand },
        { key: 'Ctrl-Shift-z', run: this.redoCommand },
        { key: 'Ctrl-y', run: this.redoCommand },
        { key: 'Ctrl-a', run: selectAll }, { key: 'Meta-a', run: selectAll },
        { key: 'Mod-s', run: () => {
          this.options.onSave?.();
          return true;
        } },
        { key: 'Mod-Enter', run: () => {
          this.options.onCompile?.();
          return true;
        } },
        { key: 'Alt-z', run: () => {
          this.options.onToggleWrap?.();
          return true;
        } },
        { key: 'F8', run: nextDiagnostic },
        { key: 'Tab', run: acceptCompletion }, indentWithTab,
        ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap,
      ]),
      this.language.of(editorLanguage(this.path)),
      this.configuration.of(this.configurationExtensions()),
      this.services.of([]),
      this.completion.of(this.completionExtension()),
      this.hostDiagnostics.of(linter(() => this.diagnostics)),
      EditorView.updateListener.of(update => {
        const replica = update.transactions.some(transaction => transaction.annotation(sharedDocumentChange) === 'replica');
        if (update.docChanged) {
          for (const transaction of update.transactions) {
            if (transaction.docChanged && !transaction.annotation(sharedDocumentChange)) {
              this.sharedDocument.apply(transaction, this.view);
            }
          }
          if (!replica && !update.transactions.some(transaction => transaction.annotation(hostChange))) {
            this.options.onChange?.(update.state.doc.toString(), this.path);
          }
        }
        if (!replica && (update.selectionSet || update.docChanged)) {
          const { from, to } = update.state.selection.main;
          this.options.onSelection?.(from, to);
        }
      }),
    ] });
  }

  private completionExtension(): Extension {
    return autocompletion({
      activateOnTyping: this.preferences.autoSuggestions ?? true,
      ...(this.completionSource ? { override: [this.completionSource] } : {}),
    });
  }

  private configurationExtensions(): Extension[] {
    const { fontSize, tabSize, insertSpaces, wordWrap } = this.preferences;
    return [
      EditorState.tabSize.of(tabSize), indentUnit.of(insertSpaces ? ' '.repeat(tabSize) : '\t'),
      this.preferences.lineNumbers === 'on' ? [lineNumbers(), foldGutter()] : [],
      wordWrap === 'on' ? EditorView.lineWrapping : [],
      this.vim ? vim() : [], editorTheme(this.dark, this.overlay, fontSize),
    ];
  }

  configure(preferences: EditorPreferences, dark = this.dark, vimEnabled = this.vim, overlay = this.overlay): void {
    this.preferences = preferences;
    this.dark = dark;
    this.vim = vimEnabled;
    this.overlay = overlay;
    this.view.dispatch({ effects: [
      this.configuration.reconfigure(this.configurationExtensions()),
      this.completion.reconfigure(this.completionExtension()),
    ] });
    if (preferences.autoSuggestions === false) {
      closeCompletion(this.view);
    }
  }

  setServiceExtensions(extensions: Extension[], completionSource?: CompletionSource): void {
    this.completionSource = completionSource;
    closeCompletion(this.view);
    this.view.dispatch({ effects: [
      this.services.reconfigure(extensions),
      this.completion.reconfigure(this.completionExtension()),
    ] });
  }

  /** Applies compiler diagnostics while leaving language-service lint sources active. */
  setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
    this.diagnostics = diagnostics.map(({ from, to, message, severity }) => ({ from, to, message, severity }));
    this.view.dispatch({ effects: this.hostDiagnostics.reconfigure(linter(() => this.diagnostics)) });
    forceLinting(this.view);
  }

  get hasDocumentFocus(): boolean {
    return this.sharedDocument.hasFocus;
  }

  setDocument(path: string, code: string): void {
    if (path !== this.path) {
      this.documents.set(this.path, { state: this.view.state, scrollTop: this.view.scrollDOM.scrollTop, scrollLeft: this.view.scrollDOM.scrollLeft });
      this.sharedDocument.detach(this.view);
      this.path = path;
      this.sharedDocument = this.acquireDocument(path, code);
      this.completionSource = undefined;
      const saved = this.documents.get(path);
      let state = saved?.state ?? this.createState(this.sharedDocument.text);
      if (state.doc.toString() !== this.sharedDocument.text) {
        const code = this.sharedDocument.text;
        const { anchor, head } = state.selection.main;
        state = state.update({ changes: { from: 0, to: state.doc.length, insert: code },
          selection: { anchor: Math.min(anchor, code.length), head: Math.min(head, code.length) },
          annotations: Transaction.addToHistory.of(false) }).state;
      }
      this.view.setState(state);
      this.sharedDocument.attach(this.view);
      // A saved file's environment/service instances belong to its old session.
      this.view.dispatch({ effects: [
        this.configuration.reconfigure(this.configurationExtensions()),
        this.services.reconfigure([]),
        this.completion.reconfigure(this.completionExtension()),
      ] });
      this.view.scrollDOM.scrollTop = saved?.scrollTop ?? 0;
      this.view.scrollDOM.scrollLeft = saved?.scrollLeft ?? 0;
    }
    const previousHostCode = this.hostSnapshots.get(path);
    this.hostSnapshots.set(path, code);
    this.sharedDocument.acknowledge(code);
    // An unchanged peer snapshot is not a new host edit. Preserve local edits
    // until their matching echo arrives, including while no view has focus.
    if (this.view.state.doc.toString() !== code && previousHostCode !== code && !this.sharedDocument.hasPendingChanges) {
      const selection = this.view.state.selection.main;
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: code },
        selection: { anchor: Math.min(selection.anchor, code.length), head: Math.min(selection.head, code.length) },
        annotations: [hostChange.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }

  command(command: 'undo' | 'redo' | 'indent' | 'outdent' | 'search' | 'complete'): boolean {
    const commands = { indent: indentMore, outdent: indentLess, search: openSearchPanel, complete: startCompletion };
    const result = command === 'undo' || command === 'redo'
      ? this.sharedDocument.runHistory(this.view, command) : commands[command](this.view);
    if (command !== 'search') {
      this.view.focus();
    }
    return result;
  }

  insert(text: string): void {
    this.view.dispatch(this.view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
    this.view.focus();
  }

  dispose(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.sharedDocument.detach(this.view);
      vimHistories.delete(this.view);
      this.view.destroy();
      this.documents.clear();
      for (const document of this.sharedDocuments.values()) {
        document.release();
      }
      this.sharedDocuments.clear();
      this.hostSnapshots.clear();
    }
  }
}
