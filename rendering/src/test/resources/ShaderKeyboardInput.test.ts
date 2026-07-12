import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShaderKeyboardInput } from "../../resources/ShaderKeyboardInput";
import type { TextureBackend } from "../../resources/TextureBackend";

interface FakeTex { id: number }

function mockBackend() {
  let next = 1;
  return {
    createTexture: vi.fn((): FakeTex => ({ id: next++ })),
    createTextureFromImage: vi.fn((): FakeTex => ({ id: next++ })),
    createMipmaps: vi.fn(),
    updateTexture: vi.fn(),
    updateTextureFromImage: vi.fn(),
    destroyTexture: vi.fn(),
  } satisfies TextureBackend<FakeTex>;
}

describe("ShaderKeyboardInput", () => {
  let backend: TextureBackend<FakeTex>;
  let keyboardInput: ShaderKeyboardInput<FakeTex>;

  beforeEach(() => {
    backend = mockBackend();
    keyboardInput = new ShaderKeyboardInput(backend);
  });

  describe("initial state", () => {
    it("should have null keyboard texture initially", () => {
      expect(keyboardInput.getKeyboardTexture()).toBeNull();
    });
  });

  describe("updateKeyboardTexture", () => {
    it("should create a keyboard texture on first call", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      expect(backend.createTexture).toHaveBeenCalledTimes(1);
      const call = (backend.createTexture as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call).toMatchObject({ type: "2d", width: 256, height: 3, format: "r8", filter: "nearest", wrap: "clamp" });
      expect(call.data).toBeInstanceOf(Uint8Array);
      expect(keyboardInput.getKeyboardTexture()).not.toBeNull();
    });

    it("should update existing texture on subsequent calls", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      // First call creates texture
      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      // Second call updates
      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      expect(backend.createTexture).toHaveBeenCalledTimes(1);
      expect(backend.updateTexture).toHaveBeenCalledTimes(1);
      const tex = keyboardInput.getKeyboardTexture();
      expect(backend.updateTexture).toHaveBeenCalledWith(
        tex,
        0,
        0,
        256,
        3,
        expect.any(Uint8Array),
      );
    });

    it("should pack keyboard data in correct order: held, pressed, toggled", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      held[65] = 255; // 'A' held
      pressed[66] = 255; // 'B' pressed
      toggled[67] = 255; // 'C' toggled

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      const call = (backend.createTexture as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const buffer = call.data as Uint8Array;

      // Row 0: held (indices 0-255)
      expect(buffer[65]).toBe(255);
      // Row 1: pressed (indices 256-511)
      expect(buffer[256 + 66]).toBe(255);
      // Row 2: toggled (indices 512-767)
      expect(buffer[512 + 67]).toBe(255);
    });

    it("should update buffer contents on each call", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      // Modify and update again
      held[70] = 255;
      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      expect(backend.updateTexture).toHaveBeenCalledTimes(1);
    });
  });

  describe("getKeyboardTexture", () => {
    it("should return the created texture after update", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      const texture = keyboardInput.getKeyboardTexture();
      expect(texture).not.toBeNull();
      expect(texture!.id).toBeDefined();
    });
  });

  describe("cleanup", () => {
    it("should destroy the keyboard texture", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      keyboardInput.cleanup();

      expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
      expect(keyboardInput.getKeyboardTexture()).toBeNull();
    });

    it("should be safe to call cleanup when no texture exists", () => {
      keyboardInput.cleanup();

      expect(backend.destroyTexture).not.toHaveBeenCalled();
    });

    it("should be safe to call cleanup multiple times", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      keyboardInput.cleanup();
      keyboardInput.cleanup();

      expect(backend.destroyTexture).toHaveBeenCalledTimes(1);
    });

    it("should allow creating new texture after cleanup", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);
      keyboardInput.cleanup();

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      expect(backend.createTexture).toHaveBeenCalledTimes(2);
      expect(keyboardInput.getKeyboardTexture()).not.toBeNull();
    });
  });
});
