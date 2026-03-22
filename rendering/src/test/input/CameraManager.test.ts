import { describe, it, expect, vi, beforeEach } from "vitest";
import { CameraManager } from "../../input/CameraManager";
import { KeyboardManager } from "../../input/KeyboardManager";

type MockKeyboardManager = KeyboardManager & {
  press: (code: number) => void;
  release: (code: number) => void;
  releaseAll: () => void;
};

// Create a mock KeyboardManager with controllable key state
function createMockKeyboardManager(): MockKeyboardManager {
  const keyHeld = new Uint8Array(256);
  return {
    getKeyHeld: () => keyHeld,
    press: (code: number) => { keyHeld[code] = 255; },
    release: (code: number) => { keyHeld[code] = 0; },
    releaseAll: () => { keyHeld.fill(0); },
    setupEventListeners: vi.fn(),
    getKeyPressed: () => new Uint8Array(256),
  } as unknown as MockKeyboardManager;
}

describe("CameraManager", () => {
  let camera: CameraManager;
  let kb: ReturnType<typeof createMockKeyboardManager>;

  beforeEach(() => {
    kb = createMockKeyboardManager();
    camera = new CameraManager(kb);
  });

  describe("initial state", () => {
    it("should start at origin", () => {
      const pos = camera.getCameraPos();
      expect(pos[0]).toBe(0);
      expect(pos[1]).toBe(0);
      expect(pos[2]).toBe(0);
    });

    it("should look along -Z initially", () => {
      const dir = camera.getCameraDir();
      expect(dir[0]).toBeCloseTo(0, 5);
      expect(dir[1]).toBeCloseTo(0, 5);
      expect(dir[2]).toBeCloseTo(-1, 5);
    });
  });

  describe("WASD movement", () => {
    it("W should move forward (along -Z initially)", () => {
      kb.press(87); // W
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[2]).toBeLessThan(0); // moved along -Z
    });

    it("S should move backward", () => {
      kb.press(83); // S
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[2]).toBeGreaterThan(0); // moved along +Z
    });

    it("A should strafe left", () => {
      kb.press(65); // A
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[0]).toBeLessThan(0); // moved along -X (left)
    });

    it("D should strafe right", () => {
      kb.press(68); // D
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[0]).toBeGreaterThan(0); // moved along +X (right)
    });

    it("W should move in the direction camera is facing (3D)", () => {
      // Look up by simulating pitch
      kb.press(38); // Up arrow = pitch up
      camera.update(0.5);
      kb.releaseAll();

      const dirBefore = camera.getCameraDir();
      expect(dirBefore[1]).toBeGreaterThan(0); // looking up

      const posBefore = [...camera.getCameraPos()];
      kb.press(87); // W
      camera.update(1.0);
      const posAfter = camera.getCameraPos();

      // Should have moved upward (Y increased) since we're looking up
      expect(posAfter[1]).toBeGreaterThan(posBefore[1]);
    });

    it("movement should scale with deltaTime", () => {
      kb.press(87); // W
      camera.update(0.1);
      const pos1 = [...camera.getCameraPos()];

      // Reset
      camera = new CameraManager(kb);
      camera.update(1.0);
      const pos2 = camera.getCameraPos();

      // 10x deltaTime = 10x distance
      expect(Math.abs(pos2[2])).toBeCloseTo(Math.abs(pos1[2]) * 10, 1);
    });
  });

  describe("QE vertical movement", () => {
    it("Q should move up (world Y)", () => {
      kb.press(81); // Q
      camera.update(1.0);
      expect(camera.getCameraPos()[1]).toBeGreaterThan(0);
    });

    it("E should move down (world Y)", () => {
      kb.press(69); // E
      camera.update(1.0);
      expect(camera.getCameraPos()[1]).toBeLessThan(0);
    });

    it("QE should be world-space regardless of camera orientation", () => {
      // Look sideways first
      kb.press(39); // Right arrow = yaw right
      camera.update(1.0);
      kb.releaseAll();

      kb.press(81); // Q
      camera.update(1.0);
      // Y should still increase even though we're facing a different direction
      expect(camera.getCameraPos()[1]).toBeGreaterThan(0);
    });
  });

  describe("sprint (Shift)", () => {
    it("Shift should multiply movement speed", () => {
      kb.press(87); // W
      camera.update(1.0);
      const normalDist = Math.abs(camera.getCameraPos()[2]);

      camera = new CameraManager(kb);
      kb.press(87); // W
      kb.press(16); // Shift
      camera.update(1.0);
      const sprintDist = Math.abs(camera.getCameraPos()[2]);

      expect(sprintDist).toBeGreaterThan(normalDist * 2);
    });
  });

  describe("arrow key look", () => {
    it("left arrow should yaw left", () => {
      kb.press(37); // Left
      camera.update(0.5);
      const dir = camera.getCameraDir();
      expect(dir[0]).toBeLessThan(0); // yaw left from -Z → faces -X
    });

    it("right arrow should yaw right", () => {
      kb.press(39); // Right
      camera.update(0.5);
      const dir = camera.getCameraDir();
      expect(dir[0]).toBeGreaterThan(0); // yaw right from -Z → faces +X
    });

    it("up arrow should pitch up", () => {
      kb.press(38); // Up
      camera.update(0.5);
      const dir = camera.getCameraDir();
      expect(dir[1]).toBeGreaterThan(0); // pitch up → dir.y > 0
    });

    it("down arrow should pitch down", () => {
      kb.press(40); // Down
      camera.update(0.5);
      const dir = camera.getCameraDir();
      expect(dir[1]).toBeLessThan(0); // pitch down → dir.y < 0
    });
  });

  describe("mouse look", () => {
    it("should set up event listeners", () => {
      const canvas = {
        addEventListener: vi.fn(),
      } as unknown as HTMLCanvasElement;

      camera.setupEventListeners(canvas);
      expect(canvas.addEventListener).toHaveBeenCalledWith("mousedown", expect.any(Function));
    });

    it("horizontal mouse drag should change yaw", () => {
      const listeners: Record<string, Function> = {};
      const canvas = {
        addEventListener: vi.fn((event: string, handler: Function) => { listeners[event] = handler; }),
      } as unknown as HTMLCanvasElement;
      const windowAddSpy = vi.spyOn(window, "addEventListener");

      camera.setupEventListeners(canvas);

      // Capture the mousemove handler
      const moveHandler = windowAddSpy.mock.calls.find(c => c[0] === "mousemove")![1] as Function;

      // Simulate left click
      listeners.mousedown({ button: 0, clientX: 100, clientY: 100, preventDefault: vi.fn() });

      // Drag right
      moveHandler({ clientX: 150, clientY: 100 });

      const dir = camera.getCameraDir();
      // Drag right → yaw right → dir.x > 0
      expect(dir[0]).toBeGreaterThan(0);

      windowAddSpy.mockRestore();
    });

    it("vertical mouse drag should change pitch", () => {
      const listeners: Record<string, Function> = {};
      const canvas = {
        addEventListener: vi.fn((event: string, handler: Function) => { listeners[event] = handler; }),
      } as unknown as HTMLCanvasElement;
      const windowAddSpy = vi.spyOn(window, "addEventListener");

      camera.setupEventListeners(canvas);
      const moveHandler = windowAddSpy.mock.calls.find(c => c[0] === "mousemove")![1] as Function;

      listeners.mousedown({ button: 0, clientX: 100, clientY: 100, preventDefault: vi.fn() });
      moveHandler({ clientX: 100, clientY: 50 }); // drag up (dy = -50)

      const dir = camera.getCameraDir();
      expect(dir[1]).toBeGreaterThan(0); // drag up = look up

      windowAddSpy.mockRestore();
    });

    it("should not respond to right-click drag", () => {
      const listeners: Record<string, Function> = {};
      const canvas = {
        addEventListener: vi.fn((event: string, handler: Function) => { listeners[event] = handler; }),
      } as unknown as HTMLCanvasElement;
      const windowAddSpy = vi.spyOn(window, "addEventListener");

      camera.setupEventListeners(canvas);
      const moveHandler = windowAddSpy.mock.calls.find(c => c[0] === "mousemove")![1] as Function;

      // Right click
      listeners.mousedown({ button: 2, clientX: 100, clientY: 100, preventDefault: vi.fn() });
      moveHandler({ clientX: 200, clientY: 100 });

      const dir = camera.getCameraDir();
      expect(dir[0]).toBeCloseTo(0, 5); // unchanged

      windowAddSpy.mockRestore();
    });

    it("mouse up should stop drag", () => {
      const listeners: Record<string, Function> = {};
      const canvas = {
        addEventListener: vi.fn((event: string, handler: Function) => { listeners[event] = handler; }),
      } as unknown as HTMLCanvasElement;
      const windowAddSpy = vi.spyOn(window, "addEventListener");

      camera.setupEventListeners(canvas);
      const moveHandler = windowAddSpy.mock.calls.find(c => c[0] === "mousemove")![1] as Function;
      const upHandler = windowAddSpy.mock.calls.find(c => c[0] === "mouseup")![1] as Function;

      listeners.mousedown({ button: 0, clientX: 100, clientY: 100, preventDefault: vi.fn() });
      upHandler({ button: 0 });

      // Further movement should not change direction
      const dirBefore = [...camera.getCameraDir()];
      moveHandler({ clientX: 200, clientY: 200 });
      const dirAfter = camera.getCameraDir();

      expect(dirAfter[0]).toBeCloseTo(dirBefore[0], 5);
      expect(dirAfter[1]).toBeCloseTo(dirBefore[1], 5);

      windowAddSpy.mockRestore();
    });
  });

  describe("setEnabled", () => {
    it("should ignore keyboard-driven updates while disabled", () => {
      kb.press(87); // W
      camera.setEnabled(false);
      camera.update(1.0);

      const pos = camera.getCameraPos();
      expect(pos[0]).toBe(0);
      expect(pos[1]).toBe(0);
      expect(pos[2]).toBe(0);
    });

    it("should ignore mouse drag while disabled", () => {
      const listeners: Record<string, Function> = {};
      const canvas = {
        addEventListener: vi.fn((event: string, handler: Function) => { listeners[event] = handler; }),
      } as unknown as HTMLCanvasElement;
      const windowAddSpy = vi.spyOn(window, "addEventListener");

      camera.setupEventListeners(canvas);
      const moveHandler = windowAddSpy.mock.calls.find(c => c[0] === "mousemove")![1] as Function;

      camera.setEnabled(false);
      listeners.mousedown({ button: 0, clientX: 100, clientY: 100, preventDefault: vi.fn() });
      moveHandler({ clientX: 150, clientY: 100 });

      const dir = camera.getCameraDir();
      expect(dir[0]).toBeCloseTo(0, 5);
      expect(dir[1]).toBeCloseTo(0, 5);
      expect(dir[2]).toBeCloseTo(-1, 5);

      windowAddSpy.mockRestore();
    });
  });

  describe("pitch clamping", () => {
    it("should not flip when looking straight up", () => {
      // Pitch up aggressively
      kb.press(38); // Up arrow = pitch up
      for (let i = 0; i < 100; i++) {
        camera.update(0.1);
      }

      const dir = camera.getCameraDir();
      // Y should be close to 1 (looking up) but forward Z should still be slightly negative
      expect(dir[1]).toBeGreaterThan(0.9);
      expect(dir[1]).toBeLessThanOrEqual(1.0);

      // Direction should not have flipped — Z component should still be non-positive
      expect(dir[2]).toBeLessThanOrEqual(0.01);
    });

    it("should not flip when looking straight down", () => {
      kb.press(40); // Down arrow = pitch down
      for (let i = 0; i < 100; i++) {
        camera.update(0.1);
      }

      const dir = camera.getCameraDir();
      expect(dir[1]).toBeLessThan(-0.9);
      expect(dir[1]).toBeGreaterThanOrEqual(-1.0);
    });
  });

  describe("deltaTime edge cases", () => {
    it("should ignore zero deltaTime", () => {
      kb.press(87); // W
      camera.update(0);
      expect(camera.getCameraPos()[2]).toBe(0);
    });

    it("should ignore negative deltaTime", () => {
      kb.press(87); // W
      camera.update(-1);
      expect(camera.getCameraPos()[2]).toBe(0);
    });

    it("should ignore very large deltaTime (> 1s)", () => {
      kb.press(87); // W
      camera.update(5);
      expect(camera.getCameraPos()[2]).toBe(0);
    });
  });

  describe("dispose", () => {
    it("should remove event listeners", () => {
      const removeEventListenerSpy = vi.fn();
      const canvas = {
        addEventListener: vi.fn(),
        removeEventListener: removeEventListenerSpy,
      } as unknown as HTMLCanvasElement;
      const windowRemoveSpy = vi.spyOn(window, "removeEventListener");

      camera.setupEventListeners(canvas);
      camera.dispose();

      expect(removeEventListenerSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
      expect(windowRemoveSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
      expect(windowRemoveSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));

      windowRemoveSpy.mockRestore();
    });

    it("should not throw if called without setupEventListeners", () => {
      expect(() => camera.dispose()).not.toThrow();
    });
  });

  describe("simultaneous key input", () => {
    it("W+D should move both forward and right", () => {
      kb.press(87); // W
      kb.press(68); // D
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[2]).toBeLessThan(0); // moved forward (-Z)
      expect(pos[0]).toBeGreaterThan(0); // moved right (+X with D)
    });

    it("W+A should move both forward and left", () => {
      kb.press(87); // W
      kb.press(65); // A
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[2]).toBeLessThan(0); // moved forward
      expect(pos[0]).toBeLessThan(0); // moved left (-X with A)
    });

    it("W+Q should move forward and up", () => {
      kb.press(87); // W
      kb.press(81); // Q
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[2]).toBeLessThan(0); // forward
      expect(pos[1]).toBeGreaterThan(0); // up
    });

    it("up+right arrow should pitch up and yaw right simultaneously", () => {
      kb.press(38); // Up arrow = pitch up
      kb.press(39); // Right arrow = yaw right
      camera.update(0.5);
      const dir = camera.getCameraDir();
      expect(dir[1]).toBeGreaterThan(0); // pitched up
      expect(dir[0]).toBeGreaterThan(0); // yawed right
    });

    it("W+A+D should apply both strafes, cancelling horizontally", () => {
      kb.press(87); // W
      kb.press(65); // A
      kb.press(68); // D
      camera.update(1.0);
      const pos = camera.getCameraPos();
      expect(pos[2]).toBeLessThan(0); // still moved forward
      expect(pos[0]).toBeCloseTo(0, 5); // A and D cancel out
    });
  });

  describe("direction vector is normalized", () => {
    it("should return unit vector initially", () => {
      const dir = camera.getCameraDir();
      const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
      expect(len).toBeCloseTo(1, 5);
    });

    it("should return unit vector after rotation", () => {
      kb.press(40); // Down arrow up
      kb.press(39); // Right arrow
      camera.update(0.5);

      const dir = camera.getCameraDir();
      const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
      expect(len).toBeCloseTo(1, 4);
    });
  });
});
