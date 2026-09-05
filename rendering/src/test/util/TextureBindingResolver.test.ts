import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTextureBindings } from "../../util/TextureBindingResolver";
import { assignInputSlots } from "../../util/InputSlotAssigner";

const defaultTexture = { id: "default" } as any;
const imageTexture = { id: "image" } as any;
const cubemapTexture = { id: "cubemap" } as any;
const keyboardTexture = { id: "keyboard" } as any;
const videoTexture = { id: "video" } as any;
const audioTexture = { id: "audio" } as any;

const keyboard = {
  held: new Uint8Array([1]),
  pressed: new Uint8Array([2]),
  toggled: new Uint8Array([3]),
};

describe("resolveTextureBindings", () => {
  let resourceManager: any;
  let passBuffers: any;

  beforeEach(() => {
    resourceManager = {
      getDefaultTexture: vi.fn(() => defaultTexture),
      getImageTextureCache: vi.fn(() => ({ "noise.png": imageTexture })),
      getCubemapTexture: vi.fn((path: string) => (path === "sky/" ? cubemapTexture : null)),
      getKeyboardTexture: vi.fn(() => keyboardTexture),
      updateKeyboardTexture: vi.fn(),
      getVideoTexture: vi.fn((path: string) => (path === "clip.mp4" ? videoTexture : null)),
      getAudioTexture: vi.fn((path: string) => (path === "track.mp3" ? audioTexture : null)),
    };
    passBuffers = { Trails: { front: { mTex0: { id: "trails" } }, back: { mTex0: { id: "trails-back" } } } };
  });

  const resolve = (inputs: any, keyboardState: typeof keyboard | null = keyboard) =>
    resolveTextureBindings({
      inputs,
      slotAssignments: assignInputSlots(inputs),
      resourceManager,
      passBuffers,
      keyboard: keyboardState,
    });

  it("fills at least four slots with the default texture", () => {
    expect(resolve({})).toEqual([defaultTexture, defaultTexture, defaultTexture, defaultTexture]);
  });

  it("grows beyond four slots when there are more inputs", () => {
    const inputs = Object.fromEntries(
      ["a", "b", "c", "d", "e"].map((key) => [key, { type: "texture", path: "noise.png" }]),
    );
    expect(resolve(inputs)).toHaveLength(5);
  });

  it("binds image textures by resolved path, then raw path", () => {
    expect(resolve({ iChannel0: { type: "texture", path: "noise.png" } })[0]).toBe(imageTexture);
    expect(resolve({ iChannel0: { type: "texture", path: "noise.png", resolved_path: "missing.png" } })[0])
      .toBe(imageTexture);
    expect(resolve({ iChannel0: { type: "texture", path: "absent.png" } })[0]).toBe(defaultTexture);
  });

  it("binds cubemaps by resolved path, then raw path", () => {
    expect(resolve({ iChannel0: { type: "cubemap", path: "sky/" } })[0]).toBe(cubemapTexture);
    expect(resolve({ iChannel0: { type: "cubemap", path: "sky/", resolved_path: "elsewhere/" } })[0])
      .toBe(cubemapTexture);
  });

  it("leaves an unresolved cubemap slot null rather than binding the 2D default", () => {
    expect(resolve({ iChannel0: { type: "cubemap", path: "unknown/" } })[0]).toBeNull();
  });

  it("refreshes the keyboard texture from the supplied key state", () => {
    const bindings = resolve({ iChannel0: { type: "keyboard" } });

    expect(resourceManager.updateKeyboardTexture)
      .toHaveBeenCalledWith(keyboard.held, keyboard.pressed, keyboard.toggled);
    expect(bindings[0]).toBe(keyboardTexture);
  });

  it("binds the keyboard texture without refreshing it when no key state is given", () => {
    const bindings = resolve({ iChannel0: { type: "keyboard" } }, null);

    expect(resourceManager.updateKeyboardTexture).not.toHaveBeenCalled();
    expect(bindings[0]).toBe(keyboardTexture);
  });

  it("falls back to the default texture when the keyboard texture is missing", () => {
    resourceManager.getKeyboardTexture = vi.fn(() => null);
    expect(resolve({ iChannel0: { type: "keyboard" } })[0]).toBe(defaultTexture);
  });

  it("binds the front buffer of the source pass", () => {
    expect(resolve({ iChannel0: { type: "buffer", source: "Trails" } })[0]).toEqual({ id: "trails" });
  });

  it("binds the front buffer for a pass reading its own output", () => {
    // Self-feedback resolves like any other source: the pass renders into back
    // and the swap happens after, so front is still the previous frame.
    expect(resolve({ iChannel0: { type: "buffer", source: "Trails" } })[0])
      .toBe(passBuffers.Trails.front.mTex0);
  });

  it("falls back to the default texture for an unknown buffer source", () => {
    expect(resolve({ iChannel0: { type: "buffer", source: "Missing" } })[0]).toBe(defaultTexture);
  });

  it("binds video and audio textures with the same path fallback", () => {
    expect(resolve({ iChannel0: { type: "video", path: "clip.mp4" } })[0]).toBe(videoTexture);
    expect(resolve({ iChannel0: { type: "video", path: "clip.mp4", resolved_path: "gone.mp4" } })[0])
      .toBe(videoTexture);
    expect(resolve({ iChannel0: { type: "video", path: "gone.mp4" } })[0]).toBe(defaultTexture);
    expect(resolve({ iChannel0: { type: "audio", path: "track.mp3" } })[0]).toBe(audioTexture);
    expect(resolve({ iChannel0: { type: "audio", path: "gone.mp3" } })[0]).toBe(defaultTexture);
  });

  it("leaves path-less texture inputs on the default texture", () => {
    expect(resolve({ iChannel0: { type: "texture" } })[0]).toBe(defaultTexture);
    expect(resolve({ iChannel0: { type: "cubemap" } })[0]).toBe(defaultTexture);
  });

  it("binds custom-named inputs to the slot they were assigned", () => {
    const bindings = resolve({
      noiseMap: { type: "texture", path: "noise.png" },
      environment: { type: "cubemap", path: "sky/" },
    });

    expect(bindings[0]).toBe(imageTexture);
    expect(bindings[1]).toBe(cubemapTexture);
  });

  it("uses the default texture for a slot whose key has no input entry", () => {
    const bindings = resolveTextureBindings({
      inputs: {},
      slotAssignments: [{ slot: 0, key: "missing", isCustomName: true }],
      resourceManager,
      passBuffers,
      keyboard,
    });

    expect(bindings[0]).toBe(defaultTexture);
  });
});
