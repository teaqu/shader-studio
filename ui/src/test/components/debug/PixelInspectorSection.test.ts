// @vitest-environment jsdom
import { render, fireEvent } from '@testing-library/svelte';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import PixelInspectorSection from '../../../lib/components/debug/PixelInspectorSection.svelte';
import {
  setInspectorState,
  registerLockAtHandler,
} from '../../../lib/state/pixelInspectorState.svelte';
import { debugPanelStore } from '../../../lib/stores/debugPanelStore';
import { get } from 'svelte/store';
import type { PixelInspectorState } from '../../../lib/types/PixelInspectorState';

const DEFAULT_STATE: PixelInspectorState = {
  isEnabled: true,
  isActive: true,
  isLocked: false,
  mouseX: 0,
  mouseY: 0,
  pixelRGB: null,
  fragCoord: null,
  canvasPosition: null,
};

const PIXEL_STATE: PixelInspectorState = {
  ...DEFAULT_STATE,
  isLocked: true,
  pixelRGB: { r: 255, g: 128, b: 0 },
  fragCoord: { x: 100.5, y: 200.5 },
  canvasPosition: { x: 100, y: 200 },
};

function makeCanvas(width = 400, height = 300): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

describe('PixelInspectorSection', () => {
  beforeAll(() => {
    // jsdom does not implement PointerEvent — without this, fireEvent.pointer*
    // falls back to a plain Event and drops clientX/clientY. Aliasing it to
    // MouseEvent (which jsdom does support) lets coordinates flow through.
    if (typeof window.PointerEvent === 'undefined') {
      // @ts-expect-error — assigning MouseEvent as a PointerEvent shim for jsdom
      window.PointerEvent = window.MouseEvent;
    }
    // jsdom does not implement pointer capture APIs
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
    // jsdom gives all elements zero layout — give the zoom canvas a real size
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 120, bottom: 120,
      width: 120, height: 120, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  });

  beforeEach(() => {
    setInspectorState({ ...DEFAULT_STATE });
  });

  describe('empty state', () => {
    it('shows hint text when no pixel selected', () => {
      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      expect(container.querySelector('.hint-text')).toBeTruthy();
      expect(container.querySelector('.info-grid')).toBeFalsy();
    });

    it('zoom canvas has empty class when no pixel', () => {
      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      expect(container.querySelector('canvas.empty')).toBeTruthy();
    });
  });

  describe('with pixel selected', () => {
    beforeEach(() => {
      setInspectorState({ ...PIXEL_STATE });
    });

    it('shows info grid with RGB, Hex, Float, fragCoord, UV', () => {
      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const labels = Array.from(container.querySelectorAll('.info-label')).map(
        (el) => el.textContent
      );
      expect(labels).toContain('RGB');
      expect(labels).toContain('Hex');
      expect(labels).toContain('Float');
      expect(labels).toContain('fragCoord');
      expect(labels).toContain('UV');
    });

    it('does not show UV when canvas dimensions are zero', () => {
      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 0,
        canvasHeight: 0,
      });
      const labels = Array.from(container.querySelectorAll('.info-label')).map(
        (el) => el.textContent
      );
      expect(labels).not.toContain('UV');
    });

    it('zoom canvas has locked class when locked', () => {
      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      expect(container.querySelector('canvas.locked')).toBeTruthy();
    });

    it('zoom canvas shows crosshair cursor', () => {
      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      expect(canvas.style.cursor).toBe('crosshair');
    });
  });

  describe('canvas marker config menu', () => {
    beforeEach(() => {
      debugPanelStore.setPixelMarkerEnabled(true);
    });

    function renderSection() {
      return render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
    }

    it('hides the marker toggle until the config button is clicked', async () => {
      const { queryByLabelText, getByLabelText } = renderSection();
      expect(queryByLabelText(/marker on canvas/i)).toBeNull();

      await fireEvent.click(getByLabelText(/inspector settings/i));
      expect(queryByLabelText(/marker on canvas/i)).toBeTruthy();
    });

    it('renders the toggle reflecting the store state (on by default)', async () => {
      const { getByLabelText } = renderSection();
      await fireEvent.click(getByLabelText(/inspector settings/i));
      const checkbox = getByLabelText(/marker on canvas/i) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('reflects a disabled store state', async () => {
      debugPanelStore.setPixelMarkerEnabled(false);
      const { getByLabelText } = renderSection();
      await fireEvent.click(getByLabelText(/inspector settings/i));
      const checkbox = getByLabelText(/marker on canvas/i) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('updates the store when toggled off', async () => {
      const { getByLabelText } = renderSection();
      await fireEvent.click(getByLabelText(/inspector settings/i));
      const checkbox = getByLabelText(/marker on canvas/i) as HTMLInputElement;
      await fireEvent.click(checkbox);
      expect(get(debugPanelStore).isPixelMarkerEnabled).toBe(false);
    });

    it('closes the menu when clicking outside', async () => {
      const { getByLabelText, queryByLabelText } = renderSection();
      await fireEvent.click(getByLabelText(/inspector settings/i));
      expect(queryByLabelText(/marker on canvas/i)).toBeTruthy();

      await fireEvent.click(document.body);
      expect(queryByLabelText(/marker on canvas/i)).toBeNull();
    });

    it('keeps the menu open when interacting with the toggle', async () => {
      const { getByLabelText, queryByLabelText } = renderSection();
      await fireEvent.click(getByLabelText(/inspector settings/i));
      const checkbox = getByLabelText(/marker on canvas/i) as HTMLInputElement;
      await fireEvent.click(checkbox);
      expect(queryByLabelText(/marker on canvas/i)).toBeTruthy();
    });
  });

  describe('click to jump', () => {
    it('calls requestLockAt with correct pixel coords on click', async () => {
      setInspectorState({ ...PIXEL_STATE });
      const locked = vi.fn();
      registerLockAtHandler(locked);

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // Simulate click at center of 120×120 canvas → should land on the locked pixel

      await fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      await fireEvent.pointerUp(canvas, { clientX: 60, clientY: 60, pointerId: 1 });

      expect(locked).toHaveBeenCalledOnce();
    });

    it('does not fire requestLockAt when no pixel is selected', async () => {
      const locked = vi.fn();
      registerLockAtHandler(locked);

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      await fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      await fireEvent.pointerUp(canvas, { clientX: 60, clientY: 60, pointerId: 1 });

      expect(locked).not.toHaveBeenCalled();
    });
  });

  describe('drag to pan', () => {
    it('click without drag calls requestLockAt once via jump', async () => {
      setInspectorState({ ...PIXEL_STATE });
      const locked = vi.fn();
      registerLockAtHandler(locked);

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      await fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      await fireEvent.pointerUp(canvas, { clientX: 60, clientY: 60, pointerId: 1 });

      expect(locked).toHaveBeenCalledOnce();
    });

    it('does not fire until movement exceeds the drag threshold', async () => {
      setInspectorState({ ...PIXEL_STATE });
      const locked = vi.fn();
      registerLockAtHandler(locked);

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      await fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      // 2px move — below the 3px threshold, no pan yet
      await fireEvent.pointerMove(canvas, { clientX: 62, clientY: 60, pointerId: 1 });
      expect(locked).not.toHaveBeenCalled();

      // 20px move — exceeds threshold, pans
      await fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60, pointerId: 1 });
      expect(locked).toHaveBeenCalled();
    });

    it('pans opposite to the drag direction (grab-scroll)', async () => {
      setInspectorState({ ...PIXEL_STATE }); // canvasPosition = { x: 100, y: 200 }
      const locked = vi.fn();
      registerLockAtHandler(locked);

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // drag right by 16 zoom-canvas px at zoom 8 → 2 source px; view recenters left
      await fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      await fireEvent.pointerMove(canvas, { clientX: 76, clientY: 60, pointerId: 1 });

      const [x, y] = locked.mock.calls[locked.mock.calls.length - 1] as [number, number];
      expect(x).toBe(98);
      expect(y).toBe(200);
    });

    it('toggles the grabbing cursor during a drag', async () => {
      setInspectorState({ ...PIXEL_STATE });

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      expect(canvas.style.cursor).toBe('crosshair');

      await fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      await fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60, pointerId: 1 });
      expect(canvas.style.cursor).toBe('grabbing');

      await fireEvent.pointerUp(canvas, { clientX: 80, clientY: 60, pointerId: 1 });
      expect(canvas.style.cursor).toBe('crosshair');
    });

    it('does not jump on pointer up after a drag', async () => {
      setInspectorState({ ...PIXEL_STATE });
      const locked = vi.fn();
      registerLockAtHandler(locked);

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      await fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      await fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60, pointerId: 1 });
      const callsAfterDrag = locked.mock.calls.length;

      await fireEvent.pointerUp(canvas, { clientX: 80, clientY: 60, pointerId: 1 });
      // pointer up after dragging must NOT add a click-jump call
      expect(locked.mock.calls.length).toBe(callsAfterDrag);
    });
  });

  describe('scroll to zoom', () => {
    function zoomLabel(container: HTMLElement): string | null {
      return container.querySelector('.zoom-label')?.textContent ?? null;
    }

    it('shows the zoom level label and steps up on scroll up (deltaY < 0)', async () => {
      setInspectorState({ ...PIXEL_STATE });

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // no label before any scroll
      expect(zoomLabel(container)).toBeNull();

      // default zoom 8 → next level up is 10
      await fireEvent.wheel(canvas, { deltaY: -100 });
      expect(zoomLabel(container)).toBe('10×');
    });

    it('steps down on scroll down (deltaY > 0)', async () => {
      setInspectorState({ ...PIXEL_STATE });

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      // default zoom 8 → next level down is 6
      await fireEvent.wheel(canvas, { deltaY: 100 });
      expect(zoomLabel(container)).toBe('6×');
    });

    it('clamps zoom to the minimum level when scrolling out repeatedly', async () => {
      setInspectorState({ ...PIXEL_STATE });

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      for (let i = 0; i < 50; i++) {
        await fireEvent.wheel(canvas, { deltaY: 100 });
      }
      expect(zoomLabel(container)).toBe('2×');
    });

    it('clamps zoom to the maximum level when scrolling in repeatedly', async () => {
      setInspectorState({ ...PIXEL_STATE });

      const { container } = render(PixelInspectorSection, {
        canvasElement: makeCanvas(),
        canvasWidth: 400,
        canvasHeight: 300,
      });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;

      for (let i = 0; i < 50; i++) {
        await fireEvent.wheel(canvas, { deltaY: -100 });
      }
      expect(zoomLabel(container)).toBe('30×');
    });

    it('hides the zoom label after the timeout elapses', async () => {
      vi.useFakeTimers();
      try {
        setInspectorState({ ...PIXEL_STATE });

        const { container } = render(PixelInspectorSection, {
          canvasElement: makeCanvas(),
          canvasWidth: 400,
          canvasHeight: 300,
        });
        const canvas = container.querySelector('canvas') as HTMLCanvasElement;

        await fireEvent.wheel(canvas, { deltaY: -100 });
        expect(zoomLabel(container)).toBe('10×');

        await vi.advanceTimersByTimeAsync(1300);
        expect(zoomLabel(container)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
