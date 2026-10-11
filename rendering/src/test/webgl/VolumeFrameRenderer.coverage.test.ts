import { describe, expect, it, vi } from "vitest";
import { FrameRenderer } from "../../webgl/FrameRenderer";

function renderer(loaded: boolean) {
  const resourceManager = { getAudioSampleRate: () => 44_100, isVolumeLoaded: vi.fn(() => loaded) };
  const subject = new FrameRenderer(
    { getCurrentTime: () => 0, getDeltaTime: () => 0, getFrame: () => 0, getCurrentDate: () => new Float32Array(4) } as never,
    {} as never, { getMouse: () => new Float32Array(4) } as never, { getCameraPos: () => new Float32Array(3), getCameraDir: () => new Float32Array(3) } as never,
    {} as never, { getPassBuffers: () => ({}) } as never, {} as never, resourceManager as never, { width: 4, height: 2 } as HTMLCanvasElement,
    { getRawFPS: () => 60 } as never,
  );
  return { subject, resourceManager };
}

describe("volume frame uniforms", () => {
  it.each([true, false])("reports resolved volume load state (%s)", loaded => {
    const { subject, resourceManager } = renderer(loaded);
    const pass = { name: "Image", inputs: { density: { type: "volume", path: "density.ktx2", resolved_path: "resolved.ktx2" } } };
    const uniforms = (subject as unknown as { getPassUniforms: (pass: unknown, base: unknown) => { channelLoaded: number[] } })
      .getPassUniforms(pass, subject.getUniforms());
    expect(uniforms.channelLoaded[0]).toBe(loaded ? 1 : 0);
    expect(resourceManager.isVolumeLoaded).toHaveBeenCalledWith("resolved.ktx2", pass.inputs.density);
  });
});
