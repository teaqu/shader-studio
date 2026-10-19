import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canRedo, canUndo, copySelection, cutSelection, hasSelectedText, openEditorMenu, pasteClipboard, redoEdit, selectAll,
  selectedText, TouchDragSelection, undoEdit,
  type TouchClipboard, type TouchEditor,
} from '../../lib/editor/touchSelection';

interface FakeRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

const range = (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): FakeRange => ({
  startLineNumber, startColumn, endLineNumber, endColumn,
});

function createEditor(lines: string[], selections: FakeRange[] | null = [range(1, 1, 1, 1)], options: { model?: boolean } = {}) {
  const node = document.createElement('div');
  document.body.append(node);
  const model = {
    getValueInRange: vi.fn((r: FakeRange) => {
      const out: string[] = [];
      for (let line = r.startLineNumber; line <= r.endLineNumber; line++) {
        const text = lines[line - 1];
        const start = line === r.startLineNumber ? r.startColumn - 1 : 0;
        const end = line === r.endLineNumber ? r.endColumn - 1 : text.length;
        out.push(text.slice(start, end));
      }
      return out.join('\n');
    }),
    getEOL: vi.fn(() => '\n'),
    getFullModelRange: vi.fn(() => range(1, 1, lines.length, lines[lines.length - 1].length + 1)),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
  };
  // Positions come from a simple grid: 10px per column, 20px per line.
  const positionAt = (x: number, y: number) => (y < 0 ? null : { lineNumber: Math.floor(y / 20) + 1, column: Math.floor(x / 10) + 1 });
  const editor = {
    getModel: vi.fn(() => (options.model === false ? null : model)),
    getSelections: vi.fn(() => selections),
    setSelection: vi.fn(),
    executeEdits: vi.fn(() => true),
    pushUndoStop: vi.fn(() => true),
    getTargetAtClientPoint: vi.fn((x: number, y: number) => {
      const position = positionAt(x, y);
      return position ? { position } : null;
    }),
    getDomNode: vi.fn(() => node),
    revealPosition: vi.fn(),
    onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    trigger: vi.fn(),
  };
  return { editor, model, node, typed: editor as unknown as TouchEditor };
}

function createClipboard(initial = '') {
  const board = {
    text: initial,
    readText: vi.fn<TouchClipboard['readText']>(async () => board.text),
    writeText: vi.fn<TouchClipboard['writeText']>(async (value: string) => {
      board.text = value;
    }),
  };
  return board;
}

