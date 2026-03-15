import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { KeyboardManager } from "../../input/KeyboardManager";

describe("KeyboardManager", () => {
  let keyboardManager: KeyboardManager;

  beforeEach(() => {
    keyboardManager = new KeyboardManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("should initialize keyHeld as all zeros", () => {
      const held = keyboardManager.getKeyHeld();
      expect(held).toBeInstanceOf(Uint8Array);
      expect(held.length).toBe(256);
      expect(held.every((v) => v === 0)).toBe(true);
    });

    it("should initialize keyPressed as all zeros", () => {
      const pressed = keyboardManager.getKeyPressed();
      expect(pressed).toBeInstanceOf(Uint8Array);
      expect(pressed.length).toBe(256);
      expect(pressed.every((v) => v === 0)).toBe(true);
    });

    it("should initialize keyToggled as all zeros", () => {
      const toggled = keyboardManager.getKeyToggled();
      expect(toggled).toBeInstanceOf(Uint8Array);
      expect(toggled.length).toBe(256);
      expect(toggled.every((v) => v === 0)).toBe(true);
    });
  });

  describe("setupEventListeners", () => {
    it("should register keydown and keyup event listeners on window", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      keyboardManager.setupEventListeners();

      expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith("keyup", expect.any(Function));
    });
  });

  describe("keydown handling", () => {
    beforeEach(() => {
      keyboardManager.setupEventListeners();
    });

    it("should set keyHeld to 255 on keydown", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      expect(keyboardManager.getKeyHeld()[65]).toBe(255);
    });

    it("should set keyPressed to 255 on initial keydown", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      expect(keyboardManager.getKeyPressed()[65]).toBe(255);
    });

    it("should toggle keyToggled on first press", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      expect(keyboardManager.getKeyToggled()[65]).toBe(255);
    });

    it("should toggle keyToggled off on second press", () => {
      // First press (toggle on)
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );
      window.dispatchEvent(
        new KeyboardEvent("keyup", { keyCode: 65 } as any),
      );

      // Second press (toggle off)
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      expect(keyboardManager.getKeyToggled()[65]).toBe(0);
    });

    it("should not re-trigger pressed or toggle on repeated keydown (key held)", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      // Clear pressed to simulate frame boundary
      keyboardManager.clearPressed();

      // Repeat keydown while key is still held
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      // keyPressed should not be re-set since key was already held
      expect(keyboardManager.getKeyPressed()[65]).toBe(0);
      // keyToggled should stay at 255 (not toggle again)
      expect(keyboardManager.getKeyToggled()[65]).toBe(255);
    });

    it("should ignore keys with keyCode >= 256", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 300 } as any),
      );

      // Should not throw and arrays should be unmodified
      expect(keyboardManager.getKeyHeld().every((v) => v === 0)).toBe(true);
    });
  });

  describe("keyup handling", () => {
    beforeEach(() => {
      keyboardManager.setupEventListeners();
    });

    it("should set keyHeld to 0 on keyup", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );
      window.dispatchEvent(
        new KeyboardEvent("keyup", { keyCode: 65 } as any),
      );

      expect(keyboardManager.getKeyHeld()[65]).toBe(0);
    });

    it("should not affect keyPressed on keyup", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );
      window.dispatchEvent(
        new KeyboardEvent("keyup", { keyCode: 65 } as any),
      );

      // keyPressed remains until clearPressed is called
      expect(keyboardManager.getKeyPressed()[65]).toBe(255);
    });

    it("should not affect keyToggled on keyup", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );
      window.dispatchEvent(
        new KeyboardEvent("keyup", { keyCode: 65 } as any),
      );

      // keyToggled remains until next keydown
      expect(keyboardManager.getKeyToggled()[65]).toBe(255);
    });

    it("should ignore keys with keyCode >= 256", () => {
      window.dispatchEvent(
        new KeyboardEvent("keyup", { keyCode: 300 } as any),
      );

      expect(keyboardManager.getKeyHeld().every((v) => v === 0)).toBe(true);
    });
  });

  describe("clearPressed", () => {
    beforeEach(() => {
      keyboardManager.setupEventListeners();
    });

    it("should reset all keyPressed values to 0", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 66 } as any),
      );

      keyboardManager.clearPressed();

      expect(keyboardManager.getKeyPressed()[65]).toBe(0);
      expect(keyboardManager.getKeyPressed()[66]).toBe(0);
    });

    it("should not affect keyHeld", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      keyboardManager.clearPressed();

      expect(keyboardManager.getKeyHeld()[65]).toBe(255);
    });

    it("should not affect keyToggled", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );

      keyboardManager.clearPressed();

      expect(keyboardManager.getKeyToggled()[65]).toBe(255);
    });
  });

  describe("multiple keys", () => {
    beforeEach(() => {
      keyboardManager.setupEventListeners();
    });

    it("should track multiple keys independently", () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 65 } as any),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 66 } as any),
      );

      expect(keyboardManager.getKeyHeld()[65]).toBe(255);
      expect(keyboardManager.getKeyHeld()[66]).toBe(255);

      window.dispatchEvent(
        new KeyboardEvent("keyup", { keyCode: 65 } as any),
      );

      expect(keyboardManager.getKeyHeld()[65]).toBe(0);
      expect(keyboardManager.getKeyHeld()[66]).toBe(255);
    });
  });
});
