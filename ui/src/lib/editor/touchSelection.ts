import type * as monaco from 'monaco-editor/editor/editor.api.js';

/**
 * Touch editing for Monaco. Monaco draws its own text, so iOS has nothing to
 * attach native selection handles to and a drag scrolls instead of selecting.
 * These helpers give touch screens an explicit select mode and clipboard
 * commands that work on the editor's own selections.
 */
export type TouchEditor = Pick<
  monaco.editor.ICodeEditor,
  'getModel' | 'getSelections' | 'setSelection' | 'executeEdits' | 'pushUndoStop'
  | 'getTargetAtClientPoint' | 'getDomNode' | 'revealPosition' | 'onDidChangeCursorSelection' | 'trigger'
  | 'onDidChangeModelContent'
>;

export interface TouchClipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

type Range = monaco.IRange;
type Position = monaco.IPosition;

function isEmptyRange(range: Range): boolean {
  return range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
}

function nonEmptySelections(editor: TouchEditor): Range[] {
  return (editor.getSelections() ?? []).filter((selection) => !isEmptyRange(selection));
}

export function hasSelectedText(editor: TouchEditor): boolean {
  return nonEmptySelections(editor).length > 0;
}

/** The selected text, one selection per line as Monaco's own copy joins them. */
export function selectedText(editor: TouchEditor): string {
  const model = editor.getModel();
  if (!model) {
    return '';
  }
  return nonEmptySelections(editor).map((range) => model.getValueInRange(range)).join(model.getEOL());
}

export async function copySelection(editor: TouchEditor, clipboard: TouchClipboard): Promise<boolean> {
  const text = selectedText(editor);
  if (!text) {
    return false;
  }
  await clipboard.writeText(text);
  return true;
}

function replaceSelections(editor: TouchEditor, source: string, ranges: Range[], text: string): void {
  editor.pushUndoStop();
  editor.executeEdits(source, ranges.map((range) => ({ range, text, forceMoveMarkers: true })));
  editor.pushUndoStop();
}

export async function cutSelection(editor: TouchEditor, clipboard: TouchClipboard): Promise<boolean> {
  const ranges = nonEmptySelections(editor);
  if (!(await copySelection(editor, clipboard))) {
    return false;
  }
  replaceSelections(editor, 'touch-cut', ranges, '');
  return true;
}

export async function pasteClipboard(editor: TouchEditor, clipboard: TouchClipboard): Promise<boolean> {
  const text = await clipboard.readText();
  const ranges = editor.getSelections() ?? [];
  if (!text || ranges.length === 0) {
    return false;
  }
  replaceSelections(editor, 'touch-paste', ranges, text);
  return true;
}

export function selectAll(editor: TouchEditor): void {
  const model = editor.getModel();
  if (model) {
    editor.setSelection(model.getFullModelRange());
  }
}

/**
 * Opens the editor menu at the cursor. A long press only opens it when the
 * finger stays perfectly still for most of a second, which is hard to hit.
 */
export function openEditorMenu(editor: TouchEditor): void {
  editor.trigger('touch', 'editor.action.showContextMenu', null);
}

export function canUndo(editor: TouchEditor): boolean {
  return editor.getModel()?.canUndo() ?? false;
}

export function canRedo(editor: TouchEditor): boolean {
  return editor.getModel()?.canRedo() ?? false;
}

/** Runs through the editor, like Ctrl+Z, so the cursor follows the change. */
export function undoEdit(editor: TouchEditor): void {
  editor.trigger('touch', 'undo', null);
}

export function redoEdit(editor: TouchEditor): void {
  editor.trigger('touch', 'redo', null);
}

function selectionBetween(anchor: Position, active: Position): monaco.ISelection {
  return {
    selectionStartLineNumber: anchor.lineNumber, selectionStartColumn: anchor.column,
    positionLineNumber: active.lineNumber, positionColumn: active.column,
  };
}

/**
 * While enabled, one finger dragging over the editor selects text from where
 * it touched down instead of scrolling. Listeners run in the capture phase so
 * Monaco's own touch scrolling never sees the drag.
 */
export class TouchDragSelection {
  private enabled = false;
  private anchor: Position | null = null;
  private readonly node: HTMLElement | null;

  private readonly onStart = (event: TouchEvent): void => {
    const position = this.claim(event);
    if (position) {
      this.anchor = position;
      this.editor.setSelection(selectionBetween(position, position));
    }
  };

  private readonly onMove = (event: TouchEvent): void => {
    if (!this.anchor || !this.enabled) {
      return;
    }
    // Keep the drag ours even over the gutter or past the last line.
    event.preventDefault();
    event.stopPropagation();
    const position = this.claim(event);
    if (position) {
      this.editor.setSelection(selectionBetween(this.anchor, position));
      this.editor.revealPosition(position);
    }
  };

  private readonly onEnd = (): void => {
    this.anchor = null;
  };

  constructor(private readonly editor: TouchEditor) {
    this.node = editor.getDomNode();
    this.node?.addEventListener('touchstart', this.onStart, { capture: true, passive: false });
    this.node?.addEventListener('touchmove', this.onMove, { capture: true, passive: false });
    this.node?.addEventListener('touchend', this.onEnd, { capture: true });
    this.node?.addEventListener('touchcancel', this.onEnd, { capture: true });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.anchor = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.node?.removeEventListener('touchstart', this.onStart, { capture: true });
    this.node?.removeEventListener('touchmove', this.onMove, { capture: true });
    this.node?.removeEventListener('touchend', this.onEnd, { capture: true });
    this.node?.removeEventListener('touchcancel', this.onEnd, { capture: true });
    this.anchor = null;
  }

  /** Takes over a single-finger touch over text; pinches and multi-touch pass through. */
  private claim(event: TouchEvent): Position | null {
    if (!this.enabled || event.touches.length !== 1) {
      return null;
    }
    const touch = event.touches[0];
    const position = this.editor.getTargetAtClientPoint(touch.clientX, touch.clientY)?.position ?? null;
    if (!position) {
      return null;
    }
    event.preventDefault();
    event.stopPropagation();
    return position;
  }
}
