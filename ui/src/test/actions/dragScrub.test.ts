import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dragScrub } from '../../lib/actions/dragScrub';

function createInput(attrs: Record<string, string> = {}): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.value = '0.5';
  for (const [key, val] of Object.entries(attrs)) {
    input.setAttribute(key, val);
  }
  document.body.appendChild(input);
  return input;
}

describe('dragScrub', () => {
  let input: HTMLInputElement;
  let onInput: ReturnType<typeof vi.fn>;
  let action: ReturnType<typeof dragScrub>;

  beforeEach(() => {
    onInput = vi.fn();
    input = createInput({ min: '0', max: '1' });
    action = dragScrub(input, { step: 0.01, onInput });
  });

  afterEach(() => {
    action.destroy();
    input.remove();
  });

  it('should not call onInput on mousedown alone', () => {
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    expect(onInput).not.toHaveBeenCalled();
  });

  it('should call onInput when dragging right', () => {
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 108 })); // 8px = 2 steps
    expect(onInput).toHaveBeenCalled();
    const value = onInput.mock.calls[onInput.mock.calls.length - 1][0];
    expect(value).toBeGreaterThan(0.5);
  });

  it('should call onInput when dragging left', () => {
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 92 })); // -8px = -2 steps
    expect(onInput).toHaveBeenCalled();
    const value = onInput.mock.calls[onInput.mock.calls.length - 1][0];
    expect(value).toBeLessThan(0.5);
  });

  it('should clamp to min value', () => {
    input.value = '0.01';
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    // Drag far left to go below min
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }));
    expect(onInput).toHaveBeenCalled();
    const value = onInput.mock.calls[onInput.mock.calls.length - 1][0];
    expect(value).toBeGreaterThanOrEqual(0);
  });

  it('should clamp to max value', () => {
    input.value = '0.99';
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    // Drag far right to go above max
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    expect(onInput).toHaveBeenCalled();
    const value = onInput.mock.calls[onInput.mock.calls.length - 1][0];
    expect(value).toBeLessThanOrEqual(1);
  });

  it('should set ew-resize cursor during drag', () => {
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    expect(input.style.cursor).toBe('ew-resize');
    expect(document.body.style.cursor).toBe('ew-resize');
  });

  it('should clear cursor on mouseup', () => {
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(input.style.cursor).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('should focus and select input when clicking without dragging', () => {
    const focusSpy = vi.spyOn(input, 'focus');
    const selectSpy = vi.spyOn(input, 'select');

    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(focusSpy).toHaveBeenCalled();
    expect(selectSpy).toHaveBeenCalled();
  });

  it('should not focus/select input after actual drag', () => {
    const focusSpy = vi.spyOn(input, 'focus');

    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120 })); // actual drag
    window.dispatchEvent(new MouseEvent('mouseup'));

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('should work without min/max attributes', () => {
    action.destroy();
    input.remove();

    input = createInput(); // no min/max
    input.value = '5';
    action = dragScrub(input, { step: 1, onInput });

    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140 })); // 10 steps
    expect(onInput).toHaveBeenCalled();
    const value = onInput.mock.calls[onInput.mock.calls.length - 1][0];
    expect(value).toBe(15);
  });

  it('should round to step precision', () => {
    input.value = '0.5';
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 104 })); // 1 step of 0.01
    expect(onInput).toHaveBeenCalled();
    const value = onInput.mock.calls[onInput.mock.calls.length - 1][0];
    // Should be rounded to 2 decimal places
    const decimalStr = String(value).split('.')[1] || '';
    expect(decimalStr.length).toBeLessThanOrEqual(2);
  });

  it('should update options via update method', () => {
    const newOnInput = vi.fn();
    action.update({ step: 1, onInput: newOnInput });

    input.value = '5';
    input.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 108 })); // 2 steps
    expect(newOnInput).toHaveBeenCalled();
    expect(onInput).not.toHaveBeenCalled();
  });

  it('should clean up listeners on destroy', () => {
    const removeListenerSpy = vi.spyOn(input, 'removeEventListener');
    action.destroy();
    expect(removeListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });
});
