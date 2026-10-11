import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceManager } from "../../resources/ResourceManager";
import type { TextureBackend } from "../../resources/TextureBackend";

const volumeManager = vi.hoisted(() => ({
  get: vi.fn(), isLoaded: vi.fn(), load: vi.fn(), cleanup: vi.fn(),
}));

vi.mock("../../resources/VolumeTextureManager", () => ({
  VolumeTextureManager: vi.fn().mockImplementation(function() {
    return volumeManager; 
  }),
}));
vi.mock("../../resources/TextureCache", () => ({ TextureCache: vi.fn().mockImplementation(function() {
  return { cleanup: vi.fn(), dispose: vi.fn() }; 
}) }));
vi.mock("../../resources/VideoTextureManager", () => ({ VideoTextureManager: vi.fn().mockImplementation(function() {
  return { cleanup: vi.fn() }; 
}) }));
vi.mock("../../resources/CubemapTextureManager", () => ({ CubemapTextureManager: vi.fn().mockImplementation(function() {
  return { cleanup: vi.fn() }; 
}) }));
vi.mock("../../resources/AudioTextureManager", () => ({ AudioTextureManager: vi.fn().mockImplementation(function() {
  return { cleanup: vi.fn() }; 
}) }));
vi.mock("../../resources/LiveInputTextureManager", () => ({ LiveInputTextureManager: vi.fn().mockImplementation(function() {
  return { cleanup: vi.fn() }; 
}) }));
vi.mock("../../resources/ShaderKeyboardInput", () => ({ ShaderKeyboardInput: vi.fn().mockImplementation(function() {
  return { cleanup: vi.fn() }; 
}) }));

describe("ResourceManager volume delegation", () => {
  let manager: ResourceManager<object>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ResourceManager({} as TextureBackend<object>);
  });

  it("uses default volume options for get, loaded state, and loading", async () => {
    const texture = {};
    volumeManager.get.mockReturnValue(texture);
    volumeManager.isLoaded.mockReturnValue(true);
    volumeManager.load.mockResolvedValue({ texture, warning: "decoded with fallback" });

    expect(manager.getVolumeTexture("density.ktx2")).toBe(texture);
    expect(manager.isVolumeLoaded("density.ktx2")).toBe(true);
    await expect(manager.loadVolumeTexture("density.ktx2")).resolves.toEqual({ texture, warning: "decoded with fallback" });

    expect(volumeManager.get).toHaveBeenCalledWith("density.ktx2", {});
    expect(volumeManager.isLoaded).toHaveBeenCalledWith("density.ktx2", {});
    expect(volumeManager.load).toHaveBeenCalledWith("density.ktx2", {});
  });

  it("does not clean resources when its backend has already been detached", () => {
    const internals = manager as unknown as { backend: TextureBackend<object> | null };
    internals.backend = null;

    manager.cleanup();
    manager.cleanupAllExceptMedia();

    expect(volumeManager.cleanup).not.toHaveBeenCalled();
  });
});