function touch(node: Element, type: string, points: Array<{ x: number; y: number }>) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'touches', { value: points.map(({ x, y }) => ({ clientX: x, clientY: y })) });
  node.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('touch selection clipboard commands', () => {
  it('reads the selected text and joins several selections by line', () => {
    const { typed } = createEditor(['void main() {', '  gl_FragColor = vec4(1);', '}'], [range(1, 1, 1, 5), range(2, 3, 2, 15)]);
    expect(hasSelectedText(typed)).toBe(true);
    expect(selectedText(typed)).toBe('void\ngl_FragColor');
  });

  it('treats a collapsed cursor, no selections, or no model as nothing selected', () => {
    expect(hasSelectedText(createEditor(['abc']).typed)).toBe(false);
    expect(selectedText(createEditor(['abc']).typed)).toBe('');
    expect(hasSelectedText(createEditor(['abc'], null).typed)).toBe(false);
    expect(selectedText(createEditor(['abc'], [range(1, 1, 1, 3)], { model: false }).typed)).toBe('');
  });

  it('copies the selection to the clipboard without editing the code', async () => {
    const { editor, typed } = createEditor(['float x = 1.0;'], [range(1, 7, 1, 8)]);
    const clipboard = createClipboard();
    await expect(copySelection(typed, clipboard)).resolves.toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('x');
    expect(editor.executeEdits).not.toHaveBeenCalled();
  });

  it('does not touch the clipboard when nothing is selected', async () => {
    const clipboard = createClipboard('kept');
    await expect(copySelection(createEditor(['abc']).typed, clipboard)).resolves.toBe(false);
    await expect(cutSelection(createEditor(['abc']).typed, clipboard)).resolves.toBe(false);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(clipboard.text).toBe('kept');
  });

  it('cuts by copying first and then removing every selected range in one undo step', async () => {
    const { editor, typed } = createEditor(['abc def'], [range(1, 1, 1, 4), range(1, 5, 1, 8)]);
    const clipboard = createClipboard();
    await expect(cutSelection(typed, clipboard)).resolves.toBe(true);
    expect(clipboard.text).toBe('abc\ndef');
    expect(editor.executeEdits).toHaveBeenCalledWith('touch-cut', [
      { range: range(1, 1, 1, 4), text: '', forceMoveMarkers: true },
      { range: range(1, 5, 1, 8), text: '', forceMoveMarkers: true },
    ]);
    expect(editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(clipboard.writeText.mock.invocationCallOrder[0]).toBeLessThan(editor.executeEdits.mock.invocationCallOrder[0]);
  });

  it('leaves the code alone when the clipboard refuses a cut', async () => {
    const { editor, typed } = createEditor(['abc'], [range(1, 1, 1, 4)]);
    const clipboard = createClipboard();
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    await expect(cutSelection(typed, clipboard)).rejects.toThrow('denied');
    expect(editor.executeEdits).not.toHaveBeenCalled();
  });

  it('pastes over the selection or at the cursor', async () => {
    const { editor, typed } = createEditor(['abc'], [range(1, 2, 1, 3)]);
    await expect(pasteClipboard(typed, createClipboard('XY'))).resolves.toBe(true);
    expect(editor.executeEdits).toHaveBeenCalledWith('touch-paste', [{ range: range(1, 2, 1, 3), text: 'XY', forceMoveMarkers: true }]);
  });

  it('skips a paste when the clipboard is empty or there is no cursor', async () => {
    const empty = createEditor(['abc']);
    await expect(pasteClipboard(empty.typed, createClipboard(''))).resolves.toBe(false);
    expect(empty.editor.executeEdits).not.toHaveBeenCalled();
    const noCursor = createEditor(['abc'], null);
    await expect(pasteClipboard(noCursor.typed, createClipboard('text'))).resolves.toBe(false);
    expect(noCursor.editor.executeEdits).not.toHaveBeenCalled();
  });

  it('undoes and redoes through the editor, like the keyboard shortcuts', () => {
    const { editor, typed } = createEditor(['abc']);
    undoEdit(typed);
    expect(editor.trigger).toHaveBeenLastCalledWith('touch', 'undo', null);
    redoEdit(typed);
    expect(editor.trigger).toHaveBeenLastCalledWith('touch', 'redo', null);
  });

  it('reports whether there is anything to undo or redo', () => {
    const { model, typed } = createEditor(['abc']);
    expect(canUndo(typed)).toBe(false);
    expect(canRedo(typed)).toBe(false);
    model.canUndo.mockReturnValue(true);
    model.canRedo.mockReturnValue(true);
    expect(canUndo(typed)).toBe(true);
    expect(canRedo(typed)).toBe(true);

    const noModel = createEditor(['abc'], [range(1, 1, 1, 1)], { model: false }).typed;
    expect(canUndo(noModel)).toBe(false);
    expect(canRedo(noModel)).toBe(false);
  });

  it('opens the editor menu through Monaco\'s own context menu action', () => {
    const { editor, typed } = createEditor(['abc']);
    openEditorMenu(typed);
    expect(editor.trigger).toHaveBeenCalledWith('touch', 'editor.action.showContextMenu', null);
  });

  it('selects the whole file, and does nothing without a model', () => {
    const { editor, typed } = createEditor(['ab', 'cde']);
    selectAll(typed);
    expect(editor.setSelection).toHaveBeenCalledWith(range(1, 1, 2, 4));
    const noModel = createEditor(['ab'], [range(1, 1, 1, 1)], { model: false });
    selectAll(noModel.typed);
    expect(noModel.editor.setSelection).not.toHaveBeenCalled();
  });
});

describe('TouchDragSelection', () => {
  it('lets touches through untouched while select mode is off', () => {
    const { editor, node, typed } = createEditor(['abc']);
    const drag = new TouchDragSelection(typed);
    const start = touch(node, 'touchstart', [{ x: 5, y: 5 }]);
    expect(start.defaultPrevented).toBe(false);
    expect(editor.setSelection).not.toHaveBeenCalled();
    expect(drag.isEnabled()).toBe(false);
    drag.dispose();
  });

  it('selects from where the finger lands to where it moves, instead of scrolling', () => {
    const { editor, node, typed } = createEditor(['abcdef', 'ghijkl']);
    const drag = new TouchDragSelection(typed);
    drag.setEnabled(true);
    const scroll = vi.fn();
    document.body.addEventListener('touchmove', scroll);

    expect(touch(node, 'touchstart', [{ x: 15, y: 5 }]).defaultPrevented).toBe(true);
    expect(editor.setSelection).toHaveBeenLastCalledWith({
      selectionStartLineNumber: 1, selectionStartColumn: 2, positionLineNumber: 1, positionColumn: 2,
    });
    expect(touch(node, 'touchmove', [{ x: 35, y: 25 }]).defaultPrevented).toBe(true);
    expect(editor.setSelection).toHaveBeenLastCalledWith({
      selectionStartLineNumber: 1, selectionStartColumn: 2, positionLineNumber: 2, positionColumn: 4,
    });
    expect(editor.revealPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 4 });
    // The drag never reaches Monaco's own touch scrolling.
    expect(scroll).not.toHaveBeenCalled();

    touch(node, 'touchend', []);
    editor.setSelection.mockClear();
    touch(node, 'touchmove', [{ x: 55, y: 25 }]);
    expect(editor.setSelection).not.toHaveBeenCalled();
    drag.dispose();
  });

  it('keeps an active drag even where no text is under the finger', () => {
    const { editor, node, typed } = createEditor(['abc']);
    const drag = new TouchDragSelection(typed);
    drag.setEnabled(true);
    touch(node, 'touchstart', [{ x: 5, y: 5 }]);
    editor.setSelection.mockClear();
    expect(touch(node, 'touchmove', [{ x: 5, y: -10 }]).defaultPrevented).toBe(true);
    expect(editor.setSelection).not.toHaveBeenCalled();
    drag.dispose();
  });

  it('ignores a touch down where there is no text', () => {
    const { editor, node, typed } = createEditor(['abc']);
    const drag = new TouchDragSelection(typed);
    drag.setEnabled(true);
    expect(touch(node, 'touchstart', [{ x: 5, y: -10 }]).defaultPrevented).toBe(false);
    expect(editor.setSelection).not.toHaveBeenCalled();
    drag.dispose();
  });

  it('leaves pinches and other multi-finger gestures to the browser', () => {
    const { editor, node, typed } = createEditor(['abc']);
    const drag = new TouchDragSelection(typed);
    drag.setEnabled(true);
    expect(touch(node, 'touchstart', [{ x: 5, y: 5 }, { x: 25, y: 5 }]).defaultPrevented).toBe(false);
    expect(editor.setSelection).not.toHaveBeenCalled();
    drag.dispose();
  });

  it('ends a drag when select mode turns off or the touch is cancelled', () => {
    const { editor, node, typed } = createEditor(['abcdef']);
    const drag = new TouchDragSelection(typed);
    drag.setEnabled(true);
    touch(node, 'touchstart', [{ x: 5, y: 5 }]);
    drag.setEnabled(false);
    editor.setSelection.mockClear();
    expect(touch(node, 'touchmove', [{ x: 25, y: 5 }]).defaultPrevented).toBe(false);
    expect(editor.setSelection).not.toHaveBeenCalled();

    drag.setEnabled(true);
    touch(node, 'touchstart', [{ x: 5, y: 5 }]);
    touch(node, 'touchcancel', []);
    editor.setSelection.mockClear();
    touch(node, 'touchmove', [{ x: 25, y: 5 }]);
    expect(editor.setSelection).not.toHaveBeenCalled();
    drag.dispose();
  });

  it('stops listening once disposed', () => {
    const { editor, node, typed } = createEditor(['abc']);
    const drag = new TouchDragSelection(typed);
    drag.setEnabled(true);
    drag.dispose();
    expect(touch(node, 'touchstart', [{ x: 5, y: 5 }]).defaultPrevented).toBe(false);
    expect(editor.setSelection).not.toHaveBeenCalled();
  });

  it('copes with an editor that has no DOM node yet', () => {
    const { editor, typed } = createEditor(['abc']);
    editor.getDomNode.mockReturnValue(null as unknown as HTMLDivElement);
    const drag = new TouchDragSelection(typed);
    drag.setEnabled(true);
    expect(drag.isEnabled()).toBe(true);
    expect(() => drag.dispose()).not.toThrow();
  });
});
