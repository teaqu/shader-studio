import { describe, expect, it, vi } from 'vitest';
import { bindRenamePopupKeys } from '../../lib/editor/renamePopupKeys';

function fixture() {
  const container = document.createElement('div');
  container.innerHTML = '<div class="rename-box"><input /></div><input class="unrelated" />';
  const editor = { trigger: vi.fn() };
  const dispose = bindRenamePopupKeys(container, editor);
  return { container, input: container.querySelector('input')!, editor, dispose };
}

describe('rename popup key routing', () => {
  it.each([['Enter', 'acceptRenameInput'], ['Escape', 'cancelRenameInput']])('routes %s to its owner editor', (key, command) => {
    const { input, editor, dispose } = fixture();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(editor.trigger).toHaveBeenCalledExactlyOnceWith('keyboard', command, undefined);
    expect(event.defaultPrevented).toBe(true);
    dispose();
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    expect(editor.trigger).toHaveBeenCalledTimes(1);
  });

  it('leaves text entry, composition, modifiers, and other popups alone', () => {
    const { container, input, editor, dispose } = fixture();
    for (const init of [{ key: 'a' }, { key: 'Enter', isComposing: true }, { key: 'Enter', ctrlKey: true }, { key: 'Enter', metaKey: true }, { key: 'Enter', altKey: true }]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    container.querySelector('.unrelated')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const handled = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    handled.preventDefault();
    input.dispatchEvent(handled);
    expect(editor.trigger).not.toHaveBeenCalled();
    dispose();
  });
});
