import { describe, expect, it, vi } from "vitest";
import { WebGPUShaderSession } from "../../webgpu/WebGPUShaderSession";

describe("WebGPUShaderSession volume resource loading", () => {
  it("loads the volume channel with its metadata through candidate tracking and preserves warnings", async () => {
    const trackCandidateResourceLoad = vi.fn(async (_candidate, load: () => Promise<unknown>) => load());
    const host = { disposed: false, candidates: { trackCandidateResourceLoad } };
    const session = new WebGPUShaderSession(host as never);
    const resourceManager = { loadVolumeTexture: vi.fn().mockResolvedValue({ texture: null, warning: "volume fallback" }) };
    const channel = { kind: "volume", key: "density", slot: 2, path: "resolved-density.ktx2", filter: "nearest", wrap: "clamp" };
    const warnings: string[] = [];
    const loadFileResources = (session as unknown as { loadFileResources: (manager: unknown, candidates: unknown, passes: unknown[], warnings: string[], generation: number) => Promise<boolean> }).loadFileResources;

    await expect(loadFileResources.call(session, resourceManager, { resourceLoadsPending: 0 }, [{ channels: [channel] }], warnings, 0)).resolves.toBe(true);

    expect(trackCandidateResourceLoad).toHaveBeenCalledOnce();
    expect(resourceManager.loadVolumeTexture).toHaveBeenCalledWith("resolved-density.ktx2", channel);
    expect(warnings).toEqual(["volume fallback"]);
  });
});
