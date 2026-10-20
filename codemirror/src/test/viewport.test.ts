import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { ViewportScrollController, visibleScrollMargins } from '../viewport';

function fixture() {
  const viewport = Object.assign(new EventTarget(), { scale: 1, height: 400, offsetTop: 100 });
  let callback: FrameRequestCallback | undefined;
  const window = {
    visualViewport: viewport,
    requestAnimationFrame: vi.fn((next: FrameRequestCallback) => {
      callback = next;
      return 1;
    }),
    cancelAnimationFrame: vi.fn(),
  };
  const view = {
    dom: { ownerDocument: { defaultView: window } },
    scrollDOM: { getBoundingClientRect: () => new DOMRect(0, 150, 390, 700) },
    hasFocus: true,
    state: { selection: { main: { head: 5 } } },
    dispatch: vi.fn(),
  };
  return { viewport, window, view, editor: view as unknown as EditorView, frame: () => callback?.(0) };
}

describe('visible editor viewport', () => {
  it('leaves code full height while reserving a visible cursor area above the keyboard and keys', () => {
    const { editor, viewport } = fixture();
    expect(visibleScrollMargins(editor)).toEqual({ bottom: 390 });
    viewport.height = 1000;
    expect(visibleScrollMargins(editor)).toBeNull();
    viewport.height = 10;
    expect(visibleScrollMargins(editor)).toEqual({ bottom: 660 });
    viewport.scale = 2;
    expect(visibleScrollMargins(editor)).toBeNull();
  });

  it('does not impose viewport margins when no browser viewport exists', () => {
    const { view, editor } = fixture();
    Object.assign(view.dom.ownerDocument, { defaultView: null });
    expect(visibleScrollMargins(editor)).toBeNull();
    const controller = new ViewportScrollController(editor);
    expect(() => controller.destroy()).not.toThrow();
  });

  it('coalesces viewport changes, preserves focus, and releases listeners and pending frames', () => {
    const { editor, view, viewport, window, frame } = fixture();
    const controller = new ViewportScrollController(editor);
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(window.requestAnimationFrame).toHaveBeenCalledOnce();
    frame();
    expect(view.dispatch).toHaveBeenCalledOnce();
    view.hasFocus = false;
    viewport.dispatchEvent(new Event('resize'));
    frame();
    expect(view.dispatch).toHaveBeenCalledOnce();
    view.hasFocus = true;
    viewport.scale = 2;
    viewport.dispatchEvent(new Event('resize'));
    frame();
    expect(view.dispatch).toHaveBeenCalledOnce();
    viewport.dispatchEvent(new Event('resize'));
    controller.destroy();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    window.requestAnimationFrame.mockClear();
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });
});
