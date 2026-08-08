import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MouseManager } from "../../input/MouseManager";

// Polyfill PointerEvent for jsdom
if (typeof PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

const createMockCanvas = (
  width = 800,
  height = 600,
  rectLeft = 0,
  rectTop = 0,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: rectLeft,
    top: rectTop,
    width,
    height,
    right: rectLeft + width,
    bottom: rectTop + height,
    x: rectLeft,
    y: rectTop,
    toJSON: () => ({}),
  });
  return canvas;
};

describe("MouseManager", () => {
  let mouseManager: MouseManager;

  beforeEach(() => {
    mouseManager = new MouseManager();
  });

  afterEach(() => {
    mouseManager.dispose();
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("should initialize mouse as Float32Array with all zeros", () => {
      const mouse = mouseManager.getMouse();
      expect(mouse).toBeInstanceOf(Float32Array);
      expect(mouse.length).toBe(4);
      expect(Array.from(mouse)).toEqual([0, 0, 0, 0]);
    });
  });

  describe("setupEventListeners", () => {
    it("should register pointerdown, pointerup, and pointermove on canvas", () => {
      const canvas = createMockCanvas();
      const addSpy = vi.spyOn(canvas, "addEventListener");

      mouseManager.setupEventListeners(canvas);

      expect(addSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    });

    it("removes the exact callbacks from the old canvas on re-entry", () => {
      const firstCanvas = createMockCanvas();
      const secondCanvas = createMockCanvas();
      const addSpy = vi.spyOn(firstCanvas, "addEventListener");
      const removeSpy = vi.spyOn(firstCanvas, "removeEventListener");

      mouseManager.setupEventListeners(firstCanvas);
      const callbacks = new Map(addSpy.mock.calls.map(([type, callback]) => [type, callback]));
      mouseManager.setupEventListeners(secondCanvas);

      expect(removeSpy).toHaveBeenCalledWith("pointerdown", callbacks.get("pointerdown"));
      expect(removeSpy).toHaveBeenCalledWith("pointerup", callbacks.get("pointerup"));
      expect(removeSpy).toHaveBeenCalledWith("pointermove", callbacks.get("pointermove"));
    });
  });

  describe("dispose", () => {
    it("removes listeners once and ignores later pointer events", () => {
      const canvas = createMockCanvas();
      const removeSpy = vi.spyOn(canvas, "removeEventListener");
      mouseManager.setupEventListeners(canvas);
      mouseManager.dispose();
      mouseManager.dispose();

      canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 20, clientY: 30, pointerId: 1 }));

      expect(Array.from(mouseManager.getMouse())).toEqual([0, 0, 0, 0]);
      expect(removeSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe("pointerdown", () => {
    it("should set mouse xy and zw to click position with Y flipped", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      // x = floor((400 - 0) / 800 * 800) = 400
      // y = floor(600 - (300 - 0) / 600 * 600) = 300
      expect(mouse[0]).toBe(400);
      expect(mouse[1]).toBe(300);
      expect(mouse[2]).toBe(400);
      expect(mouse[3]).toBe(300);
    });

    it("should handle canvas offset correctly", () => {
      const canvas = createMockCanvas(800, 600, 100, 50);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 500, clientY: 350, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      // x = floor((500 - 100) / 800 * 800) = 400
      // y = floor(600 - (350 - 50) / 600 * 600) = 300
      expect(mouse[0]).toBe(400);
      expect(mouse[1]).toBe(300);
    });

    it("should handle click at top-left corner", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      expect(mouse[0]).toBe(0);
      expect(mouse[1]).toBe(600); // Y flipped: bottom = 600
    });

    it("should handle click at bottom-right corner", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 800, clientY: 600, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      expect(mouse[0]).toBe(800);
      expect(mouse[1]).toBe(0); // Y flipped: top = 0
    });
  });

  describe("pointermove", () => {
    it("should update xy when pointer is down", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      // Press pointer first
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 }),
      );

      // Move pointer
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 200, clientY: 150, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      expect(mouse[0]).toBe(200);
      expect(mouse[1]).toBe(450); // 600 - 150
    });

    it("should not update xy when pointer is not down", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      // Move without pressing
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 200, clientY: 150, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      expect(mouse[0]).toBe(0);
      expect(mouse[1]).toBe(0);
    });

    it("should not update zw during pointermove (only on pointerdown)", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 400, clientY: 300, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      // zw should still be from pointerdown position
      expect(mouse[2]).toBe(100);
      expect(mouse[3]).toBe(500); // 600 - 100
    });
  });

  describe("pointerup", () => {
    it("should negate zw on pointerup (Shadertoy convention)", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 300, clientY: 200, pointerId: 1 }),
      );

      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

      const mouse = mouseManager.getMouse();
      // z and w should be negated
      expect(mouse[2]).toBe(-300);
      expect(mouse[3]).toBe(-400); // -(600-200) = -400
    });

    it("should stop updating xy on pointermove after pointerup", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 }),
      );
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

      const posAfterUp = mouseManager.getMouse()[0];

      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 500, clientY: 500, pointerId: 1 }),
      );

      // xy should not have changed
      expect(mouseManager.getMouse()[0]).toBe(posAfterUp);
    });

    it("should handle multiple down/up cycles", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      // First cycle
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 }),
      );
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));

      expect(mouseManager.getMouse()[2]).toBeLessThan(0);

      // Second cycle
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 200, clientY: 200, pointerId: 2 }),
      );

      const mouse = mouseManager.getMouse();
      expect(mouse[2]).toBe(200);
      expect(mouse[3]).toBe(400); // 600 - 200, positive again
    });
  });

  describe("coordinate scaling", () => {
    it("should scale correctly when canvas size differs from display size", () => {
      // Canvas is 400x300 but displayed at 800x600
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 300;
      vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 }),
      );

      const mouse = mouseManager.getMouse();
      // x = floor((400/800) * 400) = 200
      // y = floor(300 - (300/600) * 300) = 150
      expect(mouse[0]).toBe(200);
      expect(mouse[1]).toBe(150);
    });
  });

  describe("setEnabled", () => {
    it("should ignore pointer events while disabled", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);
      mouseManager.setEnabled(false);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 400, clientY: 300, pointerId: 1 }),
      );
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 500, clientY: 350, pointerId: 1 }),
      );

      expect(Array.from(mouseManager.getMouse())).toEqual([0, 0, 0, 0]);
    });

    it("should stop drag updates after being disabled", () => {
      const canvas = createMockCanvas(800, 600);
      mouseManager.setupEventListeners(canvas);

      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 }),
      );

      mouseManager.setEnabled(false);

      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 400, clientY: 300, pointerId: 1 }),
      );

      expect(mouseManager.getMouse()[0]).toBe(100);
      expect(mouseManager.getMouse()[1]).toBe(500);
    });
  });
});
