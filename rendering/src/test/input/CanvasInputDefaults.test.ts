import { expect, it } from 'vitest';
import { preventCanvasMouseDefault } from '../../input/CanvasInputDefaults';

it('defaults to preventing actions and follows live preference changes', () => {
  const canvas = document.createElement('canvas');
  const prevented = (target: HTMLCanvasElement | null) => {
    const event = new Event('wheel', { cancelable: true });
    preventCanvasMouseDefault(target, event);
    return event.defaultPrevented;
  };
  expect(prevented(canvas)).toBe(true);
  canvas.dataset.preventMouseDefaults = 'false';
  expect(prevented(canvas)).toBe(false);
  canvas.dataset.preventMouseDefaults = 'true';
  expect(prevented(canvas)).toBe(true);
  expect(prevented({} as HTMLCanvasElement)).toBe(true);
  expect(prevented(null)).toBe(false);
});
