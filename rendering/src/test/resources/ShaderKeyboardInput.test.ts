import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShaderKeyboardInput } from "../../resources/ShaderKeyboardInput";
import type { PiRenderer, PiTexture } from "../../types/piRenderer";

const createMockTexture = (id = 1): PiTexture => ({
  mObjectID: { id } as any,
  mXres: 256,
  mYres: 3,
  mFormat: 2,
  mType: 0,
  mFilter: 0,
  mWrap: 0,
  mVFlip: false,
});

const createMockRenderer = (): PiRenderer => {
  let textureId = 0;
  return {
    FILTER: { LINEAR: 1, NONE: 0, MIPMAP: 2 },
    TEXFMT: { C1I8: 2, C4I8: 1 },
    TEXTYPE: { T2D: 0, T3D: 2 },
    TEXWRP: { CLAMP: 0, REPEAT: 1 },

    CreateTexture: vi.fn(() => createMockTexture(++textureId)),
    UpdateTexture: vi.fn(),
    DestroyTexture: vi.fn(),
    CreateTextureFromImage: vi.fn(),
    UpdateTextureFromImage: vi.fn(),
    CreateRenderTarget: vi.fn(),
    CreateShader: vi.fn(),
    DestroyRenderTarget: vi.fn(),
    DestroyShader: vi.fn(),
    SetRenderTarget: vi.fn(),
    SetViewport: vi.fn(),
    AttachShader: vi.fn(),
    SetShaderTextureUnit: vi.fn(),
    AttachTextures: vi.fn(),
    GetAttribLocation: vi.fn(() => 0),
    DrawUnitQuad_XY: vi.fn(),
    Flush: vi.fn(),
  } as unknown as PiRenderer;
};

describe("ShaderKeyboardInput", () => {
  let renderer: PiRenderer;
  let keyboardInput: ShaderKeyboardInput;

  beforeEach(() => {
    renderer = createMockRenderer();
    keyboardInput = new ShaderKeyboardInput(renderer);
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

      expect(renderer.CreateTexture).toHaveBeenCalledTimes(1);
      expect(renderer.CreateTexture).toHaveBeenCalledWith(
        renderer.TEXTYPE.T2D,
        256, // KEYBOARD_SIZE
        3, // KEYBOARD_LAYERS
        renderer.TEXFMT.C1I8,
        renderer.FILTER.NONE,
        renderer.TEXWRP.CLAMP,
        expect.any(Uint8Array),
      );
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

      expect(renderer.CreateTexture).toHaveBeenCalledTimes(1);
      expect(renderer.UpdateTexture).toHaveBeenCalledTimes(1);
      expect(renderer.UpdateTexture).toHaveBeenCalledWith(
        expect.any(Object),
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

      const buffer = vi.mocked(renderer.CreateTexture).mock.calls[0][6] as Uint8Array;

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

      expect(renderer.UpdateTexture).toHaveBeenCalledTimes(1);
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
      expect(texture!.mObjectID).toBeDefined();
    });
  });

  describe("cleanup", () => {
    it("should destroy the keyboard texture", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      keyboardInput.cleanup();

      expect(renderer.DestroyTexture).toHaveBeenCalledTimes(1);
      expect(keyboardInput.getKeyboardTexture()).toBeNull();
    });

    it("should be safe to call cleanup when no texture exists", () => {
      keyboardInput.cleanup();

      expect(renderer.DestroyTexture).not.toHaveBeenCalled();
    });

    it("should be safe to call cleanup multiple times", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      keyboardInput.cleanup();
      keyboardInput.cleanup();

      expect(renderer.DestroyTexture).toHaveBeenCalledTimes(1);
    });

    it("should allow creating new texture after cleanup", () => {
      const held = new Uint8Array(256);
      const pressed = new Uint8Array(256);
      const toggled = new Uint8Array(256);

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);
      keyboardInput.cleanup();

      keyboardInput.updateKeyboardTexture(held, pressed, toggled);

      expect(renderer.CreateTexture).toHaveBeenCalledTimes(2);
      expect(keyboardInput.getKeyboardTexture()).not.toBeNull();
    });
  });
});
