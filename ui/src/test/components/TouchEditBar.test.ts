import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import TouchEditBar from '../../lib/components/TouchEditBar.svelte';
import type { TouchClipboard, TouchEditor } from '../../lib/editor/touchSelection';

interface FakeRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

function createEditor(initial: FakeRange[]) {
  let selections = initial;
  let selectionListener: (() => void) | null = null;
  let contentListener: (() => void) | null = null;
  const subscription = { dispose: vi.fn() };
  const contentSubscription = { dispose: vi.fn() };
  const history = { undo: false, redo: false };
  const node = document.createElement('div');
  const model = {
    getValueInRange: () => 'selected',
    getEOL: () => '\n',
    getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 }),
    canUndo: () => history.undo,
    canRedo: () => history.redo,
  };
  const editor = {
    getModel: vi.fn(() => model),
    onDidChangeModelContent: vi.fn((listener: () => void) => {
      contentListener = listener;
      return contentSubscription;
    }),
    getSelections: vi.fn(() => selections),
    setSelection: vi.fn(),
    executeEdits: vi.fn(() => true),
    pushUndoStop: vi.fn(() => true),
    getTargetAtClientPoint: vi.fn(() => ({ position: { lineNumber: 1, column: 1 } })),
    getDomNode: vi.fn(() => node),
    revealPosition: vi.fn(),
    onDidChangeCursorSelection: vi.fn((listener: () => void) => {
      selectionListener = listener;
      return subscription;
    }),
    trigger: vi.fn(),
  };
  return {
    editor,
    node,
    subscription,
    contentSubscription,
    typed: editor as unknown as TouchEditor,
    select(next: FakeRange[]) {
      selections = next;
      selectionListener?.();
    },
    edit(next: { undo: boolean; redo: boolean }) {
      Object.assign(history, next);
      contentListener?.();
    },
  };
}

const collapsed: FakeRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
const word: FakeRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 };

function createClipboard(text = ''): TouchClipboard {
  return { readText: vi.fn(async () => text), writeText: vi.fn(async () => {}) };
}

