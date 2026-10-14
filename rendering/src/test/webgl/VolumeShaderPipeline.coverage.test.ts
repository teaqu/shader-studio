import { describe, expect, it, vi } from "vitest";
import { ShaderPipeline } from "../../webgl/ShaderPipeline";
import type { ResourceManager } from "../../resources/ResourceManager";
import type { PiTexture } from "../../types/piRenderer";

function pipeline(resources: { loadVolumeTexture: ReturnType<typeof vi.fn>; cleanup: ReturnType<typeof vi.fn> }) {
  return new ShaderPipeline(
    { width: 1, height: 1, getContext: vi.fn() } as unknown as HTMLCanvasElement,
    { compileShaderAsync: vi.fn().mockResolvedValue({ mResult: true, mInfo: "" }), wrapShaderToyCode: vi.fn().mockReturnValue({ headerLineCount: 0, commonCodeLineCount: 0 }) } as never,
    resources as unknown as ResourceManager<PiTexture>,
    { DestroyShader: vi.fn(), GetShaderHeaderLines: vi.fn().mockReturnValue(0) } as never,
    { getPassBuffers: vi.fn().mockReturnValue({}), setPassBuffers: vi.fn(), dispose: vi.fn(), cleanupBuffers: vi.fn(), createPingPongBuffers: vi.fn() } as never,
    { cleanup: vi.fn(), reset: vi.fn(), getTime: vi.fn(), getDeltaTime: vi.fn() } as never,
    null,
    vi.fn(),
  );
}

describe("ShaderPipeline volume resource loading", () => {
  it("abandons a volume load that completes after the pipeline is disposed", async () => {
    let resolve!: (result: { texture: null }) => void;
    const resources = { cleanup: vi.fn(), cleanupAllExceptMedia: vi.fn(), loadVolumeTexture: vi.fn(() => new Promise(resolvePromise => {
      resolve = resolvePromise;
    })) };
    const subject = pipeline(resources);
    const compile = subject.compileShaderPipeline("void mainImage() {}", {
      version: "1", passes: { Image: { inputs: { density: { type: "volume", path: "late.ktx2" } } } },
    }, "late.glsl");

    await vi.waitFor(() => expect(resources.loadVolumeTexture).toHaveBeenCalledOnce());
    subject.dispose();
    resolve({ texture: null });

    await expect(compile).resolves.toMatchObject({ success: false, superseded: true });
    expect(resources.loadVolumeTexture).toHaveBeenCalledWith("late.ktx2", expect.objectContaining({ type: "volume" }));
    expect(resources.cleanup).toHaveBeenCalledTimes(2);
  });
});