function touchStart(node: Element) {
  const event = new Event('touchstart', { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'touches', { value: [{ clientX: 1, clientY: 1 }] });
  node.dispatchEvent(event);
  return event;
}

describe('TouchEditBar', () => {
  it('offers Select, All, Copy, Cut, Paste and Menu, with Copy and Cut waiting for a selection', async () => {
    const fake = createEditor([collapsed]);
    render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard() } });

    const bar = screen.getByRole('toolbar', { name: 'Touch editing' });
    expect([...bar.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['↶', '↷', 'Select', 'All', 'Copy', 'Cut', 'Paste', 'Menu']);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cut' })).toBeDisabled();

    fake.select([word]);
    await tick();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cut' })).toBeEnabled();
  });

  it('enables Undo and Redo only when the edit history has something to step through', async () => {
    const fake = createEditor([collapsed]);
    render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard() } });
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    fake.edit({ undo: true, redo: false });
    await tick();
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();

    await fireEvent.click(undo);
    expect(fake.editor.trigger).toHaveBeenLastCalledWith('touch', 'undo', null);
    fake.edit({ undo: false, redo: true });
    await tick();
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();

    await fireEvent.click(redo);
    expect(fake.editor.trigger).toHaveBeenLastCalledWith('touch', 'redo', null);
  });

  it('turns drag-to-select on and off with the Select button', async () => {
    const fake = createEditor([collapsed]);
    render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard() } });
    const select = screen.getByRole('button', { name: 'Select' });

    expect(select).toHaveAttribute('aria-pressed', 'false');
    expect(touchStart(fake.node).defaultPrevented).toBe(false);

    await fireEvent.click(select);
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(touchStart(fake.node).defaultPrevented).toBe(true);
    expect(fake.editor.setSelection).toHaveBeenCalled();

    await fireEvent.click(select);
    expect(select).toHaveAttribute('aria-pressed', 'false');
    expect(touchStart(fake.node).defaultPrevented).toBe(false);
  });

  it('selects the whole file with All', async () => {
    const fake = createEditor([collapsed]);
    render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard() } });
    await fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(fake.editor.setSelection).toHaveBeenCalledWith({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 });
  });

  it('opens the editor menu without a long press, clearing any old message', async () => {
    const fake = createEditor([collapsed]);
    const clipboard = createClipboard();
    clipboard.readText = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    render(TouchEditBar, { props: { editor: fake.typed, clipboard } });
    await fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    await screen.findByRole('status');

    await fireEvent.click(screen.getByRole('button', { name: 'More editor actions' }));
    expect(fake.editor.trigger).toHaveBeenCalledWith('touch', 'editor.action.showContextMenu', null);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('copies the selection and leaves select mode', async () => {
    const fake = createEditor([word]);
    const clipboard = createClipboard();
    render(TouchEditBar, { props: { editor: fake.typed, clipboard } });
    await fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('selected'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false'));
    expect(fake.editor.executeEdits).not.toHaveBeenCalled();
  });

  it('cuts the selection', async () => {
    const fake = createEditor([word]);
    const clipboard = createClipboard();
    render(TouchEditBar, { props: { editor: fake.typed, clipboard } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cut' }));
    await vi.waitFor(() => expect(fake.editor.executeEdits).toHaveBeenCalledWith('touch-cut', [{ range: word, text: '', forceMoveMarkers: true }]));
    expect(clipboard.writeText).toHaveBeenCalledWith('selected');
  });

  it('pastes the clipboard at the cursor', async () => {
    const fake = createEditor([collapsed]);
    render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard('pasted') } });
    await fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    await vi.waitFor(() => expect(fake.editor.executeEdits).toHaveBeenCalledWith('touch-paste', [{ range: collapsed, text: 'pasted', forceMoveMarkers: true }]));
  });

  it('stays in select mode when there was nothing to paste', async () => {
    const fake = createEditor([collapsed]);
    const clipboard = createClipboard('');
    render(TouchEditBar, { props: { editor: fake.typed, clipboard } });
    await fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    await vi.waitFor(() => expect(clipboard.readText).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
    expect(fake.editor.executeEdits).not.toHaveBeenCalled();
  });

  it('explains a refused paste, and clears the message on the next action', async () => {
    const fake = createEditor([collapsed]);
    const clipboard = createClipboard();
    clipboard.readText = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    render(TouchEditBar, { props: { editor: fake.typed, clipboard } });

    await fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not read the clipboard. Allow pasting and try again.');

    await fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explains a refused copy', async () => {
    const fake = createEditor([word]);
    const clipboard = createClipboard();
    clipboard.writeText = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    render(TouchEditBar, { props: { editor: fake.typed, clipboard } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not copy to the clipboard.');
  });

  it('says so when the browser has no clipboard', async () => {
    const fake = createEditor([word]);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    try {
      render(TouchEditBar, { props: { editor: fake.typed } });
      await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Clipboard is not available in this browser.');
    } finally {
      if (original) {
        Object.defineProperty(navigator, 'clipboard', original);
      } else {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
    }
  });

  it('keeps focus in the editor when a button is pressed', async () => {
    const fake = createEditor([word]);
    render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard() } });
    fake.edit({ undo: true, redo: true });
    await tick();
    for (const name of ['Undo', 'Redo', 'Select', 'All', 'Copy', 'Cut', 'Paste', 'More editor actions']) {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      screen.getByRole('button', { name }).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('ends the row with host options after a separator, and has none by default', () => {
    const fake = createEditor([collapsed]);
    const plain = render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard() } });
    expect(plain.container.querySelector('.touch-edit-separator')).toBeNull();
    plain.unmount();

    const extras = createRawSnippet(() => ({ render: () => '<button type="button">Wrap</button>' }));
    render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard(), extras } });
    const bar = screen.getByRole('toolbar', { name: 'Touch editing' });
    const buttons = [...bar.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons.at(-1)).toBe('Wrap');
    expect(bar.querySelector('.touch-edit-separator')).not.toBeNull();
  });

  it('stops listening to the editor when removed', () => {
    const fake = createEditor([collapsed]);
    const { unmount } = render(TouchEditBar, { props: { editor: fake.typed, clipboard: createClipboard() } });
    unmount();
    expect(fake.subscription.dispose).toHaveBeenCalled();
    expect(fake.contentSubscription.dispose).toHaveBeenCalled();
  });
});
